/**
 * Moteur d'analyse — fonctions pures, déterministes (générateur aléatoire à graine),
 * utilisables sur l'appareil comme sur la tour.
 *
 * Aucune de ces méthodes ne prédit l'avenir : elles décrivent ce qui s'est passé
 * (statistiques, backtests) ou la dispersion des futurs possibles sous des hypothèses
 * explicites (Monte-Carlo). Les hypothèses sont toujours renvoyées avec les résultats.
 */
import type { DailyClose } from './prices.js';

// --- Aléatoire reproductible ----------------------------------------------------------

/** Générateur mulberry32 : même graine, mêmes tirages, donc résultats vérifiables. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function normal(rand: () => number): () => number {
  let spare: number | null = null;
  return () => {
    if (spare !== null) {
      const s = spare;
      spare = null;
      return s;
    }
    let u = 0;
    while (u === 0) u = rand();
    const v = rand();
    const r = Math.sqrt(-2 * Math.log(u));
    spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  };
}

/**
 * Loi de Student à `df` degrés de liberté, ramenée à une variance de 1.
 * Ses « queues épaisses » produisent plus souvent des mouvements extrêmes qu'une loi normale,
 * ce qui colle mieux aux krachs réels.
 */
export function studentT(gauss: () => number, df: number): () => number {
  const scale = Math.sqrt((df - 2) / df);
  return () => {
    let chi2 = 0;
    for (let i = 0; i < df; i++) {
      const g = gauss();
      chi2 += g * g;
    }
    return (gauss() / Math.sqrt(chi2 / df)) * scale;
  };
}

// --- Statistiques descriptives -------------------------------------------------------

export interface AssetStats {
  days: number;
  years: number;
  /** Rendement annualisé composé (CAGR) */
  cagr: number;
  /** Volatilité annualisée des rendements quotidiens */
  volatility: number;
  /** (rendement − taux sans risque) / volatilité */
  sharpe: number | null;
  /** Comme Sharpe, mais ne pénalise que les baisses */
  sortino: number | null;
  /** Pire baisse depuis un sommet (négative), et ses dates */
  maxDrawdown: number;
  drawdownPeak: string | null;
  drawdownTrough: string | null;
  /** Nombre de clôtures par an observé (≈ 252 en bourse, 365 en crypto) */
  periodsPerYear: number;
}

export function logReturns(closes: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const a = closes[i - 1]!;
    const b = closes[i]!;
    if (a > 0 && b > 0) out.push(Math.log(b / a));
  }
  return out;
}

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
}

export function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

export function maxDrawdown(values: number[]): { depth: number; peakIndex: number; troughIndex: number } {
  let peak = values[0] ?? 0;
  let peakIndex = 0;
  let best = { depth: 0, peakIndex: 0, troughIndex: 0 };
  values.forEach((v, i) => {
    if (v > peak) {
      peak = v;
      peakIndex = i;
    }
    const dd = peak > 0 ? v / peak - 1 : 0;
    if (dd < best.depth) best = { depth: dd, peakIndex, troughIndex: i };
  });
  return best;
}

export function assetStats(series: DailyClose[], riskFree = 0.02): AssetStats | null {
  const clean = series.filter((c) => c.close > 0);
  if (clean.length < 30) return null;
  const first = clean[0]!;
  const last = clean[clean.length - 1]!;
  const years = (Date.parse(last.day) - Date.parse(first.day)) / (365.25 * 86_400_000);
  if (years <= 0) return null;
  const closes = clean.map((c) => c.close);
  const rets = logReturns(closes);
  const periodsPerYear = rets.length / years;
  const volatility = stdev(rets) * Math.sqrt(periodsPerYear);
  const cagr = (last.close / first.close) ** (1 / years) - 1;
  const downside = rets.filter((r) => r < 0);
  const downVol = Math.sqrt(downside.reduce((s, r) => s + r * r, 0) / Math.max(rets.length, 1)) * Math.sqrt(periodsPerYear);
  const dd = maxDrawdown(closes);
  return {
    days: clean.length,
    years,
    cagr,
    volatility,
    sharpe: volatility > 0 ? (cagr - riskFree) / volatility : null,
    sortino: downVol > 0 ? (cagr - riskFree) / downVol : null,
    maxDrawdown: dd.depth,
    drawdownPeak: clean[dd.peakIndex]?.day ?? null,
    drawdownTrough: clean[dd.troughIndex]?.day ?? null,
    periodsPerYear,
  };
}

// --- Monte-Carlo ---------------------------------------------------------------------

