/**
 * Cours en direct, avec repli automatique.
 *
 * Mode normal : l'appareil écoute la tour (/api/live), qui agrège toutes les sources.
 * Si la tour ne répond plus depuis 8 s, l'appareil se connecte lui-même au flux public
 * de Kraken pour la crypto et le change EUR/USD ; les autres cours restent affichés avec
 * leur âge. Dès que la tour revient, la connexion directe est fermée.
 */
import type { LiveMessage, PriceTick } from '@pecule/shared';
import type { LocalDb, StoredPrice } from '../db/local';

export type LiveMode = 'tower' | 'direct' | 'offline' | 'connecting';

export interface LiveState {
  mode: LiveMode;
  prices: Record<string, StoredPrice>;
  feed: Record<string, { ok: boolean; lastTickAt: number | null }>;
}

const KRAKEN_WS = 'wss://ws.kraken.com/v2';
const FALLBACK_AFTER_MS = 8_000;

/** Clé de cotation → symbole Kraken, pour le repli direct. */
export function krakenSymbolFor(quoteKey: string): string | null {
  if (quoteKey.startsWith('kraken:')) return quoteKey.slice('kraken:'.length);
  if (quoteKey === 'fx:EUR/USD') return 'EUR/USD';
  return null;
}

export function parseKrakenTicker(message: unknown, keyFor: (symbol: string) => string | undefined): PriceTick[] {
  const m = message as { channel?: string; type?: string; data?: { symbol?: string; last?: number; change_pct?: number; timestamp?: string }[] };
  if (m.channel !== 'ticker' || (m.type !== 'snapshot' && m.type !== 'update')) return [];
  const ticks: PriceTick[] = [];
  for (const d of m.data ?? []) {
    if (!d.symbol || typeof d.last !== 'number') continue;
    const k = keyFor(d.symbol);
    if (!k) continue;
    const t = d.timestamp ? Date.parse(d.timestamp) : Date.now();
    ticks.push({ k, p: d.last, c: d.symbol.split('/')[1] ?? 'EUR', chg: d.change_pct ?? null, t: Number.isFinite(t) ? t : Date.now() });
  }
  return ticks;
}

export class LivePrices {
  state: LiveState = { mode: 'connecting', prices: {}, feed: {} };
  private listeners = new Set<(s: LiveState) => void>();
  private tower: WebSocket | null = null;
  private direct: WebSocket | null = null;
  private towerRetry = 1000;
  private fallbackTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingWrites = new Map<string, StoredPrice>();
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private trackedKeys = new Set<string>();
  private stopped = false;

  constructor(
    private readonly db: LocalDb,
    private readonly towerUrl: string,
  ) {}

