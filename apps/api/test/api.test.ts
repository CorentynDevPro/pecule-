/**
 * Tests d'intégration contre un vrai PostgreSQL.
 * Lancer avec TEST_DATABASE_URL=postgres://… ; ignorés sinon.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import WebSocket from 'ws';
import type { LiveMessage, SyncResponse } from '@pecule/shared';
import { buildApp, type AppContext } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { migrate } from '../src/migrate.js';

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

const PROFILE_ID = '00000000-0000-4000-8000-000000000001';
const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';

suite('API Pécule', () => {
  let ctx: AppContext;

  beforeAll(async () => {
    const config = loadConfig({ DATABASE_URL: url!, LOG_LEVEL: 'silent', MIGRATIONS_DIR: 'migrations' } as NodeJS.ProcessEnv);
    ctx = await buildApp(config);
    await ctx.pool.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
    await migrate(ctx.pool, path.resolve('migrations'));
    await ctx.hub.start();
    await ctx.app.listen({ port: 0, host: '127.0.0.1' });
  });

  afterAll(async () => {
    await ctx?.app.close();
  });

  const post = async (body: object) => {
    const res = await ctx.app.inject({ method: 'POST', url: '/api/sync', payload: body as Record<string, unknown> });
    return { status: res.statusCode, body: res.json() as SyncResponse };
  };

  it('propage un compte créé sur un appareil vers un autre', async () => {
    const account = {
      id: ACCOUNT_ID,
      name: 'PEA Boursorama',
      type: 'pea',
      broker: 'Boursorama',
      updatedAt: '2026-09-30T08:00:00.000Z',
      deleted: false,
    };
    const pushed = await post({ since: 0, changes: [{ entity: 'account', record: account }] });
    expect(pushed.status).toBe(200);
    expect(pushed.body.rejected).toEqual([]);

    const pulled = await post({ since: 0, changes: [] });
    const found = pulled.body.changes.find((c) => c.entity === 'account');
    expect(found?.record).toEqual(account);
    expect(pulled.body.cursor).toBeGreaterThan(0);
  });

  it('garde la version la plus récente quand deux appareils modifient la même ligne', async () => {
    const start = (await post({ since: 0, changes: [] })).body.cursor;
    const newer = { id: ACCOUNT_ID, name: 'PEA (renommé sur iPhone)', type: 'pea', broker: 'Boursorama', updatedAt: '2026-09-30T09:00:00.000Z', deleted: false };
    const older = { ...newer, name: 'PEA (ancienne version du Mac)', updatedAt: '2026-09-30T08:30:00.000Z' };
    await post({ since: start, changes: [{ entity: 'account', record: newer }] });
    const res = await post({ since: start, changes: [{ entity: 'account', record: older }] });
    const account = res.body.changes.find((c) => c.entity === 'account')?.record;
    expect(account?.name).toBe('PEA (renommé sur iPhone)');
  });

  it('ne renvoie que ce qui a changé depuis le curseur', async () => {
    const { cursor } = (await post({ since: 0, changes: [] })).body;
    const res = await post({ since: cursor, changes: [] });
    expect(res.body.changes).toEqual([]);
    expect(res.body.cursor).toBe(cursor);
  });

  it('refuse un profil dont les poches ne totalisent pas 100 %, sans bloquer le reste', async () => {
    const badProfile = {
      id: PROFILE_ID, horizonYears: 5, maxDrawdownPct: 30, monthlyContributionCents: 10000,
      targetCorePct: 50, targetCryptoPct: 25, targetThemesPct: 15, targetLeveragePct: 20,
      emergencyFundOk: true, updatedAt: '2026-09-30T10:00:00.000Z', deleted: false,
    };
    const flow = {
      id: '22222222-2222-4222-8222-222222222222', accountId: ACCOUNT_ID, flowDate: '2026-09-01',
      amountCents: 10000, label: 'Versement mensuel', updatedAt: '2026-09-30T10:00:00.000Z', deleted: false,
    };
    const res = await post({ since: 0, changes: [{ entity: 'profile', record: badProfile }, { entity: 'cashFlow', record: flow }] });
    expect(res.body.rejected).toHaveLength(1);
    expect(res.body.rejected[0]?.entity).toBe('profile');
    expect(res.body.changes.some((c) => c.entity === 'cashFlow' && c.record.id === flow.id)).toBe(true);
  });

  it('conserve les quantités crypto à 8 décimales', async () => {
    const asset = {
      id: '33333333-3333-4333-8333-333333333333', name: 'Bitcoin', symbol: 'BTC', isin: null,
      assetClass: 'crypto', pocket: 'crypto', currency: 'EUR', quoteKey: 'kraken:BTC/EUR',
      updatedAt: '2026-09-30T10:00:00.000Z', deleted: false,
    };
    const tx = {
      id: '44444444-4444-4444-8444-444444444444', accountId: ACCOUNT_ID, assetId: asset.id, kind: 'buy',
      tradeDate: '2026-09-02', quantity: 0.00031245, amountCents: 2500, feeCents: 25, note: '',
      updatedAt: '2026-09-30T10:00:00.000Z', deleted: false,
    };
    const res = await post({ since: 0, changes: [{ entity: 'asset', record: asset }, { entity: 'transaction', record: tx }] });
    const stored = res.body.changes.find((c) => c.entity === 'transaction')?.record;
    expect(stored?.quantity).toBe(0.00031245);
    expect(stored?.tradeDate).toBe('2026-09-02');
  });

  it('agrège les bougies d’une minute en bougies de 5 minutes', async () => {
    const now = Math.floor(Date.now() / 300_000) * 300_000 - 600_000; // début d'un créneau de 5 min passé
    for (let i = 0; i < 5; i++) {
      await ctx.pool.query(
        `INSERT INTO price_candle_1m (quote_key, ts, open, high, low, close, volume)
         VALUES ('kraken:BTC/EUR', to_timestamp($1 / 1000.0), $2, $3, $4, $5, 1)`,
        [now + i * 60_000, 100 + i, 110 + i, 90 - i, 101 + i],
      );
    }
    const res = await ctx.app.inject({ url: '/api/prices/candles?key=kraken:BTC/EUR&interval=5m&hours=1' });
    const candles = res.json() as { ts: number; open: number; high: number; low: number; close: number; volume: number }[];
    expect(candles).toHaveLength(1);
    expect(candles[0]).toMatchObject({ ts: now, open: 100, high: 114, low: 86, close: 105, volume: 5 });
  });

  it('diffuse en direct un cours publié par le service de flux', async () => {
    const address = ctx.app.server.address() as { port: number };
    const ws = new WebSocket(`ws://127.0.0.1:${address.port}/api/live`);
    const messages: LiveMessage[] = [];
    ws.on('message', (data) => messages.push(JSON.parse(String(data)) as LiveMessage));
    await new Promise((resolve) => ws.once('open', resolve));
    await new Promise((r) => setTimeout(r, 100));
    expect(messages[0]?.type).toBe('snapshot');

    const tick = { k: 'kraken:ETH/EUR', p: 2345.67, c: 'EUR', chg: 1.2, t: Date.now() };
    await ctx.pool.query('SELECT pg_notify($1, $2)', ['price_tick', JSON.stringify(tick)]);
    await new Promise((r) => setTimeout(r, 300));
    expect(messages).toContainEqual({ type: 'tick', tick });
    ws.close();
  });

  it('accepte les appels de l’application hébergée sur GitHub Pages, y compris vers une adresse privée', async () => {
    const res = await ctx.app.inject({
      method: 'OPTIONS',
      url: '/api/sync',
      headers: {
        origin: 'https://coco.github.io',
        'access-control-request-method': 'POST',
        'access-control-request-private-network': 'true',
      },
    });
    expect(res.headers['access-control-allow-origin']).toBe('https://coco.github.io');
    expect(res.headers['access-control-allow-private-network']).toBe('true');
    const other = await ctx.app.inject({ method: 'OPTIONS', url: '/api/sync', headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' } });
    expect(other.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('indique son état de santé', async () => {
    const res = await ctx.app.inject({ url: '/api/health' });
    expect(res.json()).toMatchObject({ ok: true, db: true, live: true });
  });
});
