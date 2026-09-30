/**
 * Boucle de l'agent sur l'appareil (mode entraînement : tout est fictif).
 *
 * Toutes les 30 s tant que l'application est ouverte :
 *  - ferme les positions fictives qui touchent leur stop ou leur objectif, ou qui ont 20 jours ;
 *  - expire les propositions de plus de 2 h ;
 *  - cherche de nouveaux signaux sur les actifs suivis et propose ceux qui passent le contrôle de risque.
 *
 * Les identifiants des propositions sont déterministes (actif + règle + jour) : si deux appareils
 * tournent en même temps, ils produisent la même proposition au lieu de deux.
 */
import {
  AGENT_LIMITS,
  backtestRule,
  evaluateProposal,
  exitDecision,
  signalAt,
  tradePnlCents,
  type AgentTrade,
  type Asset,
  type DailyClose,
  type Proposal,
  type RuleStats,
  type SignalKind,
  type WatchlistItem,
} from '@pecule/shared';
import type { StoredPrice } from '../db/local';
import type { Repo } from '../db/repo';

export const TRAINING_CAPITAL_CENTS = 1000_00;

export interface Candidate {
  quoteKey: string;
  name: string;
  currency: string;
  isCrypto: boolean;
}

export interface Rejection {
  at: number;
  name: string;
  kind: SignalKind;
  failed: string[];
}

export interface AgentInputs {
  candidates: Candidate[];
  daily: Record<string, DailyClose[]>;
  prices: Record<string, StoredPrice>;
  trades: AgentTrade[];
  /** Conversion d'un prix en euros (null si le taux manque) */
  toEur: (price: number, currency: string) => number | null;
}

