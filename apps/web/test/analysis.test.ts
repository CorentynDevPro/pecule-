/** Moteur d'analyse : vérifications sur des cas dont on connaît la réponse. */
import { describe, expect, it } from 'vitest';
import {
  assetStats,
  backtestDca,
  cholesky,
  efficientFrontier,
  jointEstimates,
  maxDrawdown,
  monteCarlo,
  normal,
  rng,
  stdev,
  studentT,
  walkForward,
  type DailyClose,
} from '@pecule/shared';

/** Série quotidienne régulière (365 jours/an) à croissance constante. */
function geometric(days: number, start: number, annual: number, from = '2024-01-01'): DailyClose[] {
  const d0 = Date.parse(`${from}T00:00:00Z`);
  const daily = (1 + annual) ** (1 / 365);
  return Array.from({ length: days }, (_, i) => ({ day: new Date(d0 + i * 86_400_000).toISOString().slice(0, 10), close: start * daily ** i }));
}

function randomWalk(days: number, mu: number, sigma: number, seed: number): DailyClose[] {
  const g = normal(rng(seed));
  const d0 = Date.parse('2022-01-01T00:00:00Z');
  let x = 100;
  return Array.from({ length: days }, (_, i) => {
    if (i > 0) x *= Math.exp((mu - sigma * sigma / 2) / 365 + (sigma / Math.sqrt(365)) * g());
    return { day: new Date(d0 + i * 86_400_000).toISOString().slice(0, 10), close: x };
  });
}