export interface Bucket {
  /** Nom affiché */
  name: string;
  /** Part du portefeuille, entre 0 et 1 */
  weight: number;
  /** Rendement annuel moyen attendu (arithmétique) */
  mu: number;
  /** Volatilité annuelle */
  sigma: number;
  /** Vrai si la poche peut tomber à zéro (produits à levier à barrière) */
  canBeWipedOut?: boolean;
}

export interface MonteCarloInput {
  buckets: Bucket[];
  /** Matrice de corrélation entre poches (identité si absente) */
  correlation?: number[][];
  initialCents: number;
  monthlyCents: number;
  months: number;
  paths?: number;
  seed?: number;
  /** Degrés de liberté de la loi de Student (4 = queues épaisses) */
  df?: number;
  /** Rééquilibrage mensuel vers les poids cibles */
  rebalance?: boolean;
  /** Seuil de baisse depuis un sommet à surveiller (ex. 0.3 pour −30 %) */
  drawdownLimit?: number;
}

export interface MonteCarloResult {
  months: number;
  paths: number;
  /** Percentiles de valeur à chaque mois (index 0 = départ), en centimes */
  bands: { p10: number[]; p25: number[]; p50: number[]; p75: number[]; p90: number[] };
  invested: number[];
  finalValues: number[];
  final: { p5: number; p10: number; p50: number; p90: number; p95: number; mean: number };
  totalInvestedCents: number;
  /** Probabilité de finir avec moins que l'argent versé */
  probLoss: number;
  /** Probabilité de subir, en chemin, une baisse plus forte que drawdownLimit */
  probDrawdownBreach: number | null;
  medianMaxDrawdown: number;
}

/** Décomposition de Cholesky d'une matrice de corrélation (supposée définie positive). */
export function cholesky(m: number[][]): number[][] {
  const n = m.length;
  const l = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = m[i]![j]!;
      for (let k = 0; k < j; k++) sum -= l[i]![k]! * l[j]![k]!;
      if (i === j) {
        l[i]![i] = Math.sqrt(Math.max(sum, 1e-12));
      } else {
        l[i]![j] = sum / l[j]![j]!;
      }
    }
  }
  return l;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo);
}

export function monteCarlo(input: MonteCarloInput): MonteCarloResult {
  const paths = input.paths ?? 10_000;
  const months = input.months;
  const n = input.buckets.length;
  const totalWeight = input.buckets.reduce((s, b) => s + b.weight, 0) || 1;
  const weights = input.buckets.map((b) => b.weight / totalWeight);
  const corr = input.correlation ?? input.buckets.map((_, i) => input.buckets.map((__, j) => (i === j ? 1 : 0)));
  const chol = cholesky(corr);
  const gauss = normal(rng(input.seed ?? 42));
  const shock = studentT(gauss, input.df ?? 4);
  const dt = 1 / 12;
  // Dérive logarithmique mensuelle : μ − σ²/2 (le rendement moyen arithmétique n'est pas celui qu'on compose)
  const drift = input.buckets.map((b) => (b.mu - (b.sigma * b.sigma) / 2) * dt);
  const vol = input.buckets.map((b) => b.sigma * Math.sqrt(dt));

  const snapshot = Array.from({ length: months + 1 }, () => new Float64Array(paths));
  const finalValues: number[] = new Array(paths);
  const maxDds = new Float64Array(paths);
  let breaches = 0;
  const z = new Array<number>(n).fill(0);
  const e = new Array<number>(n).fill(0);

  for (let p = 0; p < paths; p++) {
    const holdings = weights.map((w) => (input.initialCents * w));
    let total = input.initialCents;
    let peak = total;
    let worst = 0;
    snapshot[0]![p] = total;
    for (let m = 1; m <= months; m++) {
      // Versement du mois, réparti selon les poids cibles
      for (let i = 0; i < n; i++) holdings[i]! += input.monthlyCents * weights[i]!;
      for (let i = 0; i < n; i++) z[i] = shock();
      for (let i = 0; i < n; i++) {
        let s = 0;
        for (let k = 0; k <= i; k++) s += chol[i]![k]! * z[k]!;
        e[i] = s;
      }
      total = 0;
      for (let i = 0; i < n; i++) {
        const factor = Math.exp(drift[i]! + vol[i]! * e[i]!);
        // Produit à levier : une chute de plus de 80 % dans le mois déclenche la barrière, perte totale
        const h = input.buckets[i]!.canBeWipedOut && factor < 0.2 ? 0 : holdings[i]! * factor;
        holdings[i] = h;
        total += h;
      }
      if (input.rebalance !== false && total > 0) {
        for (let i = 0; i < n; i++) holdings[i] = total * weights[i]!;
      }
      snapshot[m]![p] = total;
      if (total > peak) peak = total;
      const dd = peak > 0 ? total / peak - 1 : 0;
      if (dd < worst) worst = dd;
    }
    finalValues[p] = total;
    maxDds[p] = worst;
    if (input.drawdownLimit !== undefined && worst <= -input.drawdownLimit) breaches++;
  }

  const bands = { p10: [] as number[], p25: [] as number[], p50: [] as number[], p75: [] as number[], p90: [] as number[] };
  const invested: number[] = [];
  for (let m = 0; m <= months; m++) {
    const sorted = Array.from(snapshot[m]!).sort((a, b) => a - b);
    bands.p10.push(percentile(sorted, 0.1));
    bands.p25.push(percentile(sorted, 0.25));
    bands.p50.push(percentile(sorted, 0.5));
    bands.p75.push(percentile(sorted, 0.75));
    bands.p90.push(percentile(sorted, 0.9));
    invested.push(input.initialCents + input.monthlyCents * m);
  }
  const sortedFinal = [...finalValues].sort((a, b) => a - b);
  const totalInvestedCents = input.initialCents + input.monthlyCents * months;
  const sortedDd = Array.from(maxDds).sort((a, b) => a - b);
  return {
    months,
    paths,
    bands,
    invested,
    finalValues,
    final: {
      p5: percentile(sortedFinal, 0.05),
      p10: percentile(sortedFinal, 0.1),
      p50: percentile(sortedFinal, 0.5),
      p90: percentile(sortedFinal, 0.9),
      p95: percentile(sortedFinal, 0.95),
      mean: mean(finalValues),
    },
    totalInvestedCents,
    probLoss: finalValues.filter((v) => v < totalInvestedCents).length / paths,
    probDrawdownBreach: input.drawdownLimit === undefined ? null : breaches / paths,
    medianMaxDrawdown: percentile(sortedDd, 0.5),
  };
}

