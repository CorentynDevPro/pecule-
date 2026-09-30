/**
 * Base locale de l'appareil (IndexedDB via Dexie).
 * Elle contient TOUTES les données : l'application fonctionne entièrement sans la tour,
 * et la tour ne sert qu'à partager les modifications entre appareils et à fournir les cours.
 */
import Dexie, { type Table } from 'dexie';
import type {
  Account,
  Asset,
  CashFlow,
  DailyClose,
  EntityName,
  PriceTick,
  Profile,
  Transaction,
  WatchlistItem,
} from '@pecule/shared';

/** Nom de la table locale de chaque entité synchronisée. */
export const LOCAL_TABLE: Record<EntityName, string> = {
  profile: 'profile',
  account: 'account',
  asset: 'asset',
  transaction: 'trades',
  cashFlow: 'cashFlow',
  watchlistItem: 'watchlistItem',
};

export interface OutboxEntry {
  /** « entité:id » */
  key: string;
  entity: EntityName;
  id: string;
  /** updatedAt de l'enregistrement au moment de la mise en file */
  updatedAt: string;
}

export interface StoredPrice extends PriceTick {
  /** D'où vient ce cours : la tour, ou une connexion directe de l'appareil */
  via: 'tower' | 'direct';
  receivedAt: number;
}

export interface StoredDaily {
  quoteKey: string;
  closes: DailyClose[];
  fetchedAt: number;
}

export interface MetaEntry {
  key: string;
  value: unknown;
}

export class LocalDb extends Dexie {
  profile!: Table<Profile, string>;
  account!: Table<Account, string>;
  asset!: Table<Asset, string>;
  /** Opérations. La table ne peut pas s'appeler « transaction » : c'est une méthode de Dexie. */
  trades!: Table<Transaction, string>;
  cashFlow!: Table<CashFlow, string>;
  watchlistItem!: Table<WatchlistItem, string>;
  outbox!: Table<OutboxEntry, string>;
  price!: Table<StoredPrice, string>;
  daily!: Table<StoredDaily, string>;
  meta!: Table<MetaEntry, string>;

  constructor(name = 'pecule') {
    super(name);
    this.version(1).stores({
      profile: 'id',
      account: 'id',
      asset: 'id, quoteKey',
      trades: 'id, assetId, accountId, tradeDate',
      cashFlow: 'id, accountId, flowDate',
      watchlistItem: 'id, quoteKey',
      outbox: 'key',
      price: 'k',
      daily: 'quoteKey',
      meta: 'key',
    });
  }

  entityTable(entity: EntityName): Table<{ id: string; updatedAt: string; deleted: boolean }, string> {
    return this.table(LOCAL_TABLE[entity]);
  }

  async getMeta<T>(key: string, fallback: T): Promise<T> {
    const row = await this.meta.get(key);
    return row ? (row.value as T) : fallback;
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    await this.meta.put({ key, value });
  }
}

export const db = new LocalDb();
