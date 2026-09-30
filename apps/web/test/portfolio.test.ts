import { describe, expect, it } from 'vitest';
import type { Asset, CashFlow, Profile, Transaction } from '@pecule/shared';
import {
  allocationByPocket,
  computePositions,
  monthlyFlows,
  nextContributionSplit,
  priceInEur,
  summarize,
  valueHistory,
  valuePositions,
} from '../src/domain/portfolio';
import { formatEuros, parseEuros, parseQuantity } from '../src/domain/format';

const base = { updatedAt: '2026-09-30T08:00:00.000Z', deleted: false };
const ACC = '11111111-1111-4111-8111-111111111111';

const asset = (id: string, over: Partial<Asset>): Asset => ({
  ...base, id, name: id, symbol: id, isin: null, assetClass: 'etf', pocket: 'core', currency: 'EUR', quoteKey: `yf:${id}`, ...over,
});
const tx = (id: string, over: Partial<Transaction>): Transaction => ({
  ...base, id, accountId: ACC, assetId: 'cw8', kind: 'buy', tradeDate: '2026-09-01', quantity: 1, amountCents: 0, feeCents: 0, note: '', ...over,
});
const flow = (id: string, date: string, cents: number): CashFlow => ({ ...base, id, accountId: ACC, flowDate: date, amountCents: cents, label: '' });

const cw8 = asset('cw8', {});
const btc = asset('btc', { assetClass: 'crypto', pocket: 'crypto', quoteKey: 'kraken:BTC/EUR' });
const ttwo = asset('ttwo', { assetClass: 'stock', pocket: 'themes', currency: 'USD', quoteKey: 'td:TTWO' });
const profile: Profile = {
  ...base, id: '00000000-0000-4000-8000-000000000001', horizonYears: 5, maxDrawdownPct: 30, monthlyContributionCents: 10_000,
  targetCorePct: 50, targetCryptoPct: 25, targetThemesPct: 15, targetLeveragePct: 10, emergencyFundOk: true,
};

describe('prix de revient unitaire (PRU)', () => {
  it('moyenne les achats et sort le coût au prorata à la vente', () => {
    const [pos] = computePositions(
      [
        tx('a', { quantity: 2, amountCents: 100_00 }),
        tx('b', { tradeDate: '2026-09-02', quantity: 2, amountCents: 140_00 }),
        tx('c', { tradeDate: '2026-09-03', kind: 'sell', quantity: 1, amountCents: 80_00 }),
      ],
      [cw8],
    );
    expect(pos!.quantity).toBe(3);
    expect(pos!.costCents).toBe(180_00); // 240 € × 3/4
    expect(pos!.realizedCents).toBe(20_00); // 80 € reçus − 60 € de coût
    expect(pos!.averageCost).toBe(60);
  });

  it('traite un achat et une vente le même jour dans le bon ordre', () => {
    const [pos] = computePositions(
      [tx('s', { kind: 'sell', quantity: 1, amountCents: 60_00 }), tx('b', { quantity: 1, amountCents: 50_00 })],
      [cw8],
    );
    expect(pos!.quantity).toBe(0);
    expect(pos!.realizedCents).toBe(10_00);
  });

  it('élimine les poussières de crypto après une vente totale', () => {
    const [pos] = computePositions(
      [
        tx('a', { assetId: 'btc', quantity: 0.1, amountCents: 5000_00 }),
        tx('b', { assetId: 'btc', quantity: 0.2, amountCents: 10000_00 }),
        tx('c', { assetId: 'btc', kind: 'sell', quantity: 0.3, amountCents: 16000_00, tradeDate: '2026-09-05' }),
      ],
      [btc],
    );
    expect(pos!.quantity).toBe(0);
    expect(pos!.costCents).toBe(0);
    expect(pos!.realizedCents).toBe(1000_00);
  });

  it('ignore les opérations supprimées', () => {
    const [pos] = computePositions([tx('a', { quantity: 1, amountCents: 10_00 }), tx('b', { quantity: 5, amountCents: 50_00, deleted: true })], [cw8]);
    expect(pos!.quantity).toBe(1);
  });
});

describe('valorisation', () => {
  it('convertit un cours en dollars avec le taux EUR/USD (1 € = 1,25 $)', () => {
    const prices = {
      'td:TTWO': { k: 'td:TTWO', p: 250, c: 'USD', chg: null, t: 0 },
      'fx:EUR/USD': { k: 'fx:EUR/USD', p: 1.25, c: 'USD', chg: null, t: 0 },
    };
    expect(priceInEur(ttwo, prices)?.price).toBe(200);
    expect(priceInEur(ttwo, { 'td:TTWO': prices['td:TTWO'] })).toBeNull();
  });

  it('calcule plus-value latente et variation du jour', () => {
    const positions = computePositions([tx('a', { quantity: 2, amountCents: 100_00 })], [cw8]);
    const [v] = valuePositions(positions, { 'yf:cw8': { k: 'yf:cw8', p: 55, c: 'EUR', chg: 10, t: 0 } });
    expect(v!.valueCents).toBe(110_00);
    expect(v!.unrealizedCents).toBe(10_00);
    expect(v!.dayChangeCents).toBe(10_00); // 110 € aujourd'hui, 100 € hier
  });
});

