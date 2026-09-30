/**
 * Kraken, utilisé directement par l'appareil (sans passer par la tour).
 * Tout passe par le WebSocket public v2 : il fonctionne depuis un navigateur,
 * sans clé, et fournit aussi l'historique (canal « ohlc »).
 */
import type { Candle, DailyClose, PriceTick } from '@pecule/shared';

export const KRAKEN_WS = 'wss://ws.kraken.com/v2';

/** Clé de cotation → paire Kraken. Le change EUR/USD existe aussi chez Kraken. */
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

interface OhlcRow {
  symbol?: string;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
  interval_begin?: string;
}

export function parseOhlcSnapshot(message: unknown, symbol: string): Candle[] | null {
  const m = message as { channel?: string; type?: string; data?: OhlcRow[] };
  if (m.channel !== 'ohlc' || m.type !== 'snapshot') return null;
  const rows = (m.data ?? []).filter((d) => d.symbol === symbol && d.interval_begin && typeof d.close === 'number');
  return rows
    .map((d) => ({
      ts: Date.parse(d.interval_begin!),
      open: d.open ?? d.close!,
      high: d.high ?? d.close!,
      low: d.low ?? d.close!,
      close: d.close!,
      volume: d.volume ?? 0,
    }))
    .filter((c) => Number.isFinite(c.ts))
    .sort((a, b) => a.ts - b.ts);
}

/** Bougies récentes d'une paire (instantané du canal ohlc), en une connexion éphémère. */
export function fetchKrakenCandles(symbol: string, intervalMinutes: 1 | 5 | 15 | 30 | 60 | 240 | 1440, timeoutMs = 10_000): Promise<Candle[]> {
  return new Promise((resolve, reject) => {
    let done = false;
    const ws = new WebSocket(KRAKEN_WS);
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      ws.close();
      fn();
    };
    const timer = setTimeout(() => finish(() => reject(new Error('Kraken ne répond pas'))), timeoutMs);
    ws.onopen = () => ws.send(JSON.stringify({ method: 'subscribe', params: { channel: 'ohlc', symbol: [symbol], interval: intervalMinutes, snapshot: true } }));
    ws.onmessage = (ev) => {
      const msg = JSON.parse(String(ev.data)) as { method?: string; success?: boolean; error?: string };
      if (msg.method === 'subscribe' && msg.success === false) return finish(() => reject(new Error(msg.error ?? 'Paire refusée par Kraken')));
      const candles = parseOhlcSnapshot(msg, symbol);
      if (candles) finish(() => resolve(candles));
    };
    ws.onerror = () => finish(() => reject(new Error('Connexion à Kraken impossible')));
  });
}

export async function fetchKrakenDaily(symbol: string): Promise<DailyClose[]> {
  const candles = await fetchKrakenCandles(symbol, 1440);
  return candles.map((c) => ({ day: new Date(c.ts).toISOString().slice(0, 10), close: c.close }));
}
