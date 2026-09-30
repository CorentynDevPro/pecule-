/**
 * Calculs de portefeuille — fonctions pures, sans accès réseau ni base.
 *
 * Méthode du prix de revient unitaire moyen (PRU), celle de l'administration fiscale
 * française pour les titres : à chaque vente, le coût sorti est proportionnel à la
 * quantité vendue.
 */
import type { Asset, CashFlow, DailyClose, Pocket, PriceTick, Profile, Transaction } from '@pecule/shared';
import { fxKeyFor, POCKETS } from '@pecule/shared';

const KIND_ORDER: Record<Transaction['kind'], number> = { buy: 0, dividend: 1, fee: 2, sell: 3 };

export interface Position {
  asset: Asset;
  quantity: number;
  /** Coût d'acquisition restant, frais inclus, en centimes */
  costCents: number;
  /** Plus-values réalisées par les ventes, en centimes */
  realizedCents: number;
  dividendsCents: number;
  feesCents: number;
  /** Prix de revient unitaire en euros */
  averageCost: number | null;
}

/** Trie les opérations par date, puis achats avant ventes le même jour. */
export function sortTransactions(txs: Transaction[]): Transaction[] {
  return [...txs].sort((a, b) =>
    a.tradeDate === b.tradeDate ? KIND_ORDER[a.kind] - KIND_ORDER[b.kind] : a.tradeDate < b.tradeDate ? -1 : 1,
  );
}

export function computePositions(transactions: Transaction[], assets: Asset[]): Position[] {
  const byId = new Map(assets.map((a) => [a.id, a]));
  const positions = new Map<string, Position>();
  for (const tx of sortTransactions(transactions.filter((t) => !t.deleted))) {
    const asset = byId.get(tx.assetId);
    if (!asset) continue;
    let pos = positions.get(asset.id);
    if (!pos) {
      pos = { asset, quantity: 0, costCents: 0, realizedCents: 0, dividendsCents: 0, feesCents: 0, averageCost: null };
      positions.set(asset.id, pos);
    }
    switch (tx.kind) {
      case 'buy':
        pos.quantity += tx.quantity;
        pos.costCents += tx.amountCents;
        pos.feesCents += tx.feeCents;
        break;
      case 'sell': {
        const sold = Math.min(tx.quantity, pos.quantity);
        const share = pos.quantity > 0 ? sold / pos.quantity : 0;
        const costOut = Math.round(pos.costCents * share);
        pos.realizedCents += tx.amountCents - costOut;
        pos.costCents -= costOut;
        pos.quantity -= sold;
        pos.feesCents += tx.feeCents;
        // Élimine les poussières de calcul flottant (ex. 1e-17 BTC)
        if (pos.quantity < 1e-10) {
          pos.quantity = 0;
          pos.costCents = 0;
        }
        break;
      }
      case 'dividend':
        pos.dividendsCents += tx.amountCents;
        break;
      case 'fee':
        pos.feesCents += tx.amountCents;
        pos.realizedCents -= tx.amountCents;
        break;
    }
  }
  for (const pos of positions.values()) {
    pos.averageCost = pos.quantity > 0 ? pos.costCents / 100 / pos.quantity : null;
  }
  return [...positions.values()];
}

export type PriceMap = Record<string, PriceTick | undefined>;

/**
 * Prix d'un actif en euros. Les taux de change sont exprimés en devise pour 1 euro
 * (EUR/USD = 1,17 signifie 1 € = 1,17 $) : on divise.
 */
/** Clé sous laquelle chercher le cours d'un actif : sa source, ou une clé de saisie manuelle. */
export function priceKeyOf(asset: Asset): string {
  return asset.quoteKey ?? `manual:${asset.id}`;
}

export function priceInEur(asset: Asset, prices: PriceMap): { price: number; tick: PriceTick } | null {
  const tick = prices[priceKeyOf(asset)];
  if (!tick) return null;
  const currency = tick.c || asset.currency;
  const fxKey = fxKeyFor(currency);
  if (!fxKey) return { price: tick.p, tick };
  const fx = prices[fxKey];
  if (!fx || fx.p <= 0) return null;
  return { price: tick.p / fx.p, tick };
}

