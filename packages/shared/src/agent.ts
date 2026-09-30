/**
 * Agent de trading — logique pure (aucun accès réseau ni base).
 *
 * 1. Deux règles de signal, simples et connues :
 *    - tendance (cassure) : le cours dépasse son plus haut des 20 derniers jours, et la
 *      moyenne 20 jours est au-dessus de la moyenne 50 jours ;
 *    - retour à la moyenne : le cours s'écarte de plus de 2 écarts-types sous sa moyenne 20 jours.
 * 2. Chaque règle est rejouée sur l'historique de l'actif : combien de fois elle s'est déclenchée,
 *    combien de fois l'objectif a été touché avant le stop, gain moyen net de frais.
 *    Elle n'est retenue que si elle a gagné sur chacune des deux moitiés de l'historique.
 * 3. Le contrôle de risque fixe la taille de la position (perte au stop ≤ 2 % du capital)
 *    et refuse tout ce qui dépasse les limites.
 */
import type { AgentTrade } from './entities.js';
import type { DailyClose } from './prices.js';

export type SignalKind = 'trend' | 'reversion';

export interface Signal {
  kind: SignalKind;
  entry: number;
  stop: number;
  target: number;
  /** Mouvement moyen quotidien (substitut de l'ATR, calculé sur les clôtures) */
  atr: number;
  why: string;
}

export interface RuleStats {
  samples: number;
  winRate: number;
  /** Gain moyen par opération, net de frais, en fraction de la mise (0,012 = +1,2 %) */
  expectancy: number;
  avgWin: number;
  avgLoss: number;
  /** La règle a gagné sur la première ET la seconde moitié de l'historique */
  stable: boolean;
}

export const AGENT_LIMITS = {
  /** Perte maximale au stop, en fraction du capital d'entraînement */
  riskPerTrade: 0.02,
  maxOpenPositions: 3,
  /** Levier maximal de l'agent, et plafond réglementaire sur la crypto */
  maxLeverage: 5,
  maxLeverageCrypto: 2,
  /** Coupe-circuit : l'agent s'arrête si ses pertes du mois dépassent 20 % du capital */
  monthlyLossLimit: 0.2,
  /** Durée maximale d'une position, en jours */
  maxHoldDays: 20,
  /** Durée de validité d'une proposition, en minutes */
  proposalTtlMinutes: 120,
  /** Frais estimés par ordre (achat ou vente) */
  feeRate: 0.002,
  minSamples: 5,
  /** Entraînement exigé avant l'argent réel */
  trainingDays: 90,
  minClosedTrades: 10,
} as const;

function smaAt(xs: number[], n: number, i: number): number | null {
  if (i + 1 < n) return null;
  let s = 0;
  for (let k = i - n + 1; k <= i; k++) s += xs[k]!;
  return s / n;
}

function stdAt(xs: number[], n: number, i: number): number | null {
  const m = smaAt(xs, n, i);
  if (m === null) return null;
  let s = 0;
  for (let k = i - n + 1; k <= i; k++) s += (xs[k]! - m) ** 2;
  return Math.sqrt(s / (n - 1));
}

function atrAt(xs: number[], i: number, n = 14): number | null {
  if (i < n) return null;
  let s = 0;
  for (let k = i - n + 1; k <= i; k++) s += Math.abs(xs[k]! - xs[k - 1]!);
  return s / n;
}

/**
 * Signal au jour `i` d'une série de clôtures, en supposant une entrée au cours `price`
 * (le dernier cours en direct, ou la clôture du jour pour les backtests).
 */
export function signalAt(closes: number[], i: number, price: number, kind: SignalKind): Signal | null {
  const atr = atrAt(closes, i);
  if (atr === null || atr <= 0) return null;
  if (kind === 'trend') {
    const sma20 = smaAt(closes, 20, i);
    const sma50 = smaAt(closes, 50, i);
    if (sma20 === null || sma50 === null || i < 21) return null;
    let high = -Infinity;
    for (let k = i - 20; k < i; k++) high = Math.max(high, closes[k]!);
    if (!(price > high && sma20 > sma50)) return null;
    return {
      kind,
      entry: price,
      stop: price - 2 * atr,
      target: price + 3 * atr,
      atr,
      why: `Le cours dépasse son plus haut des 20 derniers jours, et la tendance de fond est haussière (moyenne 20 jours au-dessus de la moyenne 50 jours).`,
    };
  }
  const sma20 = smaAt(closes, 20, i);
  const sd = stdAt(closes, 20, i);
  if (sma20 === null || sd === null || sd <= 0) return null;
  const z = (price - sma20) / sd;
  if (z > -2) return null;
  return {
    kind,
    entry: price,
    stop: price - 1.5 * atr,
    target: sma20,
    atr,
    why: `Le cours est tombé à ${Math.abs(z).toFixed(1).replace('.', ',')} écarts-types sous sa moyenne 20 jours : un tel excès s’est souvent résorbé.`,
  };
}