describe('synthèse', () => {
  it('mesure le gain par rapport à l’argent réellement versé', () => {
    const txs = [tx('a', { quantity: 2, amountCents: 90_00 })];
    const valued = valuePositions(computePositions(txs, [cw8]), { 'yf:cw8': { k: 'yf:cw8', p: 60, c: 'EUR', chg: null, t: 0 } });
    const s = summarize(valued, txs, [flow('f', '2026-09-01', 100_00)]);
    expect(s.cashCents).toBe(10_00);
    expect(s.totalCents).toBe(130_00);
    expect(s.gainCents).toBe(30_00);
    expect(s.gainPct).toBe(30);
    expect(s.contributionsEstimated).toBe(false);
  });

  it('estime les apports depuis les achats si aucun versement n’est saisi', () => {
    const txs = [tx('a', { quantity: 1, amountCents: 50_00 })];
    const valued = valuePositions(computePositions(txs, [cw8]), {});
    const s = summarize(valued, txs, []);
    expect(s.contributionsEstimated).toBe(true);
    expect(s.netContributionsCents).toBe(50_00);
    expect(s.gainCents).toBe(0); // sans cours : valorisé au prix d'achat
    expect(s.missingPrices).toEqual(['cw8']);
  });
});

describe('répartition et prochain versement', () => {
  const txs = [
    tx('a', { quantity: 1, amountCents: 300_00 }),
    tx('b', { assetId: 'btc', quantity: 1, amountCents: 100_00 }),
  ];
  const valued = valuePositions(computePositions(txs, [cw8, btc]), {});

  it('compare la répartition réelle à la cible', () => {
    const alloc = allocationByPocket(valued, profile);
    expect(alloc.find((a) => a.pocket === 'core')).toMatchObject({ actualPct: 75, targetPct: 50, driftPts: 25 });
    expect(alloc.find((a) => a.pocket === 'crypto')?.actualPct).toBe(25);
  });

  it('oriente le versement vers les poches en retard et totalise au centime près', () => {
    const split = nextContributionSplit(allocationByPocket(valued, profile), 100_00);
    expect(split.core).toBe(0);
    expect(split.crypto + split.themes + split.leverage).toBe(100_00);
    expect(split.themes).toBeGreaterThan(split.leverage);
  });

  it('redistribue la part d’une poche inactive (levier avant l’agent)', () => {
    const split = nextContributionSplit(allocationByPocket([], profile), 100_00, ['leverage']);
    expect(split.leverage).toBe(0);
    expect(split.core + split.crypto + split.themes).toBe(100_00);
    expect(Math.abs(split.core - 55_56)).toBeLessThanOrEqual(1); // 50 / 90 du versement, au centime près
  });

  it('suit simplement la cible sur un portefeuille vide', () => {
    const split = nextContributionSplit(allocationByPocket([], profile), 100_00);
    expect(split).toEqual({ core: 50_00, crypto: 25_00, themes: 15_00, leverage: 10_00 });
  });
});

describe('historique de valeur', () => {
  it('reprend la dernière clôture connue le week-end', () => {
    const points = valueHistory(
      [tx('a', { quantity: 2, amountCents: 100_00, tradeDate: '2026-09-25' })],
      [flow('f', '2026-09-25', 100_00)],
      [cw8],
      { 'yf:cw8': [{ day: '2026-09-25', close: 50 }, { day: '2026-09-28', close: 55 }] },
      '2026-09-28',
    );
    expect(points.map((p) => p.valueCents)).toEqual([100_00, 100_00, 100_00, 110_00]);
    expect(points.every((p) => p.contributedCents === 100_00)).toBe(true);
  });
});

describe('flux mensuels', () => {
  it('range versements, dividendes et frais par mois', () => {
    const rows = monthlyFlows(
      [flow('f1', '2026-08-03', 100_00), flow('f2', '2026-09-02', 100_00), flow('f3', '2026-09-20', -30_00)],
      [tx('d', { kind: 'dividend', amountCents: 2_50, tradeDate: '2026-09-15' }), tx('b', { amountCents: 50_00, feeCents: 1_00 })],
    );
    expect(rows).toEqual([
      { month: '2026-08', inCents: 100_00, outCents: 0 },
      { month: '2026-09', inCents: 102_50, outCents: 31_00 },
    ]);
  });
});

describe('saisie et affichage', () => {
  it('lit les montants à la française', () => {
    expect(parseEuros('12,5')).toBe(12_50);
    expect(parseEuros('1 234,56 €')).toBe(1234_56);
    expect(parseEuros('abc')).toBeNull();
    expect(parseQuantity('0,00031245')).toBe(0.00031245);
    expect(parseQuantity('0')).toBeNull();
  });
  it('affiche les montants en euros', () => {
    expect(formatEuros(1234_56).replace(/\s/g, ' ')).toBe('1 234,56 €');
    expect(formatEuros(5_00, { signed: true })).toMatch(/^\+5,00/);
  });
});
