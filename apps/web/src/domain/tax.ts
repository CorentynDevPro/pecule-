/**
 * Récapitulatif fiscal annuel (France, règles 2026) et scénarios de crise.
 *
 * Estimation d'aide à la déclaration, pas un calcul officiel :
 * - compte-titres et crypto : prélèvement forfaitaire unique (flat tax) de 31,4 % sur les gains ;
 * - crypto : exonération si le total des ventes de l'année reste sous 305 € ;
 *   l'administration utilise une formule globale sur tout le portefeuille crypto, ici approchée
 *   par le prix de revient moyen de chaque actif ;
 * - PEA et assurance-vie : pas d'impôt tant que tu ne retires rien.
 */
import type { Account, Asset, Pocket, Transaction } from '@pecule/shared';
import { sortTransactions, type PocketAllocation } from './portfolio';

export const FLAT_TAX_2026 = 0.314;
export const CRYPTO_EXEMPTION_CENTS = 305_00;

export type TaxBucket = 'cto' | 'crypto' | 'sheltered';

export interface YearRecap {
  year: string;
  bucket: TaxBucket;
  realizedCents: number;
  dividendsCents: number;
  salesCents: number;
  /** Impôt estimé, en centimes */
  taxCents: number;
  note: string;
}

function bucketOf(account: Account | undefined, asset: Asset | undefined): TaxBucket {
  if (account?.type === 'pea' || account?.type === 'life_insurance' || account?.type === 'savings') return 'sheltered';
  if (account?.type === 'crypto' || asset?.assetClass === 'crypto') return 'crypto';
  return 'cto';
}

/** Plus-values réalisées et dividendes par année et par régime fiscal (PRU par actif et par compte). */
export function yearlyTaxRecap(transactions: Transaction[], assets: Asset[], accounts: Account[]): YearRecap[] {
  const assetById = new Map(assets.map((a) => [a.id, a]));
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const books = new Map<string, { qty: number; cost: number }>();
  const rows = new Map<string, YearRecap>();
  const row = (year: string, bucket: TaxBucket) => {
    const key = `${year}|${bucket}`;
    let r = rows.get(key);
    if (!r) rows.set(key, (r = { year, bucket, realizedCents: 0, dividendsCents: 0, salesCents: 0, taxCents: 0, note: '' }));
    return r;
  };
  for (const t of sortTransactions(transactions.filter((x) => !x.deleted))) {
    const bucket = bucketOf(accountById.get(t.accountId), assetById.get(t.assetId));
    const book = books.get(`${t.accountId}|${t.assetId}`) ?? { qty: 0, cost: 0 };
    const year = t.tradeDate.slice(0, 4);
    if (t.kind === 'buy') {
      book.qty += t.quantity;
      book.cost += t.amountCents;
    } else if (t.kind === 'sell') {
      const sold = Math.min(t.quantity, book.qty);
      const costOut = book.qty > 0 ? Math.round(book.cost * (sold / book.qty)) : 0;
      book.qty -= sold;
      book.cost -= costOut;
      const r = row(year, bucket);
      r.realizedCents += t.amountCents - costOut;
      r.salesCents += t.amountCents;
    } else if (t.kind === 'dividend') {
      row(year, bucket).dividendsCents += t.amountCents;
    }
    books.set(`${t.accountId}|${t.assetId}`, book);
  }
  for (const r of rows.values()) {
    if (r.bucket === 'sheltered') {
      r.note = 'Pas d’impôt tant que tu ne retires rien de l’enveloppe.';
    } else if (r.bucket === 'crypto' && r.salesCents < CRYPTO_EXEMPTION_CENTS) {
      r.note = 'Ventes de l’année sous 305 € : exonéré.';
    } else {
      const base = Math.max(0, r.realizedCents + r.dividendsCents);
      r.taxCents = Math.round(base * FLAT_TAX_2026);
      r.note = r.bucket === 'crypto' ? 'Flat tax 31,4 % · formulaires 2086 et 3916 (plateforme étrangère)' : 'Flat tax 31,4 % · formulaire 2074 si pertes à reporter';
    }
  }
  return [...rows.values()].sort((a, b) => (a.year === b.year ? a.bucket.localeCompare(b.bucket) : a.year < b.year ? 1 : -1));
}

// --- Scénarios de crise ----------------------------------------------------------------

export interface Scenario {
  name: string;
  description: string;
  shocks: Record<Pocket, number>;
}

/**
 * Chocs hypothétiques par poche, en ordres de grandeur inspirés de crises passées
 * (krach de 2008, hivers crypto de 2018 et 2022, correction de 2020). Ce ne sont pas
 * des reconstitutions exactes : ils servent à mesurer ce que ton portefeuille encaisserait.
 */
export const SCENARIOS: Scenario[] = [
  { name: 'Correction ordinaire', description: 'Le genre de baisse qui arrive tous les deux ou trois ans.', shocks: { core: -0.15, themes: -0.2, crypto: -0.35, leverage: -0.7 } },
  { name: 'Hiver crypto', description: 'Les cryptos perdent les trois quarts de leur valeur, la bourse bouge peu.', shocks: { core: -0.05, themes: -0.1, crypto: -0.75, leverage: -0.5 } },
  { name: 'Choc de taux et d’inflation', description: 'Hausse brutale des taux : actions et crypto baissent ensemble.', shocks: { core: -0.2, themes: -0.3, crypto: -0.6, leverage: -0.9 } },
  { name: 'Krach sévère', description: 'Crise financière majeure, comme en 2008.', shocks: { core: -0.45, themes: -0.55, crypto: -0.75, leverage: -1 } },
];

export function applyScenario(allocations: PocketAllocation[], scenario: Scenario): { beforeCents: number; afterCents: number; lossPct: number } {
  const before = allocations.reduce((s, a) => s + a.valueCents, 0);
  const after = allocations.reduce((s, a) => s + a.valueCents * (1 + scenario.shocks[a.pocket]), 0);
  return { beforeCents: before, afterCents: Math.round(after), lossPct: before > 0 ? after / before - 1 : 0 };
}