export interface ValuedPosition extends Position {
  /** Valeur actuelle en centimes ; null si aucun cours n'est connu */
  valueCents: number | null;
  priceEur: number | null;
  /** Plus-value latente en centimes */
  unrealizedCents: number | null;
  /** Variation du jour en centimes, si la source la fournit */
  dayChangeCents: number | null;
  tick: PriceTick | null;
}

export function valuePositions(positions: Position[], prices: PriceMap): ValuedPosition[] {
  return positions.map((pos) => {
    const quote = priceInEur(pos.asset, prices);
    if (!quote || pos.quantity === 0) {
      return { ...pos, valueCents: pos.quantity === 0 ? 0 : null, priceEur: quote?.price ?? null, unrealizedCents: pos.quantity === 0 ? 0 : null, dayChangeCents: null, tick: quote?.tick ?? null };
    }
    const valueCents = Math.round(pos.quantity * quote.price * 100);
    const chg = quote.tick.chg;
    // Valeur de la veille = valeur actuelle / (1 + variation) ; la variation du jour en découle.
    const dayChangeCents = chg === null || chg <= -100 ? null : Math.round(valueCents - valueCents / (1 + chg / 100));
    return {
      ...pos,
      valueCents,
      priceEur: quote.price,
      unrealizedCents: valueCents - pos.costCents,
      dayChangeCents,
      tick: quote.tick,
    };
  });
}

export interface Summary {
  /** Valeur des positions (au prix de revient pour celles sans cours) */
  investedValueCents: number;
  /** Liquidités non investies dans les comptes */
  cashCents: number;
  totalCents: number;
  /** Argent réellement versé par toi (versements − retraits) */
  netContributionsCents: number;
  gainCents: number;
  gainPct: number | null;
  dayChangeCents: number;
  /** Positions dont le cours est inconnu (valorisées au prix de revient) */
  missingPrices: string[];
  /** Vrai si aucun versement n'a été saisi : les apports sont alors estimés depuis les achats */
  contributionsEstimated: boolean;
}

export function summarize(valued: ValuedPosition[], transactions: Transaction[], cashFlows: CashFlow[]): Summary {
  const live = transactions.filter((t) => !t.deleted);
  const flows = cashFlows.filter((f) => !f.deleted);
  let investedValueCents = 0;
  let dayChangeCents = 0;
  const missingPrices: string[] = [];
  for (const p of valued) {
    if (p.quantity === 0) continue;
    if (p.valueCents === null) {
      investedValueCents += p.costCents;
      missingPrices.push(p.asset.name);
    } else {
      investedValueCents += p.valueCents;
      dayChangeCents += p.dayChangeCents ?? 0;
    }
  }

  // Liquidités = versements − achats + ventes + dividendes − frais isolés
  const txCash = live.reduce((sum, t) => {
    if (t.kind === 'buy') return sum - t.amountCents;
    if (t.kind === 'sell' || t.kind === 'dividend') return sum + t.amountCents;
    return sum - t.amountCents; // fee
  }, 0);

  const contributionsEstimated = flows.length === 0;
  let netContributionsCents: number;
  let cashCents: number;
  if (contributionsEstimated) {
    // Sans versements saisis, on considère que chaque achat a été financé par un apport.
    netContributionsCents = Math.max(0, -txCash);
    cashCents = Math.max(0, txCash);
  } else {
    netContributionsCents = flows.reduce((s, f) => s + f.amountCents, 0);
    cashCents = netContributionsCents + txCash;
  }

  const totalCents = investedValueCents + cashCents;
  const gainCents = totalCents - netContributionsCents;
  return {
    investedValueCents,
    cashCents,
    totalCents,
    netContributionsCents,
    gainCents,
    gainPct: netContributionsCents > 0 ? (gainCents / netContributionsCents) * 100 : null,
    dayChangeCents,
    missingPrices,
    contributionsEstimated,
  };
}