// --- Frontière efficiente (Markowitz) -------------------------------------------------

export interface PortfolioPoint {
  weights: number[];
  ret: number;
  vol: number;
  sharpe: number;
}

/** Rendement et risque annuels d'un portefeuille, à partir des rendements et covariances annuels. */
export function portfolioPoint(weights: number[], mu: number[], cov: number[][], riskFree: number): PortfolioPoint {
  const ret = weights.reduce((s, w, i) => s + w * mu[i]!, 0);
  let variance = 0;
  for (let i = 0; i < weights.length; i++) for (let j = 0; j < weights.length; j++) variance += weights[i]! * weights[j]! * cov[i]![j]!;
  const vol = Math.sqrt(Math.max(variance, 0));
  return { weights, ret, vol, sharpe: vol > 0 ? (ret - riskFree) / vol : 0 };
}

/**
 * Explore des milliers de répartitions possibles (sans vente à découvert, avec un plafond
 * par ligne) et garde la meilleure en rendement par unité de risque.
 */
export function efficientFrontier(
  mu: number[],
  cov: number[][],
  opts: { samples?: number; seed?: number; riskFree?: number; maxWeight?: number } = {},
): { points: PortfolioPoint[]; maxSharpe: PortfolioPoint; minVol: PortfolioPoint } {
  const n = mu.length;
  const rand = rng(opts.seed ?? 7);
  const riskFree = opts.riskFree ?? 0.02;
  const maxWeight = opts.maxWeight ?? 1;
  const points: PortfolioPoint[] = [];
  const samples = opts.samples ?? 5000;
  for (let s = 0; s < samples; s++) {
    // Tirage uniforme sur le simplexe (loi de Dirichlet de paramètre 1)
    let w = Array.from({ length: n }, () => -Math.log(1 - rand()));
    let sum = w.reduce((a, b) => a + b, 0);
    w = w.map((x) => x / sum);
    if (w.some((x) => x > maxWeight + 1e-9)) continue;
    points.push(portfolioPoint(w, mu, cov, riskFree));
  }
  // Coins du simplexe : chaque actif seul, si le plafond le permet
  if (maxWeight >= 1) {
    for (let i = 0; i < n; i++) points.push(portfolioPoint(Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)), mu, cov, riskFree));
  }
  const maxSharpe = points.reduce((a, b) => (b.sharpe > a.sharpe ? b : a), points[0]!);
  const minVol = points.reduce((a, b) => (b.vol < a.vol ? b : a), points[0]!);
  return { points, maxSharpe, minVol };
}

