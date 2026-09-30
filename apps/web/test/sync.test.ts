/**
 * Synchronisation entre appareils.
 * - Tests hors ligne : la tour est simulée (coupée, puis rétablie).
 * - Test de bout en bout : deux « appareils » (deux bases IndexedDB) passent par la vraie API,
 *   si PECULE_API_URL pointe vers une API démarrée.
 */
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import type { SyncResponse } from '@pecule/shared';
import { LocalDb } from '../src/db/local';
import { Repo } from '../src/db/repo';
import { SyncEngine, type Fetcher } from '../src/sync/engine';

const ACC_NAME = { name: 'PEA', type: 'pea' as const, broker: '' };

describe('fonctionnement sans la tour', () => {
  it('garde les modifications en file d’attente puis les envoie au retour de la tour', async () => {
    const db = new LocalDb(`offline-${Math.random()}`);
    const repo = new Repo(db);
    let towerUp = false;
    const received: unknown[] = [];
    const fetcher: Fetcher = async (_url, init) => {
      if (!towerUp) throw new TypeError('Failed to fetch');
      const body = JSON.parse(String(init.body)) as { changes: unknown[] };
      received.push(...body.changes);
      const response: SyncResponse = { cursor: 1, changes: [], rejected: [] };
      return new Response(JSON.stringify(response), { status: 200 });
    };
    const engine = new SyncEngine(db, '', fetcher);

    await repo.save('account', ACC_NAME);
    await engine.syncNow();
    expect(engine.state.towerReachable).toBe(false);
    expect(engine.state.pending).toBe(1);
    expect(await db.account.count()).toBe(1); // la donnée est bien là, sur l'appareil

    towerUp = true;
    await engine.syncNow();
    expect(engine.state.towerReachable).toBe(true);
    expect(engine.state.pending).toBe(0);
    expect(received).toHaveLength(1);
  });

  it('ne perd pas une modification faite pendant un envoi', async () => {
    const db = new LocalDb(`race-${Math.random()}`);
    const repo = new Repo(db);
    const account = await repo.save('account', ACC_NAME);
    let release!: () => void;
    const fetcher: Fetcher = async () => {
      await new Promise<void>((r) => (release = r));
      return new Response(JSON.stringify({ cursor: 1, changes: [], rejected: [] }), { status: 200 });
    };
    const engine = new SyncEngine(db, '', fetcher);
    const running = engine.syncNow();
    await new Promise((r) => setTimeout(r, 20));
    await repo.save('account', { ...ACC_NAME, id: account.id, name: 'PEA renommé pendant l’envoi' });
    release();
    await running;
    // La version renommée n'a pas été envoyée : elle doit rester en attente.
    expect(await db.outbox.count()).toBe(1);
  });

  it('applique la version distante seulement si elle est plus récente', async () => {
    const db = new LocalDb(`lww-${Math.random()}`);
    const repo = new Repo(db);
    const local = await repo.save('account', { ...ACC_NAME, name: 'Version locale récente' });
    const older = { ...local, name: 'Version distante ancienne', updatedAt: '2020-01-01T00:00:00.000Z' };
    const fetcher: Fetcher = async () =>
      new Response(JSON.stringify({ cursor: 5, changes: [{ entity: 'account', record: older }], rejected: [] }), { status: 200 });
    const engine = new SyncEngine(db, '', fetcher);
    await engine.syncNow();
    expect((await db.account.get(local.id))?.name).toBe('Version locale récente');
    expect(await db.getMeta('cursor', 0)).toBe(5);
  });

  it('refuse localement un profil incohérent', async () => {
    const repo = new Repo(new LocalDb(`val-${Math.random()}`));
    await expect(
      repo.save('profile', {
        horizonYears: 5, maxDrawdownPct: 30, monthlyContributionCents: 10000,
        targetCorePct: 60, targetCryptoPct: 25, targetThemesPct: 15, targetLeveragePct: 10, emergencyFundOk: false,
      }),
    ).rejects.toThrow(/100 %/);
  });
});

const api = process.env.PECULE_API_URL;
describe.skipIf(!api)('iPhone, Mac et tour Windows à travers la vraie API', () => {
  it('propage une opération et sa suppression d’un appareil à l’autre', async () => {
    const iphone = new LocalDb(`iphone-${Math.random()}`);
    const mac = new LocalDb(`mac-${Math.random()}`);
    const iphoneRepo = new Repo(iphone);
    const iphoneSync = new SyncEngine(iphone, api);
    const macRepo = new Repo(mac);
    const macSync = new SyncEngine(mac, api);

    const account = await iphoneRepo.save('account', { name: 'Kraken', type: 'crypto', broker: 'Kraken' });
    const btc = await iphoneRepo.save('asset', {
      name: 'Bitcoin', symbol: 'BTC', isin: null, assetClass: 'crypto', pocket: 'crypto', currency: 'EUR', quoteKey: 'kraken:BTC/EUR',
    });
    const trade = await iphoneRepo.save('transaction', {
      accountId: account.id, assetId: btc.id, kind: 'buy', tradeDate: '2026-09-30', quantity: 0.00045, amountCents: 2500, feeCents: 38, note: 'depuis l’iPhone',
    });
    await iphoneSync.syncNow();
    expect(iphoneSync.state.pending).toBe(0);

    await macSync.syncNow();
    expect((await mac.trades.get(trade.id))?.quantity).toBe(0.00045);

    // Le Mac supprime l'opération ; l'iPhone doit la voir disparaître.
    await macRepo.remove('transaction', trade.id);
    await macSync.syncNow();
    await iphoneSync.syncNow();
    expect((await iphone.trades.get(trade.id))?.deleted).toBe(true);
  });
});
