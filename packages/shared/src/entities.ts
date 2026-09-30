/**
 * Entités synchronisées entre les appareils et la tour.
 * Format d'échange en camelCase ; la base utilise le snake_case (voir toSnake).
 * Chaque enregistrement porte updatedAt (ISO 8601) et deleted : la règle de fusion
 * est « la dernière écriture gagne », appliquée à l'identique côté appareil et côté serveur.
 */
import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ');
const isoDateTime = z.string().datetime({ offset: true });
const cents = z.number().int().safe();
const currency = z.string().regex(/^[A-Z]{3}$/);

const syncFields = {
  id: z.string().uuid(),
  updatedAt: isoDateTime,
  deleted: z.boolean().default(false),
};

export const POCKETS = ['core', 'crypto', 'themes', 'leverage'] as const;
export type Pocket = (typeof POCKETS)[number];

export const profileSchema = z
  .object({
    ...syncFields,
    horizonYears: z.number().int().min(1).max(50),
    maxDrawdownPct: z.number().int().min(1).max(100),
    monthlyContributionCents: cents.nonnegative(),
    targetCorePct: z.number().int().min(0).max(100),
    targetCryptoPct: z.number().int().min(0).max(100),
    targetThemesPct: z.number().int().min(0).max(100),
    targetLeveragePct: z.number().int().min(0).max(100),
    emergencyFundOk: z.boolean(),
  })
  .refine(
    (p) => p.targetCorePct + p.targetCryptoPct + p.targetThemesPct + p.targetLeveragePct === 100,
    { message: 'Les parts des poches doivent totaliser 100 %' },
  );

export const accountSchema = z.object({
  ...syncFields,
  name: z.string().min(1).max(80),
  type: z.enum(['pea', 'cto', 'crypto', 'savings', 'life_insurance']),
  broker: z.string().max(80).default(''),
});

export const assetSchema = z.object({
  ...syncFields,
  name: z.string().min(1).max(120),
  symbol: z.string().min(1).max(40),
  isin: z.string().max(12).nullable().default(null),
  assetClass: z.enum(['etf', 'stock', 'crypto', 'commodity', 'leveraged', 'bond']),
  pocket: z.enum(POCKETS),
  currency,
  quoteKey: z.string().max(80).nullable().default(null),
});

export const transactionSchema = z.object({
  ...syncFields,
  accountId: z.string().uuid(),
  assetId: z.string().uuid(),
  kind: z.enum(['buy', 'sell', 'dividend', 'fee']),
  tradeDate: isoDate,
  quantity: z.number().nonnegative(),
  amountCents: cents.nonnegative(),
  feeCents: cents.nonnegative().default(0),
  note: z.string().max(500).default(''),
});

export const cashFlowSchema = z.object({
  ...syncFields,
  accountId: z.string().uuid(),
  flowDate: isoDate,
  amountCents: cents.refine((v) => v !== 0, 'Montant non nul attendu'),
  label: z.string().max(200).default(''),
});

export const watchlistItemSchema = z.object({
  ...syncFields,
  quoteKey: z.string().min(1).max(80),
  label: z.string().min(1).max(80),
  currency,
  sortOrder: z.number().int().default(0),
});

export type Profile = z.infer<typeof profileSchema>;
export type Account = z.infer<typeof accountSchema>;
export type Asset = z.infer<typeof assetSchema>;
export type Transaction = z.infer<typeof transactionSchema>;
export type CashFlow = z.infer<typeof cashFlowSchema>;
export type WatchlistItem = z.infer<typeof watchlistItemSchema>;

/** Registre : nom d'entité → schéma et table SQL. */
export const ENTITIES = {
  profile: { schema: profileSchema, table: 'investor_profile' },
  account: { schema: accountSchema, table: 'account' },
  asset: { schema: assetSchema, table: 'asset' },
  transaction: { schema: transactionSchema, table: 'transaction' },
  cashFlow: { schema: cashFlowSchema, table: 'cash_flow' },
  watchlistItem: { schema: watchlistItemSchema, table: 'watchlist_item' },
} as const;

export type EntityName = keyof typeof ENTITIES;
export const ENTITY_NAMES = Object.keys(ENTITIES) as EntityName[];

export interface EntityRecordMap {
  profile: Profile;
  account: Account;
  asset: Asset;
  transaction: Transaction;
  cashFlow: CashFlow;
  watchlistItem: WatchlistItem;
}

export type AnyRecord = EntityRecordMap[EntityName];

/** « monthlyContributionCents » → « monthly_contribution_cents » */
export function toSnake(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

/** « monthly_contribution_cents » → « monthlyContributionCents » */
export function toCamel(key: string): string {
  return key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}