/** Rejoue une règle sur l'historique : entrée à la clôture du signal, sortie au stop, à l'objectif ou au bout de 20 jours. */
export function backtestRule(series: DailyClose[], kind: SignalKind): RuleStats {
  const closes = series.map((c) => c.close);
  const results: { index: number; ret: number }[] = [];
  let i = 50;
  while (i < closes.length - 1) {
    const sig = signalAt(closes, i, closes[i]!, kind);
    if (!sig) {
      i++;
      continue;
    }
    let exit = closes[Math.min(i + AGENT_LIMITS.maxHoldDays, closes.length - 1)]!;
    let j = i + 1;
    for (; j <= Math.min(i + AGENT_LIMITS.maxHoldDays, closes.length - 1); j++) {
      // On ne connaît que les clôtures : un stop et un objectif touchés le même jour comptent comme un stop (prudence)
      if (closes[j]! <= sig.stop) {
        exit = sig.stop;
        break;
      }
      if (closes[j]! >= sig.target) {
        exit = sig.target;
        break;
      }
    }
    results.push({ index: i, ret: exit / sig.entry - 1 - 2 * AGENT_LIMITS.feeRate });
    i = j + 1; // pas de positions qui se chevauchent
  }
  const summarize = (rs: { ret: number }[]) => {
    const wins = rs.filter((r) => r.ret > 0);
    const losses = rs.filter((r) => r.ret <= 0);
    return {
      samples: rs.length,
      winRate: rs.length ? wins.length / rs.length : 0,
      expectancy: rs.length ? rs.reduce((s, r) => s + r.ret, 0) / rs.length : 0,
      avgWin: wins.length ? wins.reduce((s, r) => s + r.ret, 0) / wins.length : 0,
      avgLoss: losses.length ? losses.reduce((s, r) => s + r.ret, 0) / losses.length : 0,
    };
  };
  const all = summarize(results);
  const half = Math.floor(closes.length / 2);
  const first = summarize(results.filter((r) => r.index < half));
  const second = summarize(results.filter((r) => r.index >= half));
  return { ...all, stable: first.samples > 0 && second.samples > 0 && first.expectancy > 0 && second.expectancy > 0 };
}

export interface RiskCheck {
  label: string;
  ok: boolean;
}

export interface Proposal {
  signal: Signal;
  stats: RuleStats;
  quantity: number;
  stakeCents: number;
  leverage: number;
  /** Perte si le stop est touché, en centimes */
  riskCents: number;
  /** Gain si l'objectif est touché, en centimes */
  rewardCents: number;
  checks: RiskCheck[];
  accepted: boolean;
}

export interface RiskContext {
  capitalCents: number;
  isCrypto: boolean;
  /** Prix en euros d'une unité (conversion de devise déjà faite) */
  priceEur: number;
  openTrades: AgentTrade[];
  monthRealizedPnlCents: number;
  quoteKey: string;
}

/**
 * Dimensionne la position et applique toutes les règles de risque.
 * La mise est calculée pour que la perte au stop reste sous 2 % du capital ;
 * le levier n'est utilisé que si la mise dépasse le capital disponible, dans la limite autorisée.
 */
