/**
 * Twelve Data interrogé directement par l'appareil, avec ta clé gratuite gardée sur l'appareil.
 * Sert quand la tour est absente : actions américaines et taux de change.
 * Le budget gratuit (800 crédits par jour, 8 par minute) est réparti sur la séance américaine.
 */
import type { DailyClose, PriceTick } from '@pecule/shared';

const BASE = 'https://api.twelvedata.com';
export const US_SESSION_MINUTES = 390;

function zoned(now: Date, timeZone: string): { weekday: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const weekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(get('weekday'));
  return { weekday, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

/** Séance régulière américaine : 9 h 30 – 16 h à New York, du lundi au vendredi. */
export function usMarketOpen(now = new Date()): boolean {
  const { weekday, minutes } = zoned(now, 'America/New_York');
  return weekday < 5 && minutes >= 570 && minutes < 960;
}

/** Marché des changes : du dimanche 23 h au vendredi 23 h, heure de Paris. */
export function forexOpen(now = new Date()): boolean {
  const { weekday, minutes } = zoned(now, 'Europe/Paris');
  if (weekday === 5) return false;
  if (weekday === 6) return minutes >= 23 * 60;
  if (weekday === 4) return minutes < 23 * 60;
  return true;
}

export function pollIntervalSeconds(symbolCount: number, dailyCredits: number, perMinute = 8): number {
  if (symbolCount <= 0) return 60;
  const refreshes = dailyCredits / symbolCount;
  const byDay = Math.ceil((US_SESSION_MINUTES * 60) / Math.max(refreshes, 1));
  const byMinute = Math.ceil((60 * symbolCount) / perMinute);
  return Math.max(60, byDay, byMinute);
}

interface Quote {
  symbol?: string;
  close?: string;
  percent_change?: string;
  timestamp?: number;
  last_quote_at?: number;
  status?: string;
}

export function parseQuotes(payload: unknown, symbols: string[], keyOf: (s: string) => string, currencyOf: (s: string) => string): PriceTick[] {
  let map = payload as Record<string, Quote>;
  if (symbols.length === 1 && (payload as Quote).symbol) map = { [symbols[0]!]: payload as Quote };
  const ticks: PriceTick[] = [];
  for (const s of symbols) {
    const q = map[s];
    if (!q || q.status === 'error' || q.close === undefined) continue;
    const ts = q.last_quote_at ?? q.timestamp;
    const chg = q.percent_change;
    ticks.push({ k: keyOf(s), p: Number(q.close), c: currencyOf(s), chg: chg === undefined || chg === '' ? null : Number(chg), t: ts ? ts * 1000 : Date.now() });
  }
  return ticks.filter((t) => Number.isFinite(t.p));
}

export async function fetchQuotes(apiKey: string, symbols: string[]): Promise<unknown> {
  const params = new URLSearchParams({ symbol: symbols.join(','), apikey: apiKey });
  const res = await fetch(`${BASE}/quote?${params}`, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Twelve Data a répondu ${res.status}`);
  const body = (await res.json()) as { status?: string; message?: string };
  if (body.status === 'error') throw new Error(body.message ?? 'Erreur Twelve Data');
  return body;
}

export async function fetchDailyCloses(apiKey: string, symbol: string, days = 400): Promise<DailyClose[]> {
  const params = new URLSearchParams({ symbol, interval: '1day', outputsize: String(days), apikey: apiKey });
  const res = await fetch(`${BASE}/time_series?${params}`, { signal: AbortSignal.timeout(20_000) });
  const body = (await res.json()) as { status?: string; message?: string; values?: { datetime: string; close: string }[] };
  if (body.status === 'error') throw new Error(body.message ?? 'Erreur Twelve Data');
  return (body.values ?? []).map((v) => ({ day: v.datetime.slice(0, 10), close: Number(v.close) })).reverse();
}

/** Clé de cotation → symbole Twelve Data (td:TTWO → TTWO, fx:EUR/USD → EUR/USD). */
export function twelveDataSymbolFor(quoteKey: string): string | null {
  if (quoteKey.startsWith('td:')) return quoteKey.slice(3);
  if (quoteKey.startsWith('fx:')) return quoteKey.slice(3);
  return null;
}