/**
 * Aligne plusieurs séries de clôtures sur leurs dates communes et renvoie
 * rendements moyens annuels, covariance annuelle et corrélations.
 */
export function jointEstimates(seriesList: DailyClose[][]): { mu: number[]; cov: number[][]; corr: number[][]; days: number } | null {
  if (seriesList.length === 0) return null;
  const maps = seriesList.map((s) => new Map(s.map((c) => [c.day, c.close])));
  const common = [...maps[0]!.keys()].filter((d) => maps.every((m) => m.has(d))).sort();
  if (common.length < 60) return null;
  const rets = maps.map((m) => logReturns(common.map((d) => m.get(d)!)));
  const years = (Date.parse(common[common.length - 1]!) - Date.parse(common[0]!)) / (365.25 * 86_400_000);
  const ppy = rets[0]!.length / years;
  const means = rets.map(mean);
  const n = rets.length;
  const cov = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const len = rets[0]!.length;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let s = 0;
      for (let t = 0; t < len; t++) s += (rets[i]![t]! - means[i]!) * (rets[j]![t]! - means[j]!);
      cov[i]![j] = (s / (len - 1)) * ppy;
    }
  }
  const corr = cov.map((row, i) => row.map((v, j) => v / Math.sqrt(cov[i]![i]! * cov[j]![j]!)));
  // Rendement arithmétique annuel ≈ moyenne des log-rendements + variance / 2
  const mu = means.map((m, i) => m * ppy + cov[i]![i]! / 2);
  return { mu, cov, corr, days: common.length };
}

// --- Backtest walk-forward -------------------------------------------------------------

export interface BacktestResult {
  label: string;
  finalCents: number;
  investedCents: number;
  /** Rendement annualisé pondéré par le temps (neutralise l'effet des versements) */
  cagr: number;
  maxDrawdown: number;
  /** Nombre d'achats et de ventes */
  trades: number;
  curve: { day: string; valueCents: number }[];
}

export interface StrategyParams {
  /** Moyenne mobile du filtre de tendance, en jours ; 0 = pas de filtre (achat simple) */
  sma: number;
}

function sma(values: number[], n: number, i: number): number | null {
  if (n <= 0 || i + 1 < n) return null;
  let s = 0;
  for (let k = i - n + 1; k <= i; k++) s += values[k]!;
  return s / n;
}

/**
 * Investissement programmé : versement le premier jour de bourse de chaque mois.
 * Avec filtre de tendance : investi quand le cours est au-dessus de sa moyenne mobile,
 * en liquidités sinon. Les frais s'appliquent à chaque achat et chaque vente.
 */
export function backtestDca(
  series: DailyClose[],
  params: StrategyParams,
  opts: { monthlyCents: number; feeRate?: number; from?: number; to?: number; warmup?: number[] },
): BacktestResult {
  const feeRate = opts.feeRate ?? 0.002;
  const from = opts.from ?? 0;
  const to = opts.to ?? series.length;
  const closes = series.map((c) => c.close);
  let units = 0;
  let cash = 0;
  let invested = 0;
  let trades = 0;
  let lastMonth = '';
  let prevValue = 0;
  let twr = 1;
  const curve: { day: string; valueCents: number }[] = [];
  for (let i = from; i < to; i++) {
    const { day, close } = series[i]!;
    const month = day.slice(0, 7);
    // Rendement pondéré par le temps : la variation du jour, hors versement, rapportée à la veille
    const marked = cash + units * close;
    if (prevValue > 0) twr *= marked / prevValue;
    if (month !== lastMonth) {
      cash += opts.monthlyCents;
      invested += opts.monthlyCents;
      lastMonth = month;
    }
    const avg = sma(closes, params.sma, i);
    const inTrend = params.sma === 0 || avg === null || close >= avg;
    if (inTrend && cash > 0) {
      units += (cash * (1 - feeRate)) / close;
      cash = 0;
      trades++;
    } else if (!inTrend && units > 0) {
      cash += units * close * (1 - feeRate);
      units = 0;
      trades++;
    }
    prevValue = cash + units * close;
    curve.push({ day, valueCents: Math.round(prevValue) });
  }
  const values = curve.map((c) => c.valueCents);
  const final = values[values.length - 1] ?? 0;
  const years = curve.length > 1 ? (Date.parse(curve[curve.length - 1]!.day) - Date.parse(curve[0]!.day)) / (365.25 * 86_400_000) : 0;
  const cagr = years > 0 ? twr ** (1 / years) - 1 : 0;
  return {
    label: params.sma === 0 ? 'Achat programmé simple' : `Achat programmé + filtre ${params.sma} j`,
    finalCents: final,
    investedCents: invested,
    cagr,
    maxDrawdown: maxDrawdown(values).depth,
    trades,
    curve,
  };
}