  subscribe(fn: (s: LiveState) => void): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.state);
  }

  async start(): Promise<void> {
    // Derniers cours connus : affichés immédiatement, même hors ligne.
    const cached = await this.db.price.toArray();
    this.state = { ...this.state, prices: Object.fromEntries(cached.map((p) => [p.k, p])) };
    this.emit();
    this.flushTimer = setInterval(() => void this.flush(), 2000);
    window.addEventListener('online', () => this.connectTower());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.tower?.readyState !== WebSocket.OPEN) this.connectTower();
    });
    this.connectTower();
  }

  /** Actifs à suivre en direct si la tour tombe (mis à jour par l'application). */
  setTracked(keys: Iterable<string>): void {
    const next = new Set(keys);
    const changed = next.size !== this.trackedKeys.size || [...next].some((k) => !this.trackedKeys.has(k));
    this.trackedKeys = next;
    if (changed && this.direct) {
      this.closeDirect();
      this.openDirect();
    }
  }

  private setMode(mode: LiveMode): void {
    if (this.state.mode !== mode) {
      this.state = { ...this.state, mode };
      this.emit();
    }
  }

  private connectTower(): void {
    if (this.stopped) return;
    if (this.tower && (this.tower.readyState === WebSocket.OPEN || this.tower.readyState === WebSocket.CONNECTING)) return;
    this.armFallback();
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.towerUrl);
    } catch {
      this.retryTower();
      return;
    }
    this.tower = ws;
    ws.onopen = () => {
      this.towerRetry = 1000;
      if (this.fallbackTimer) clearTimeout(this.fallbackTimer);
      this.closeDirect();
      this.setMode('tower');
    };
    ws.onmessage = (ev) => {
      const msg = JSON.parse(String(ev.data)) as LiveMessage;
      if (msg.type === 'snapshot') msg.ticks.forEach((t) => this.accept(t, 'tower'));
      else if (msg.type === 'tick') this.accept(msg.tick, 'tower');
      else if (msg.type === 'feed-status') {
        this.state = { ...this.state, feed: msg.sources };
        this.emit();
      }
    };
    ws.onclose = () => {
      if (this.tower === ws) this.tower = null;
      if (this.state.mode === 'tower') this.setMode('connecting');
      this.armFallback();
      this.retryTower();
    };
    ws.onerror = () => ws.close();
  }

  private retryTower(): void {
    if (this.stopped) return;
    const delay = this.towerRetry;
    this.towerRetry = Math.min(this.towerRetry * 2, 30_000);
    setTimeout(() => this.connectTower(), delay);
  }

  private armFallback(): void {
    if (this.fallbackTimer || this.direct) return;
    this.fallbackTimer = setTimeout(() => {
      this.fallbackTimer = null;
      if (this.tower?.readyState !== WebSocket.OPEN) this.openDirect();
    }, FALLBACK_AFTER_MS);
  }

  private openDirect(): void {
    if (this.stopped || this.direct) return;
    if (!navigator.onLine) {
      this.setMode('offline');
      return;
    }
    const symbols = new Map<string, string>();
    for (const key of this.trackedKeys) {
      const s = krakenSymbolFor(key);
      if (s) symbols.set(s, key);
    }
    this.setMode('direct');
    if (symbols.size === 0) return;
    const ws = new WebSocket(KRAKEN_WS);
    this.direct = ws;
    ws.onopen = () => {
      // Un abonnement par symbole : un symbole refusé n'empêche pas les autres.
      for (const symbol of symbols.keys()) {
        ws.send(JSON.stringify({ method: 'subscribe', params: { channel: 'ticker', symbol: [symbol] } }));
      }
    };
    ws.onmessage = (ev) => {
      for (const tick of parseKrakenTicker(JSON.parse(String(ev.data)), (s) => symbols.get(s))) this.accept(tick, 'direct');
    };
    ws.onclose = () => {
      if (this.direct === ws) this.direct = null;
      // Toujours sans tour ? On retente le direct un peu plus tard.
      if (!this.stopped && this.tower?.readyState !== WebSocket.OPEN) {
        this.setMode(navigator.onLine ? 'connecting' : 'offline');
        setTimeout(() => {
          if (this.tower?.readyState !== WebSocket.OPEN) this.openDirect();
        }, 5000);
      }
    };
    ws.onerror = () => ws.close();
  }

  private closeDirect(): void {
    const ws = this.direct;
    this.direct = null;
    ws?.close();
  }

  private accept(tick: PriceTick, via: StoredPrice['via']): void {
    const current = this.state.prices[tick.k];
    if (current && current.t > tick.t) return;
    const stored: StoredPrice = { ...tick, via, receivedAt: Date.now() };
    this.state = { ...this.state, prices: { ...this.state.prices, [tick.k]: stored } };
    this.pendingWrites.set(tick.k, stored);
    this.emit();
  }

  private async flush(): Promise<void> {
    if (this.pendingWrites.size === 0) return;
    const batch = [...this.pendingWrites.values()];
    this.pendingWrites.clear();
    await this.db.price.bulkPut(batch);
  }

  stop(): void {
    this.stopped = true;
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.tower?.close();
    this.closeDirect();
  }
}
