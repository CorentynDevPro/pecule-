/**
 * Cours en direct, avec repli automatique.
 *
 * - Avec une tour : l'appareil écoute /api/live, qui agrège toutes les sources.
 * - Sans tour, ou tour muette depuis 8 s : l'appareil se branche lui-même sur Kraken
 *   (crypto et EUR/USD, temps réel) et, si une clé est enregistrée, sur Twelve Data
 *   (actions US et change, dans la limite du budget gratuit).
 * - Les actifs sans source (un ETF européen sans tour, par exemple) acceptent un cours saisi à la main.
 */
import type { LiveMessage, PriceTick } from '@pecule/shared';
import type { LocalDb, StoredPrice } from '../db/local';
import { KRAKEN_WS, krakenSymbolFor, parseKrakenTicker } from './kraken';
import { fetchQuotes, forexOpen, parseQuotes, pollIntervalSeconds, twelveDataSymbolFor, usMarketOpen } from './twelvedata';

export { krakenSymbolFor, parseKrakenTicker };

export type LiveMode = 'tower' | 'direct' | 'offline' | 'connecting';

export interface SourceHealth {
  ok: boolean;
  lastTickAt: number | null;
  error?: string;
}

export interface LiveState {
  mode: LiveMode;
  /** Vrai quand aucune tour n'est configurée sur cet appareil */
  standalone: boolean;
  prices: Record<string, StoredPrice>;
  /** État des sources : celles de la tour, ou celles utilisées directement par l'appareil */
  feed: Record<string, SourceHealth>;
}

export interface LiveConfig {
  /** Adresse WebSocket de la tour, ou null sans tour */
  towerWs: () => string | null;
  /** Clé Twelve Data de l'appareil ('' = aucune) */
  twelveDataKey: () => string;
}

const FALLBACK_AFTER_MS = 8_000;
const TD_DAILY_CREDITS = 760;

export class LivePrices {
  state: LiveState = { mode: 'connecting', standalone: false, prices: {}, feed: {} };
  private listeners = new Set<(s: LiveState) => void>();
  private tower: WebSocket | null = null;
  private direct: WebSocket | null = null;
  private towerRetry = 1000;
  private towerTimer: ReturnType<typeof setTimeout> | null = null;
  private fallbackTimer: ReturnType<typeof setTimeout> | null = null;
  private tdTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingWrites = new Map<string, StoredPrice>();
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private trackedKeys = new Set<string>();
  private currencies: Record<string, string> = {};
  private stopped = false;
  private generation = 0;

  constructor(
    private readonly db: LocalDb,
    private readonly config: LiveConfig,
  ) {}

  subscribe(fn: (s: LiveState) => void): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  private emit(patch: Partial<LiveState> = {}): void {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn(this.state);
  }

  private setFeed(name: string, health: SourceHealth): void {
    this.emit({ feed: { ...this.state.feed, [name]: health } });
  }

