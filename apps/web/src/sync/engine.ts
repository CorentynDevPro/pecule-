/**
 * Synchronisation avec la tour.
 * - Envoie les modifications en attente et reçoit celles des autres appareils, en un aller-retour.
 * - Tourne toutes les 20 s, au retour du réseau, quand l'application revient au premier plan
 *   et juste après une modification locale.
 * - Si la tour ne répond pas, rien n'est perdu : la file d'attente reste sur l'appareil.
 */
import { shouldReplace, type Change, type SyncResponse } from '@pecule/shared';
import { LOCAL_TABLE, type LocalDb } from '../db/local';

export interface SyncState {
  towerReachable: boolean | null;
  lastSyncAt: number | null;
  pending: number;
  syncing: boolean;
  error: string | null;
  rejected: SyncResponse['rejected'];
}

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

export class SyncEngine {
  state: SyncState = { towerReachable: null, lastSyncAt: null, pending: 0, syncing: false, error: null, rejected: [] };
  private listeners = new Set<(s: SyncState) => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private soon: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;
  private again = false;

  constructor(
    private readonly db: LocalDb,
    /** Adresse de la tour ('' = même adresse que l'application), ou fonction qui la lit ; null = pas de tour */
    private readonly baseUrl: string | (() => string | null) = '',
    private readonly fetcher: Fetcher = (u, i) => fetch(u, i),
  ) {}

  subscribe(fn: (s: SyncState) => void): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  private set(patch: Partial<SyncState>): void {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn(this.state);
  }

  start(intervalMs = 20_000): void {
    void this.refreshPending();
    void this.syncNow();
    this.timer = setInterval(() => void this.syncNow(), intervalMs);
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => void this.syncNow());
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void this.syncNow();
      });
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.soon) clearTimeout(this.soon);
  }

  /** Après une modification locale : on regroupe les écritures rapprochées. */
  schedule(): void {
    void this.refreshPending();
    if (this.soon) clearTimeout(this.soon);
    this.soon = setTimeout(() => void this.syncNow(), 400);
  }

  async refreshPending(): Promise<void> {
    this.set({ pending: await this.db.outbox.count() });
  }

  syncNow(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = this.run().finally(() => {
      this.running = null;
      if (this.again) {
        this.again = false;
        void this.syncNow();
      }
    });
    return this.running;
  }

  private async run(): Promise<void> {
    const base = typeof this.baseUrl === 'function' ? this.baseUrl() : this.baseUrl;
    if (base === null) {
      // Pas de tour sur cet appareil : tout reste en local, la file d'attente attend une tour.
      this.set({ towerReachable: null, error: null, pending: await this.db.outbox.count() });
      return;
    }
    this.set({ syncing: true });
    try {
      const since = await this.db.getMeta<number>('cursor', 0);
      const outbox = await this.db.outbox.toArray();
      const changes: Change[] = [];
      for (const entry of outbox) {
        const record = await this.db.entityTable(entry.entity).get(entry.id);
        if (record) changes.push({ entity: entry.entity, record: record as unknown as Record<string, unknown> });
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      let response: Response;
      try {
        response = await this.fetcher(`${base}/api/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ since, changes }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
      if (!response.ok) throw new Error(`La tour a répondu ${response.status}`);
      const body = (await response.json()) as SyncResponse;
      await this.applyRemote(body, outbox);
      this.set({
        towerReachable: true,
        lastSyncAt: Date.now(),
        error: null,
        rejected: body.rejected,
        pending: await this.db.outbox.count(),
      });
    } catch (err) {
      const message = err instanceof Error && err.name === 'AbortError' ? 'La tour ne répond pas' : (err as Error).message;
      this.set({ towerReachable: false, error: message, pending: await this.db.outbox.count() });
    } finally {
      this.set({ syncing: false });
    }
  }

  private async applyRemote(body: SyncResponse, sent: { key: string; updatedAt: string }[]): Promise<void> {
    const tables = Object.values(LOCAL_TABLE).map((n) => this.db.table(n));
    await this.db.transaction('rw', [...tables, this.db.outbox, this.db.meta], async () => {
      for (const change of body.changes) {
        const table = this.db.entityTable(change.entity);
        const incoming = change.record as { id: string; updatedAt: string; deleted: boolean };
        const current = await table.get(incoming.id);
        if (shouldReplace(current, incoming)) await table.put(incoming);
      }
      // On ne retire de la file que ce qui n'a pas été modifié pendant l'envoi.
      for (const entry of sent) {
        const now = await this.db.outbox.get(entry.key);
        if (now && now.updatedAt === entry.updatedAt) await this.db.outbox.delete(entry.key);
      }
      // Les modifications refusées par la tour restent visibles mais ne sont plus renvoyées en boucle.
      for (const r of body.rejected) await this.db.outbox.delete(`${r.entity}:${String(r.id)}`);
      await this.db.setMeta('cursor', body.cursor);
    });
  }
}