/** Transforme une chaîne en identifiant au format UUID v4, toujours le même pour la même chaîne. */
export function stableUuid(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  const hex: string[] = [];
  for (let round = 0; round < 4; round++) {
    for (let i = 0; i < input.length; i++) {
      h1 = Math.imul(h1 ^ input.charCodeAt(i), 16777619) >>> 0;
      h2 = Math.imul(h2 ^ (input.charCodeAt(i) + round), 2246822519) >>> 0;
    }
    hex.push(((h1 ^ h2) >>> 0).toString(16).padStart(8, '0'));
  }
  const s = hex.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-4${s.slice(13, 16)}-${((parseInt(s[16]!, 16) & 0x3) | 0x8).toString(16)}${s.slice(17, 20)}-${s.slice(20, 32)}`;
}

export function candidatesFrom(assets: Asset[], watchlist: WatchlistItem[]): Candidate[] {
  const map = new Map<string, Candidate>();
  for (const a of assets) {
    if (a.quoteKey && !a.quoteKey.startsWith('fx:')) map.set(a.quoteKey, { quoteKey: a.quoteKey, name: a.name, currency: a.currency, isCrypto: a.assetClass === 'crypto' });
  }
  for (const w of watchlist) {
    if (!map.has(w.quoteKey) && !w.quoteKey.startsWith('fx:')) map.set(w.quoteKey, { quoteKey: w.quoteKey, name: w.label, currency: w.currency, isCrypto: w.quoteKey.startsWith('kraken:') });
  }
  return [...map.values()];
}

/** Un cours est-il assez frais pour décider ? (crypto : 5 min ; bourse : 30 min) */
function fresh(tick: StoredPrice | undefined, isCrypto: boolean, now: number): boolean {
  if (!tick || tick.via === 'manual') return false;
  return now - tick.t < (isCrypto ? 5 : 30) * 60_000;
}

export class AgentRunner {
  private statsCache = new Map<string, { day: string; stats: RuleStats }>();
  rejections: Rejection[] = [];
  lastScanAt: number | null = null;

  constructor(private readonly repo: Repo) {}

  ruleStats(quoteKey: string, kind: SignalKind, series: DailyClose[]): RuleStats {
    const key = `${quoteKey}|${kind}`;
    const lastDay = series[series.length - 1]?.day ?? '';
    const cached = this.statsCache.get(key);
    if (cached && cached.day === lastDay) return cached.stats;
    const stats = backtestRule(series, kind);
    this.statsCache.set(key, { day: lastDay, stats });
    return stats;
  }

  /** Calcule une proposition sans l'enregistrer (utile à l'affichage et aux tests). */
  evaluate(c: Candidate, kind: SignalKind, input: AgentInputs, now: number): Proposal | null {
    const series = input.daily[c.quoteKey] ?? [];
    const tick = input.prices[c.quoteKey];
    if (series.length < 120 || !tick) return null;
    const today = new Date(now).toISOString().slice(0, 10);
    const closes = series.filter((d) => d.day < today).map((d) => d.close);
    closes.push(tick.p);
    const signal = signalAt(closes, closes.length - 1, tick.p, kind);
    if (!signal) return null;
    const priceEur = input.toEur(tick.p, tick.c || c.currency);
    if (priceEur === null) return null;
    const stats = this.ruleStats(c.quoteKey, kind, series);
    const month = today.slice(0, 7);
    const monthRealizedPnlCents = input.trades
      .filter((t) => t.status === 'closed' && t.closedAt?.startsWith(month))
      .reduce((s, t) => s + (t.pnlCents ?? 0), 0);
    return evaluateProposal(signal, stats, {
      capitalCents: TRAINING_CAPITAL_CENTS,
      isCrypto: c.isCrypto,
      priceEur,
      openTrades: input.trades.filter((t) => t.status === 'open'),
      monthRealizedPnlCents,
      quoteKey: c.quoteKey,
    });
  }

  async tick(input: AgentInputs, now = Date.now()): Promise<void> {
    this.lastScanAt = now;
    const iso = new Date(now).toISOString();

    // 1. Positions ouvertes : stop, objectif, durée
    for (const t of input.trades.filter((x) => x.status === 'open')) {
      const tick = input.prices[t.quoteKey];
      if (!tick || tick.via === 'manual') continue;
      const reason = exitDecision(t, tick.p, now);
      if (!reason) continue;
      const exitPrice = reason === 'stop' ? Math.min(tick.p, t.stopPrice) : reason === 'target' ? Math.max(tick.p, t.targetPrice) : tick.p;
      await this.repo.save('agentTrade', { ...t, status: 'closed', closedAt: iso, exitPrice, exitReason: reason, pnlCents: tradePnlCents(t, exitPrice) });
    }

    // 2. Propositions trop anciennes
    for (const t of input.trades.filter((x) => x.status === 'proposed')) {
      if (now - Date.parse(t.proposedAt) > AGENT_LIMITS.proposalTtlMinutes * 60_000) {
        await this.repo.save('agentTrade', { ...t, status: 'expired' });
      }
    }

    // 3. Nouveaux signaux
    const known = new Set(input.trades.map((t) => t.id));
    const day = iso.slice(0, 10);
    for (const c of input.candidates) {
      if (!fresh(input.prices[c.quoteKey], c.isCrypto, now)) continue;
      for (const kind of ['trend', 'reversion'] as const) {
        const id = stableUuid(`${c.quoteKey}|${kind}|${day}`);
        if (known.has(id)) continue;
        const p = this.evaluate(c, kind, input, now);
        if (!p) continue;
        if (!p.accepted) {
          this.rejections = [
            { at: now, name: c.name, kind, failed: p.checks.filter((x) => !x.ok).map((x) => x.label) },
            ...this.rejections.filter((r) => !(r.name === c.name && r.kind === kind)),
          ].slice(0, 20);
          continue;
        }
        await this.repo.save('agentTrade', {
          id,
          quoteKey: c.quoteKey,
          assetName: c.name,
          currency: c.currency,
          mode: 'paper',
          signal: kind,
          status: 'proposed',
          reason: p.signal.why,
          entryPrice: p.signal.entry,
          stopPrice: p.signal.stop,
          targetPrice: p.signal.target,
          quantity: p.quantity,
          stakeCents: p.stakeCents,
          leverage: Math.round(p.leverage * 100) / 100,
          backtestWinRate: p.stats.winRate,
          backtestExpectancyPct: p.stats.expectancy * 100,
          backtestSamples: p.stats.samples,
          proposedAt: iso,
          openedAt: null,
          closedAt: null,
          exitPrice: null,
          pnlCents: null,
          exitReason: null,
        });
        known.add(id);
      }
    }
  }

  /** Validation fictive : l'entrée se fait au cours actuel, stop et objectif gardent leurs distances. */
  async accept(t: AgentTrade, currentPrice: number | undefined): Promise<void> {
    const price = currentPrice ?? t.entryPrice;
    const shift = price - t.entryPrice;
    await this.repo.save('agentTrade', {
      ...t,
      status: 'open',
      openedAt: new Date().toISOString(),
      entryPrice: price,
      stopPrice: Math.max(t.stopPrice + shift, price * 0.01),
      targetPrice: t.targetPrice + shift,
    });
  }

  async reject(t: AgentTrade): Promise<void> {
    await this.repo.save('agentTrade', { ...t, status: 'rejected' });
  }

  async closeNow(t: AgentTrade, price: number): Promise<void> {
    await this.repo.save('agentTrade', { ...t, status: 'closed', closedAt: new Date().toISOString(), exitPrice: price, exitReason: 'manual', pnlCents: tradePnlCents(t, price) });
  }
}