describe('aléatoire', () => {
  it('est reproductible avec la même graine', () => {
    const a = rng(1);
    const b = rng(1);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
  it('produit une loi de Student de variance 1, aux queues plus épaisses que la normale', () => {
    const g = normal(rng(3));
    const t = studentT(g, 4);
    const xs = Array.from({ length: 200_000 }, t);
    expect(stdev(xs)).toBeGreaterThan(0.9);
    expect(stdev(xs)).toBeLessThan(1.1);
    const extreme = xs.filter((x) => Math.abs(x) > 4).length / xs.length;
    expect(extreme).toBeGreaterThan(0.0005); // une normale en donnerait ~0,006 %
  });
});

describe('statistiques', () => {
  it('retrouve le rendement annuel d’une série régulière', () => {
    const s = assetStats(geometric(731, 100, 0.1))!;
    expect(s.cagr).toBeCloseTo(0.1, 3);
    expect(s.volatility).toBeLessThan(1e-6);
    expect(s.maxDrawdown).toBe(0);
    expect(s.periodsPerYear).toBeCloseTo(365, -1);
  });
  it('mesure la pire baisse et ses dates', () => {
    expect(maxDrawdown([100, 120, 60, 90, 130]).depth).toBeCloseTo(-0.5);
    const series = [100, 120, 60, 90].map((close, i) => ({ day: `2026-01-0${i + 1}`, close }));
    const pad = Array.from({ length: 40 }, (_, i) => ({ day: `2026-02-${String(i % 28 + 1).padStart(2, '0')}`, close: 90 }));
    const s = assetStats([...series, ...pad.map((p, i) => ({ ...p, day: new Date(Date.UTC(2026, 1, 1 + i)).toISOString().slice(0, 10) }))])!;
    expect(s.maxDrawdown).toBeCloseTo(-0.5);
    expect(s.drawdownPeak).toBe('2026-01-02');
    expect(s.drawdownTrough).toBe('2026-01-03');
  });
  it('refuse de conclure sur moins de 30 jours', () => {
    expect(assetStats(geometric(20, 100, 0.1))).toBeNull();
  });
});

describe('Monte-Carlo', () => {
  it('sans volatilité, donne exactement l’épargne capitalisée', () => {
    const r = monteCarlo({ buckets: [{ name: 'x', weight: 1, mu: 0, sigma: 0 }], initialCents: 0, monthlyCents: 100_00, months: 12, paths: 50 });
    expect(r.final.p50).toBeCloseTo(1200_00, 0);
    expect(r.probLoss).toBe(0);
  });
  it('élargit la fourchette quand le risque augmente', () => {
    const base = { initialCents: 0, monthlyCents: 100_00, months: 60, paths: 4000, seed: 11 };
    const calm = monteCarlo({ ...base, buckets: [{ name: 'etf', weight: 1, mu: 0.07, sigma: 0.15 }] });
    const wild = monteCarlo({ ...base, buckets: [{ name: 'crypto', weight: 1, mu: 0.07, sigma: 0.65 }] });
    expect(wild.final.p90 - wild.final.p10).toBeGreaterThan(calm.final.p90 - calm.final.p10);
    expect(wild.probLoss).toBeGreaterThan(calm.probLoss);
    // Ordre de grandeur cohérent avec le cahier des charges : ~7 000 € médians pour 6 000 € versés
    expect(calm.final.p50 / 100).toBeGreaterThan(6600);
    expect(calm.final.p50 / 100).toBeLessThan(7600);
  });
  it('comptabilise les pertes totales d’un produit à levier', () => {
    const r = monteCarlo({
      buckets: [{ name: 'levier', weight: 1, mu: 0.15, sigma: 0.75, canBeWipedOut: true }],
      initialCents: 0, monthlyCents: 100_00, months: 60, paths: 3000, seed: 5, drawdownLimit: 0.3,
    });
    expect(r.probLoss).toBeGreaterThan(0.4);
    expect(r.probDrawdownBreach).toBeGreaterThan(0.9);
  });
  it('décompose une matrice de corrélation', () => {
    const l = cholesky([[1, 0.5], [0.5, 1]]);
    expect(l[1]![0]).toBeCloseTo(0.5);
    expect(l[1]![1]).toBeCloseTo(Math.sqrt(0.75));
  });
});

describe('frontière efficiente', () => {
  it('préfère l’actif au meilleur rendement par unité de risque', () => {
    const mu = [0.08, 0.08];
    const cov = [[0.04, 0], [0, 0.16]]; // mêmes rendements, le second deux fois plus volatil
    const { maxSharpe, minVol } = efficientFrontier(mu, cov, { samples: 3000 });
    expect(maxSharpe.weights[0]).toBeGreaterThan(0.6);
    expect(minVol.vol).toBeLessThan(0.2);
  });
  it('respecte un plafond par ligne', () => {
    const { points } = efficientFrontier([0.1, 0.05, 0.03], [[0.1, 0, 0], [0, 0.02, 0], [0, 0, 0.01]], { maxWeight: 0.6, samples: 2000 });
    expect(points.every((p) => p.weights.every((w) => w <= 0.6 + 1e-9))).toBe(true);
  });
  it('estime corrélations et covariances sur des dates communes', () => {
    const a = randomWalk(400, 0.1, 0.2, 1);
    const est = jointEstimates([a, a])!;
    expect(est.corr[0]![1]).toBeCloseTo(1, 5);
    expect(Math.sqrt(est.cov[0]![0]!)).toBeGreaterThan(0.12);
    expect(Math.sqrt(est.cov[0]![0]!)).toBeLessThan(0.28);
  });
});

describe('backtest', () => {
  it('investit chaque mois et retrouve le rendement d’un marché régulier', () => {
    const r = backtestDca(geometric(731, 100, 0.1), { sma: 0 }, { monthlyCents: 100_00, feeRate: 0 });
    expect(r.investedCents).toBe(2400_00); // 24 mois civils, du 1er janv. 2024 au 31 déc. 2025
    expect(r.finalCents).toBeGreaterThan(r.investedCents);
    expect(r.cagr).toBeCloseTo(0.1, 2);
  });
  it('le filtre de tendance sort du marché dans une chute prolongée', () => {
    const up = geometric(300, 100, 0.2);
    const last = up[up.length - 1]!.close;
    const down = geometric(300, last, -0.5, '2024-10-27').slice(1);
    const series = [...up, ...down];
    const simple = backtestDca(series, { sma: 0 }, { monthlyCents: 100_00, feeRate: 0.002 });
    const filtered = backtestDca(series, { sma: 50 }, { monthlyCents: 100_00, feeRate: 0.002 });
    expect(filtered.finalCents).toBeGreaterThan(simple.finalCents);
    expect(filtered.maxDrawdown).toBeGreaterThan(simple.maxDrawdown);
  });
  it('juge une stratégie sur des périodes qu’elle n’a jamais vues', () => {
    const wf = walkForward(randomWalk(900, 0.05, 0.4, 9), { monthlyCents: 100_00 })!;
    expect(wf.folds.length).toBeGreaterThanOrEqual(6);
    for (const f of wf.folds) expect(f.testFrom > f.trainFrom).toBe(true);
    expect(['better', 'worse', 'inconclusive']).toContain(wf.verdict);
  });
});