export interface PocketAllocation {
  pocket: Pocket;
  valueCents: number;
  actualPct: number;
  targetPct: number;
  /** Écart en points de pourcentage (positif = au-dessus de la cible) */
  driftPts: number;
}

export function targetFor(profile: Profile | undefined, pocket: Pocket): number {
  if (!profile) return 0;
  switch (pocket) {
    case 'core': return profile.targetCorePct;
    case 'crypto': return profile.targetCryptoPct;
    case 'themes': return profile.targetThemesPct;
    case 'leverage': return profile.targetLeveragePct;
  }
}

export function allocationByPocket(valued: ValuedPosition[], profile: Profile | undefined): PocketAllocation[] {
  const values = Object.fromEntries(POCKETS.map((p) => [p, 0])) as Record<Pocket, number>;
  for (const p of valued) values[p.asset.pocket] += p.valueCents ?? p.costCents;
  const total = Object.values(values).reduce((a, b) => a + b, 0);
  return POCKETS.map((pocket) => {
    const actualPct = total > 0 ? (values[pocket] / total) * 100 : 0;
    const targetPct = targetFor(profile, pocket);
    return { pocket, valueCents: values[pocket], actualPct, targetPct, driftPts: actualPct - targetPct };
  });
}

/**
 * Répartition conseillée du prochain versement : on comble d'abord les poches
 * les plus en retard sur leur cible (rééquilibrage sans vendre, donc sans impôt).
 *
 * Les poches inactives (le levier tant que l'agent n'est pas en service) ne reçoivent rien :
 * leur part de cible est redistribuée aux autres, au prorata de leurs cibles.
 */
export function nextContributionSplit(
  allocations: PocketAllocation[],
  contributionCents: number,
  inactive: Pocket[] = [],
): Record<Pocket, number> {
  const active = allocations.filter((a) => !inactive.includes(a.pocket));
  const activeTarget = active.reduce((s, a) => s + a.targetPct, 0);
  const split = Object.fromEntries(POCKETS.map((p) => [p, 0])) as Record<Pocket, number>;
  if (active.length === 0 || activeTarget === 0 || contributionCents <= 0) return split;

  const weight = (a: PocketAllocation) => a.targetPct / activeTarget;
  const current = active.reduce((s, a) => s + a.valueCents, 0);
  const after = current + contributionCents;
  const gaps = active.map((a) => ({ pocket: a.pocket, gap: Math.max(0, weight(a) * after - a.valueCents) }));
  const totalGap = gaps.reduce((s, g) => s + g.gap, 0);
  if (totalGap <= 0) {
    for (const a of active) split[a.pocket] = Math.round(contributionCents * weight(a));
  } else {
    for (const g of gaps) split[g.pocket] = Math.round((contributionCents * g.gap) / totalGap);
  }
  // Arrondi : les quelques centimes d'écart vont à la plus grosse poche active
  const diff = contributionCents - Object.values(split).reduce((a, b) => a + b, 0);
  const biggest = active.reduce((best, a) => (split[a.pocket] > split[best.pocket] ? a : best), active[0]!);
  split[biggest.pocket] += diff;
  return split;
}

export interface ValuePoint {
  day: string;
  valueCents: number;
  contributedCents: number;
}

function* daysBetween(from: string, to: string): Generator<string> {
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d <= end) {
    yield d.toISOString().slice(0, 10);
    d.setUTCDate(d.getUTCDate() + 1);
  }
}

/**
 * Courbe de valeur quotidienne : quantités détenues chaque jour × clôture du jour
 * (dernière clôture connue les week-ends et jours fériés), plus les liquidités.
 */