export interface WalkForwardFold {
  trainFrom: string;
  testFrom: string;
  testTo: string;
  chosenSma: number;
  strategyGain: number;
  baselineGain: number;
}

export interface WalkForwardResult {
  folds: WalkForwardFold[];
  /** Part des périodes de test où la stratégie a fait mieux que l'achat simple */
  winRate: number;
  strategyGainAvg: number;
  baselineGainAvg: number;
  verdict: 'better' | 'worse' | 'inconclusive';
}

/**
 * Validation « hors échantillon » : on choisit le paramètre sur une période passée,
 * puis on le juge sur la période suivante, qu'il n'a jamais vue. On répète en glissant.
 */
export function walkForward(
  series: DailyClose[],
  opts: { monthlyCents: number; grid?: number[]; trainDays?: number; testDays?: number; feeRate?: number },
): WalkForwardResult | null {
  const grid = opts.grid ?? [20, 50, 100, 200];
  const trainDays = opts.trainDays ?? 250;
  const testDays = opts.testDays ?? 90;
  const folds: WalkForwardFold[] = [];
  const gain = (r: BacktestResult) => (r.investedCents > 0 ? r.finalCents / r.investedCents - 1 : 0);
  for (let start = 0; start + trainDays + testDays <= series.length; start += testDays) {
    const trainEnd = start + trainDays;
    const testEnd = trainEnd + testDays;
    let best = grid[0]!;
    let bestGain = -Infinity;
    for (const n of grid) {
      const g = gain(backtestDca(series, { sma: n }, { ...opts, from: start, to: trainEnd }));
      if (g > bestGain) {
        bestGain = g;
        best = n;
      }
    }
    const strat = backtestDca(series, { sma: best }, { ...opts, from: trainEnd, to: testEnd });
    const base = backtestDca(series, { sma: 0 }, { ...opts, from: trainEnd, to: testEnd });
    folds.push({
      trainFrom: series[start]!.day,
      testFrom: series[trainEnd]!.day,
      testTo: series[testEnd - 1]!.day,
      chosenSma: best,
      strategyGain: gain(strat),
      baselineGain: gain(base),
    });
  }
  if (folds.length === 0) return null;
  const wins = folds.filter((f) => f.strategyGain > f.baselineGain).length;
  const winRate = wins / folds.length;
  const strategyGainAvg = mean(folds.map((f) => f.strategyGain));
  const baselineGainAvg = mean(folds.map((f) => f.baselineGain));
  const verdict = folds.length < 3 ? 'inconclusive' : winRate >= 0.6 && strategyGainAvg > baselineGainAvg ? 'better' : winRate <= 0.4 || strategyGainAvg < baselineGainAvg ? 'worse' : 'inconclusive';
  return { folds, winRate, strategyGainAvg, baselineGainAvg, verdict };
}

// --- Hypothèses par défaut ------------------------------------------------------------

/**
 * Hypothèses de long terme utilisées quand l'historique est trop court.
 * Ce sont des ordres de grandeur prudents, pas des prévisions.
 */
export const DEFAULT_HYPOTHESES = {
  core: { mu: 0.07, sigma: 0.15 },
  crypto: { mu: 0.15, sigma: 0.65 },
  themes: { mu: 0.08, sigma: 0.3 },
  // Levier ×5 sur un indice, financé à environ 4 % l'an : espérance modeste, risque de perte totale
  leverage: { mu: 0.15, sigma: 0.75 },
} as const;

/** Corrélations par défaut entre poches, dans l'ordre socle, crypto, thèmes, levier. */
export const DEFAULT_CORRELATION: number[][] = [
  [1, 0.3, 0.75, 0.9],
  [0.3, 1, 0.3, 0.3],
  [0.75, 0.3, 1, 0.7],
  [0.9, 0.3, 0.7, 1],
];

/**
 * Mélange une estimation historique avec l'hypothèse par défaut. Un ou deux ans d'historique
 * donnent des rendements très bruités : plus l'historique est court, plus on reste proche du défaut.
 */
export function blendEstimate(historical: number, fallback: number, years: number, fullTrustYears = 10): number {
  const w = Math.max(0, Math.min(1, years / fullTrustYears));
  return w * historical + (1 - w) * fallback;
}