  async start(): Promise<void> {
    // Derniers cours connus : affichés immédiatement, même hors ligne.
    const cached = await this.db.price.toArray();
    this.emit({ prices: Object.fromEntries(cached.map((p) => [p.k, p])) });
    this.flushTimer = setInterval(() => void this.flush(), 2000);
    window.addEventListener('online', () => this.reconnect());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.state.mode !== 'tower') this.reconnect();
    });
    this.reconnect();
  }

  /** À appeler quand l'adresse de la tour ou la clé changent. */
  reconnect(): void {
    if (this.stopped) return;
    this.generation++;
    this.clearTimers();
    this.tower?.close();
    this.tower = null;
    const towerWs = this.config.towerWs();
    this.emit({ standalone: towerWs === null, feed: {} });
    if (towerWs === null) {
      this.goDirect();
    } else {
      this.towerRetry = 1000;
      this.connectTower(towerWs);
    }
  }

  /** Actifs à suivre (mis à jour par l'application). */
  setTracked(keys: Iterable<string>, currencies: Record<string, string> = {}): void {
    this.currencies = currencies;
    const next = new Set(keys);
    const changed = next.size !== this.trackedKeys.size || [...next].some((k) => !this.trackedKeys.has(k));
    this.trackedKeys = next;
    if (changed && this.state.mode === 'direct') {
      this.closeDirect();
      this.goDirect();
    }
  }

  /** Cours saisi à la main (actif sans source automatique, ou source indisponible). */
  setManual(quoteKey: string, price: number, currency: string): void {
    this.accept({ k: quoteKey, p: price, c: currency, chg: null, t: Date.now() }, 'manual', true);
    void this.flush();
  }

  // --- Tour ------------------------------------------------------------------------

  private connectTower(url: string): void {
    if (this.stopped) return;
    const gen = this.generation;
    this.armFallback();
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      this.retryTower(url, gen);
      return;
    }
    this.tower = ws;
    ws.onopen = () => {
      if (gen !== this.generation) return ws.close();
      this.towerRetry = 1000;
      this.clearFallback();
      this.closeDirect();
      this.stopTwelveData();
      this.emit({ mode: 'tower' });
    };
    ws.onmessage = (ev) => {
      const msg = JSON.parse(String(ev.data)) as LiveMessage;
      if (msg.type === 'snapshot') msg.ticks.forEach((t) => this.accept(t, 'tower'));
      else if (msg.type === 'tick') this.accept(msg.tick, 'tower');
      else if (msg.type === 'feed-status') this.emit({ feed: msg.sources });
    };
    ws.onclose = () => {
      if (gen !== this.generation) return;
      if (this.tower === ws) this.tower = null;
      if (this.state.mode === 'tower') this.emit({ mode: 'connecting' });
      this.armFallback();
      this.retryTower(url, gen);
    };
    ws.onerror = () => ws.close();
  }

  private retryTower(url: string, gen: number): void {
    if (this.stopped || gen !== this.generation) return;
    const delay = this.towerRetry;
    this.towerRetry = Math.min(this.towerRetry * 2, 30_000);
    this.towerTimer = setTimeout(() => this.connectTower(url), delay);
  }

  private armFallback(): void {
    if (this.fallbackTimer || this.state.mode === 'direct') return;
    this.fallbackTimer = setTimeout(() => {
      this.fallbackTimer = null;
      if (this.tower?.readyState !== WebSocket.OPEN) this.goDirect();
    }, FALLBACK_AFTER_MS);
  }

  private clearFallback(): void {
    if (this.fallbackTimer) clearTimeout(this.fallbackTimer);
    this.fallbackTimer = null;
  }

  // --- Sources directes ------------------------------------------------------------------

  private goDirect(): void {
    if (this.stopped) return;
    if (!navigator.onLine) {
      this.emit({ mode: 'offline' });
      return;
    }
    this.emit({ mode: 'direct' });
    this.openKraken();
    this.startTwelveData();
  }

  private openKraken(): void {
    if (this.direct) return;
    const symbols = new Map<string, string>();
    for (const key of this.trackedKeys) {
      const s = krakenSymbolFor(key);
      if (s) symbols.set(s, key);
    }
    if (symbols.size === 0) return;
    const gen = this.generation;
    const ws = new WebSocket(KRAKEN_WS);
    this.direct = ws;
    ws.onopen = () => {
      this.setFeed('kraken', { ok: true, lastTickAt: this.state.feed.kraken?.lastTickAt ?? null });
      // Un abonnement par paire : une paire refusée n'empêche pas les autres.
      for (const symbol of symbols.keys()) {
        ws.send(JSON.stringify({ method: 'subscribe', params: { channel: 'ticker', symbol: [symbol] } }));
      }
    };
    ws.onmessage = (ev) => {
      const ticks = parseKrakenTicker(JSON.parse(String(ev.data)), (s) => symbols.get(s));
      for (const tick of ticks) this.accept(tick, 'direct');
      if (ticks.length) this.setFeed('kraken', { ok: true, lastTickAt: Date.now() });
    };
    ws.onclose = () => {
      if (this.direct === ws) this.direct = null;
      if (this.stopped || gen !== this.generation || this.state.mode === 'tower') return;
      this.setFeed('kraken', { ok: false, lastTickAt: this.state.feed.kraken?.lastTickAt ?? null, error: 'déconnecté' });
      if (!navigator.onLine) this.emit({ mode: 'offline' });
      setTimeout(() => {
        if (gen === this.generation && this.state.mode !== 'tower') this.openKraken();
      }, 5000);
    };
    ws.onerror = () => ws.close();
  }

  private closeDirect(): void {
    const ws = this.direct;
    this.direct = null;
    ws?.close();
  }

  private startTwelveData(): void {
    if (this.tdTimer) return;
    const gen = this.generation;
    const loop = async () => {
      this.tdTimer = null;
      if (this.stopped || gen !== this.generation || this.state.mode === 'tower') return;
      const apiKey = this.config.twelveDataKey();
      const wanted = new Map<string, { key: string; currency: string }>();
      for (const key of this.trackedKeys) {
        const symbol = twelveDataSymbolFor(key);
        // EUR/USD vient déjà de Kraken en temps réel : inutile de dépenser un crédit.
        if (!symbol || key === 'fx:EUR/USD') continue;
        const currency = key.startsWith('fx:') ? symbol.split('/')[1]! : (this.currencies[key] ?? 'USD');
        wanted.set(symbol, { key, currency });
      }
      const now = new Date();
      const active = [...wanted.keys()].filter((s) => (s.includes('/') ? forexOpen(now) : usMarketOpen(now)));
      // Au premier passage, on prend un cours même marché fermé pour ne pas afficher de vide.
      const needFirst = [...wanted.keys()].filter((s) => !this.state.prices[wanted.get(s)!.key]);
      const batch = [...new Set([...active, ...needFirst])];
      if (apiKey && batch.length) {
        try {
          for (let i = 0; i < batch.length; i += 8) {
            const part = batch.slice(i, i + 8);
            const payload = await fetchQuotes(apiKey, part);
            const ticks = parseQuotes(payload, part, (s) => wanted.get(s)!.key, (s) => wanted.get(s)!.currency);
            for (const t of ticks) this.accept(t, 'direct');
          }
          this.setFeed('td', { ok: true, lastTickAt: Date.now() });
        } catch (err) {
          this.setFeed('td', { ok: false, lastTickAt: this.state.feed.td?.lastTickAt ?? null, error: (err as Error).message });
        }
      } else if (wanted.size && !apiKey) {
        this.setFeed('td', { ok: false, lastTickAt: null, error: 'aucune clé enregistrée' });
      }
      const delay = pollIntervalSeconds(Math.max(active.length, 1), TD_DAILY_CREDITS) * 1000;
      this.tdTimer = setTimeout(() => void loop(), delay);
    };
    this.tdTimer = setTimeout(() => void loop(), 500);
  }

  private stopTwelveData(): void {
    if (this.tdTimer) clearTimeout(this.tdTimer);
    this.tdTimer = null;
  }

  private clearTimers(): void {
    this.clearFallback();
    if (this.towerTimer) clearTimeout(this.towerTimer);
    this.towerTimer = null;
    this.stopTwelveData();
    this.closeDirect();
  }

  // --- Stockage ----------------------------------------------------------------------

  private accept(tick: PriceTick, via: StoredPrice['via'], force = false): void {
    const current = this.state.prices[tick.k];
    if (!force && current && current.t > tick.t) return;
    const stored: StoredPrice = { ...tick, via, receivedAt: Date.now() };
    this.pendingWrites.set(tick.k, stored);
    this.emit({ prices: { ...this.state.prices, [tick.k]: stored } });
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
    this.clearTimers();
    this.tower?.close();
  }
}