export function valueHistory(
  transactions: Transaction[],
  cashFlows: CashFlow[],
  assets: Asset[],
  daily: Record<string, DailyClose[]>,
  today: string,
): ValuePoint[] {
  const txs = sortTransactions(transactions.filter((t) => !t.deleted));
  const flows = cashFlows.filter((f) => !f.deleted).sort((a, b) => (a.flowDate < b.flowDate ? -1 : 1));
  const firstDay = [txs[0]?.tradeDate, flows[0]?.flowDate].filter(Boolean).sort()[0];
  if (!firstDay) return [];

  const assetById = new Map(assets.map((a) => [a.id, a]));
  const closeIndex = new Map<string, Map<string, number>>();
  for (const [key, rows] of Object.entries(daily)) closeIndex.set(key, new Map(rows.map((r) => [r.day, r.close])));

  const qty = new Map<string, number>();
  const lastClose = new Map<string, number>();
  const lastBuyPrice = new Map<string, number>();
  const useFlows = flows.length > 0;
  let cash = 0;
  let contributed = 0;
  let ti = 0;
  let fi = 0;
  const points: ValuePoint[] = [];

  for (const day of daysBetween(firstDay, today)) {
    for (; fi < flows.length && flows[fi]!.flowDate <= day; fi++) {
      cash += flows[fi]!.amountCents;
      contributed += flows[fi]!.amountCents;
    }
    for (; ti < txs.length && txs[ti]!.tradeDate <= day; ti++) {
      const t = txs[ti]!;
      const q = qty.get(t.assetId) ?? 0;
      if (t.kind === 'buy') {
        qty.set(t.assetId, q + t.quantity);
        if (t.quantity > 0) lastBuyPrice.set(t.assetId, t.amountCents / 100 / t.quantity);
        cash -= t.amountCents;
        if (!useFlows) contributed += t.amountCents;
      } else if (t.kind === 'sell') {
        qty.set(t.assetId, Math.max(0, q - t.quantity));
        cash += t.amountCents;
      } else if (t.kind === 'dividend') {
        cash += t.amountCents;
      } else {
        cash -= t.amountCents;
      }
    }
    for (const [key, closes] of closeIndex) {
      const c = closes.get(day);
      if (c !== undefined) lastClose.set(key, c);
    }
    let value = 0;
    for (const [assetId, q] of qty) {
      if (q <= 0) continue;
      const asset = assetById.get(assetId);
      if (!asset) continue;
      let price: number | undefined;
      const close = asset.quoteKey ? lastClose.get(asset.quoteKey) : undefined;
      if (close !== undefined) {
        const fxKey = fxKeyFor(asset.currency);
        const fx = fxKey ? lastClose.get(fxKey) : 1;
        if (fx) price = close / fx;
      }
      // Sans historique de cours, on retient le dernier prix d'achat
      price ??= lastBuyPrice.get(assetId);
      if (price !== undefined) value += q * price * 100;
    }
    points.push({ day, valueCents: Math.round(value + (useFlows ? cash : Math.max(0, cash))), contributedCents: contributed });
  }
  return points;
}

export interface MonthlyFlow {
  month: string; // AAAA-MM
  inCents: number;
  outCents: number;
}

/** Entrées (versements, dividendes) et sorties (retraits, frais) par mois. */
export function monthlyFlows(cashFlows: CashFlow[], transactions: Transaction[]): MonthlyFlow[] {
  const months = new Map<string, MonthlyFlow>();
  const bucket = (date: string) => {
    const m = date.slice(0, 7);
    let row = months.get(m);
    if (!row) months.set(m, (row = { month: m, inCents: 0, outCents: 0 }));
    return row;
  };
  for (const f of cashFlows) {
    if (f.deleted) continue;
    const row = bucket(f.flowDate);
    if (f.amountCents > 0) row.inCents += f.amountCents;
    else row.outCents += -f.amountCents;
  }
  for (const t of transactions) {
    if (t.deleted) continue;
    if (t.kind === 'dividend') bucket(t.tradeDate).inCents += t.amountCents;
    if (t.kind === 'fee') bucket(t.tradeDate).outCents += t.amountCents;
    if (t.kind === 'buy' || t.kind === 'sell') {
      if (t.feeCents > 0) bucket(t.tradeDate).outCents += t.feeCents;
    }
  }
  return [...months.values()].sort((a, b) => (a.month < b.month ? -1 : 1));
}
