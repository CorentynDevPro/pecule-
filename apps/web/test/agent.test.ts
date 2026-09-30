/** Agent : signaux, backtest des règles, contrôle de risque, sorties et bilan d'entraînement. */
import { describe, expect, it } from 'vitest';
import {
  AGENT_LIMITS,
  backtestRule,
  evaluateProposal,
  exitDecision,
  signalAt,
  tradePnlCents,
  trainingStatus,
  type AgentTrade,
  type DailyClose,
  type RuleStats,
} from '@pecule/shared';

const days = (closes: number[]): DailyClose[] =>
  closes.map((close, i) => ({ day: new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10), close }));

/** Hausse régulière avec une légère respiration : de nombreuses cassures de plus haut */
const uptrend = Array.from({ length: 300 }, (_, i) => 100 * 1.004 ** i * (1 + 0.01 * Math.sin(i / 3)));

const goodStats: RuleStats = { samples: 12, winRate: 0.6, expectancy: 0.01, avgWin: 0.03, avgLoss: -0.02, stable: true };

const trade = (over: Partial<AgentTrade>): AgentTrade => ({
  id: '11111111-1111-4111-8111-111111111111', updatedAt: '2026-09-30T08:00:00.000Z', deleted: false,
  quoteKey: 'kraken:BTC/EUR', assetName: 'Bitcoin', currency: 'EUR', mode: 'paper', signal: 'trend', status: 'open',
  reason: '', entryPrice: 100, stopPrice: 90, targetPrice: 115, quantity: 1, stakeCents: 100_00, leverage: 1,
  backtestWinRate: 0.6, backtestExpectancyPct: 1, backtestSamples: 10, proposedAt: '2026-09-01T08:00:00.000Z',
  openedAt: '2026-09-01T08:00:00.000Z', closedAt: null, exitPrice: null, pnlCents: null, exitReason: null, ...over,
});

describe('signaux', () => {
  it('détecte une cassure en tendance haussière, avec stop sous l’entrée et objectif au-dessus', () => {
    const i = 200;
    const sig = signalAt(uptrend, i, Math.max(...uptrend.slice(i - 20, i)) * 1.01, 'trend');
    expect(sig).not.toBeNull();
    expect(sig!.stop).toBeLessThan(sig!.entry);
    expect(sig!.target).toBeGreaterThan(sig!.entry);
    expect(sig!.target - sig!.entry).toBeCloseTo(1.5 * (sig!.entry - sig!.stop)); // 3 ATR contre 2 ATR
  });
  it('ne voit pas de retour à la moyenne sans excès à la baisse', () => {
    expect(signalAt(uptrend, 200, uptrend[200]!, 'reversion')).toBeNull();
  });
  it('détecte un excès à la baisse', () => {
    const closes = [...Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i)), 88];
    expect(signalAt(closes, 60, 88, 'reversion')?.target).toBeGreaterThan(88);
  });
});

describe('backtest des règles', () => {
  it('trouve la règle de tendance gagnante et stable sur une tendance régulière', () => {
    const stats = backtestRule(days(uptrend), 'trend');
    expect(stats.samples).toBeGreaterThanOrEqual(AGENT_LIMITS.minSamples);
    expect(stats.expectancy).toBeGreaterThan(0);
    expect(stats.stable).toBe(true);
  });
  it('la même règle perd dans une tendance baissière et n’est pas retenue', () => {
    const down = uptrend.map((_, i) => 100 * 0.996 ** i * (1 + 0.03 * Math.sin(i / 2)));
    const stats = backtestRule(days(down), 'trend');
    expect(stats.stable).toBe(false);
  });
});

describe('contrôle de risque', () => {
  const sig = { kind: 'trend' as const, entry: 100, stop: 95, target: 107.5, atr: 2.5, why: '' };
  const ctx = { capitalCents: 1000_00, isCrypto: true, priceEur: 100, openTrades: [], monthRealizedPnlCents: 0, quoteKey: 'kraken:BTC/EUR' };

  it('dimensionne la position pour perdre au plus 2 % du capital au stop', () => {
    const p = evaluateProposal(sig, goodStats, ctx);
    expect(p.riskCents).toBeLessThanOrEqual(20_00);
    expect(p.riskCents).toBeGreaterThan(19_00);
    expect(p.rewardCents).toBeGreaterThan(p.riskCents);
    expect(p.accepted).toBe(true);
  });
  it('plafonne le levier crypto à 2', () => {
    const tight = { ...sig, stop: 99.5, target: 100.75 }; // stop très serré : exposition idéale énorme
    const p = evaluateProposal(tight, goodStats, ctx);
    expect(p.leverage).toBeLessThanOrEqual(2);
    expect(p.stakeCents * p.leverage).toBeLessThanOrEqual(2000_00 + 1);
  });
  it('refuse une règle instable, un doublon, ou après le coupe-circuit', () => {
    expect(evaluateProposal(sig, { ...goodStats, stable: false }, ctx).accepted).toBe(false);
    expect(evaluateProposal(sig, goodStats, { ...ctx, openTrades: [trade({})] }).accepted).toBe(false);
    expect(evaluateProposal(sig, goodStats, { ...ctx, monthRealizedPnlCents: -250_00 }).accepted).toBe(false);
  });
});

describe('sorties et résultats', () => {
  it('ferme au stop, à l’objectif, ou au bout de 20 jours', () => {
    const t = trade({});
    const opened = Date.parse(t.openedAt!);
    expect(exitDecision(t, 89, opened + 1000)).toBe('stop');
    expect(exitDecision(t, 116, opened + 1000)).toBe('target');
    expect(exitDecision(t, 100, opened + 21 * 86_400_000)).toBe('time');
    expect(exitDecision(t, 100, opened + 1000)).toBeNull();
  });
  it('calcule le résultat avec levier et frais, sans jamais perdre plus que la mise', () => {
    expect(tradePnlCents(trade({ leverage: 2 }), 110)).toBe(Math.round(200_00 * (0.1 - 0.004)));
    expect(tradePnlCents(trade({ leverage: 5 }), 50)).toBe(-100_00);
  });
});

describe('bilan d’entraînement', () => {
  it('n’autorise l’argent réel qu’après 90 jours, 10 opérations et un résultat meilleur que l’ETF monde', () => {
    const start = Date.parse('2026-06-01T00:00:00Z');
    const closed = Array.from({ length: 10 }, (_, i) => trade({ id: `11111111-1111-4111-8111-1111111111${10 + i}`, status: 'closed', pnlCents: 5_00, openedAt: new Date(start + i * 86_400_000).toISOString() }));
    const early = trainingStatus(closed, start + 30 * 86_400_000, 10_00);
    expect(early.ready).toBe(false);
    expect(early.missing[0]).toMatch(/jours/);
    const later = trainingStatus(closed, start + 95 * 86_400_000, 10_00);
    expect(later.ready).toBe(true);
    expect(trainingStatus(closed, start + 95 * 86_400_000, 80_00).ready).toBe(false); // l'ETF a fait mieux
  });
});