export function evaluateProposal(signal: Signal, stats: RuleStats, ctx: RiskContext): Proposal {
  const stopDistance = (signal.entry - signal.stop) / signal.entry;
  const maxLev = ctx.isCrypto ? AGENT_LIMITS.maxLeverageCrypto : AGENT_LIMITS.maxLeverage;
  const riskBudget = ctx.capitalCents * AGENT_LIMITS.riskPerTrade;
  const committed = ctx.openTrades.filter((t) => t.status === 'open').reduce((s, t) => s + t.stakeCents, 0);
  const free = Math.max(0, ctx.capitalCents - committed);
  const idealExposure = stopDistance > 0 ? riskBudget / stopDistance : 0;
  const exposure = Math.min(idealExposure, free * maxLev);
  const leverage = free > 0 ? Math.min(maxLev, Math.max(1, exposure / free)) : 1;
  const stakeCents = Math.round(exposure / leverage);
  const quantity = ctx.priceEur > 0 ? exposure / 100 / ctx.priceEur : 0;
  const riskCents = Math.round(exposure * stopDistance);
  const rewardCents = Math.round(exposure * ((signal.target - signal.entry) / signal.entry));
  const openCount = ctx.openTrades.filter((t) => t.status === 'open').length;
  const checks: RiskCheck[] = [
    { label: `Règle gagnante sur l’historique (${stats.samples} cas, ${Math.round(stats.winRate * 100)} % gagnants)`, ok: stats.samples >= AGENT_LIMITS.minSamples && stats.expectancy > 0 },
    { label: 'Gagnante sur chacune des deux moitiés de l’historique', ok: stats.stable },
    { label: 'Gain visé supérieur à la perte possible', ok: rewardCents > riskCents },
    { label: `Perte au stop ≤ 2 % du capital (${(riskCents / 100).toFixed(2).replace('.', ',')} €)`, ok: riskCents <= riskBudget + 1 && riskCents > 0 },
    { label: `Moins de ${AGENT_LIMITS.maxOpenPositions} positions ouvertes`, ok: openCount < AGENT_LIMITS.maxOpenPositions },
    { label: 'Pas déjà de position sur cet actif', ok: !ctx.openTrades.some((t) => t.status === 'open' && t.quoteKey === ctx.quoteKey) },
    { label: `Levier ≤ ${maxLev}${ctx.isCrypto ? ' (plafond crypto)' : ''}`, ok: leverage <= maxLev },
    { label: 'Coupe-circuit mensuel non déclenché', ok: ctx.monthRealizedPnlCents > -ctx.capitalCents * AGENT_LIMITS.monthlyLossLimit },
  ];
  return { signal, stats, quantity, stakeCents, leverage, riskCents, rewardCents, checks, accepted: checks.every((c) => c.ok) };
}

/** Faut-il fermer une position ouverte au cours actuel ? */
export function exitDecision(trade: AgentTrade, price: number, now: number): AgentTrade['exitReason'] {
  if (price <= trade.stopPrice) return 'stop';
  if (price >= trade.targetPrice) return 'target';
  if (trade.openedAt && now - Date.parse(trade.openedAt) > AGENT_LIMITS.maxHoldDays * 86_400_000) return 'time';
  return null;
}

/** Résultat d'une position fermée, frais inclus, en centimes. */
export function tradePnlCents(trade: AgentTrade, exitPrice: number): number {
  const exposure = trade.stakeCents * trade.leverage;
  const ret = exitPrice / trade.entryPrice - 1 - 2 * AGENT_LIMITS.feeRate;
  // La perte ne peut pas dépasser la mise (protection contre le solde négatif)
  return Math.round(Math.max(-trade.stakeCents, exposure * ret));
}

export interface TrainingStatus {
  daysTrained: number;
  closedTrades: number;
  pnlCents: number;
  winRate: number;
  /** Prêt pour l'argent réel : 90 jours, 10 opérations fermées, résultat positif et meilleur que l'ETF monde */
  ready: boolean;
  missing: string[];
}

export function trainingStatus(trades: AgentTrade[], now: number, benchmarkPnlCents: number | null): TrainingStatus {
  const opened = trades.filter((t) => t.openedAt).map((t) => Date.parse(t.openedAt!));
  const start = opened.length ? Math.min(...opened) : now;
  const closed = trades.filter((t) => t.status === 'closed');
  const pnl = closed.reduce((s, t) => s + (t.pnlCents ?? 0), 0);
  const days = Math.floor((now - start) / 86_400_000);
  const missing: string[] = [];
  if (days < AGENT_LIMITS.trainingDays) missing.push(`${AGENT_LIMITS.trainingDays - days} jours d’entraînement restants`);
  if (closed.length < AGENT_LIMITS.minClosedTrades) missing.push(`${AGENT_LIMITS.minClosedTrades - closed.length} opérations fermées manquantes`);
  if (pnl <= 0) missing.push('résultat fictif pas encore positif');
  if (benchmarkPnlCents !== null && pnl <= benchmarkPnlCents) missing.push('pas encore au-dessus de l’ETF monde sur la même période');
  return {
    daysTrained: opened.length ? days : 0,
    closedTrades: closed.length,
    pnlCents: pnl,
    winRate: closed.length ? closed.filter((t) => (t.pnlCents ?? 0) > 0).length / closed.length : 0,
    ready: missing.length === 0,
    missing,
  };
}
