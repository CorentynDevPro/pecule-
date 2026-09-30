/**
 * Cours de marché.
 * Une clé de cotation (`quoteKey`) indique la source et le symbole :
 *   kraken:BTC/EUR   crypto, temps réel via le WebSocket public de Kraken
 *   td:TTWO          action US, Twelve Data
 *   fx:EUR/USD       taux de change (Twelve Data si une clé est configurée, sinon Yahoo)
 *   yf:CW8.PA        Euronext et autres places, Yahoo Finance (environ 15 min de décalage)
 */

export interface PriceTick {
  /** Clé de cotation */
  k: string;
  /** Dernier prix */
  p: number;
  /** Devise du prix */
  c: string;
  /** Variation depuis la clôture précédente, en %, si connue */
  chg: number | null;
  /** Horodatage de la source, en millisecondes */
  t: number;
}

export interface Candle {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface DailyClose {
  day: string;
  close: number;
}

export type QuoteSource = 'kraken' | 'td' | 'yf' | 'fx';

export function parseQuoteKey(key: string): { source: QuoteSource; symbol: string } | null {
  const idx = key.indexOf(':');
  if (idx <= 0) return null;
  const source = key.slice(0, idx);
  const symbol = key.slice(idx + 1);
  if (!symbol || !['kraken', 'td', 'yf', 'fx'].includes(source)) return null;
  return { source: source as QuoteSource, symbol };
}

/** Clé du taux de change utilisé pour convertir une devise en euros. */
export function fxKeyFor(currency: string): string | null {
  if (currency === 'EUR') return null;
  return `fx:EUR/${currency}`;
}

/** Messages envoyés par la tour sur le WebSocket /api/live. */
export type LiveMessage =
  | { type: 'snapshot'; ticks: PriceTick[] }
  | { type: 'tick'; tick: PriceTick }
  | { type: 'feed-status'; sources: Record<string, { ok: boolean; lastTickAt: number | null }> };
