import { describe, expect, it } from 'vitest';
import type { Account, Asset, Transaction } from '@pecule/shared';
import { applyScenario, SCENARIOS, yearlyTaxRecap } from '../src/domain/tax';
import { allocationByPocket } from '../src/domain/portfolio';

const base = { updatedAt: '2026-09-30T08:00:00.000Z', deleted: false };
const acc = (id: string, type: Account['type']): Account => ({ ...base, id, name: id, type, broker: '' });
const asset = (id: string, assetClass: Asset['assetClass']): Asset => ({ ...base, id, name: id, symbol: id, isin: null, assetClass, pocket: assetClass === 'crypto' ? 'crypto' : 'core', currency: 'EUR', quoteKey: null });
const tx = (id: string, over: Partial<Transaction>): Transaction => ({ ...base, id, accountId: 'cto', assetId: 'tte', kind: 'buy', tradeDate: '2026-01-10', quantity: 1, amountCents: 0, feeCents: 0, note: '', ...over });

const accounts = [acc('cto', 'cto'), acc('kraken', 'crypto'), acc('pea', 'pea')];
const assets = [asset('tte', 'stock'), asset('btc', 'crypto'), asset('dcam', 'etf')];

describe('récapitulatif fiscal', () => {
  it('taxe les plus-values et dividendes du compte-titres à 31,4 %', () => {
    const rows = yearlyTaxRecap(
      [
        tx('a', { quantity: 10, amountCents: 500_00 }),
        tx('b', { kind: 'sell', quantity: 5, amountCents: 350_00, tradeDate: '2026-06-01' }),
        tx('c', { kind: 'dividend', amountCents: 20_00, tradeDate: '2026-05-01', quantity: 0 }),
      ],
      assets,
      accounts,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ year: '2026', bucket: 'cto', realizedCents: 100_00, dividendsCents: 20_00 });
    expect(rows[0]!.taxCents).toBe(Math.round(120_00 * 0.314));
  });

  it('exonère la crypto quand les ventes de l’année restent sous 305 €', () => {
    const rows = yearlyTaxRecap(
      [tx('a', { accountId: 'kraken', assetId: 'btc', quantity: 0.01, amountCents: 200_00 }), tx('b', { accountId: 'kraken', assetId: 'btc', kind: 'sell', quantity: 0.01, amountCents: 300_00, tradeDate: '2026-08-01' })],
      assets,
      accounts,
    );
    expect(rows[0]).toMatchObject({ bucket: 'crypto', realizedCents: 100_00, taxCents: 0 });
  });

  it('ne taxe rien dans le PEA', () => {
    const rows = yearlyTaxRecap(
      [tx('a', { accountId: 'pea', assetId: 'dcam', quantity: 10, amountCents: 60_00 }), tx('b', { accountId: 'pea', assetId: 'dcam', kind: 'sell', quantity: 10, amountCents: 90_00, tradeDate: '2026-09-01' })],
      assets,
      accounts,
    );
    expect(rows[0]).toMatchObject({ bucket: 'sheltered', realizedCents: 30_00, taxCents: 0 });
  });
});

describe('scénarios de crise', () => {
  it('applique les chocs poche par poche', () => {
    const alloc = allocationByPocket([], undefined).map((a) => ({ ...a, valueCents: a.pocket === 'core' ? 100_00 : a.pocket === 'crypto' ? 100_00 : 0 }));
    const krach = SCENARIOS.find((s) => s.name === 'Krach sévère')!;
    const r = applyScenario(alloc, krach);
    expect(r.beforeCents).toBe(200_00);
    expect(r.afterCents).toBe(Math.round(100_00 * 0.55 + 100_00 * 0.25));
    expect(r.lossPct).toBeCloseTo(-0.6);
  });
});
