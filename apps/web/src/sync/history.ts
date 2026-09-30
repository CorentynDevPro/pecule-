/**
 * Historique des clôtures quotidiennes, gardé en cache sur l'appareil pour que les courbes
 * s'affichent aussi hors connexion.
 * - Avec une tour : la tour fournit tout.
 * - Sans tour : Kraken (crypto, EUR/USD) et Twelve Data (actions US, avec ta clé) directement.
 */
import type { DailyClose } from '@pecule/shared';
import type { LocalDb } from '../db/local';
import { apiBase, getSettings } from '../device/settings';
import { fetchKrakenDaily, krakenSymbolFor } from '../live/kraken';
import { fetchDailyCloses, twelveDataSymbolFor } from '../live/twelvedata';

const REFRESH_MS = 6 * 3600_000;

async function fetchFromTower(base: string, keys: string[], from: string): Promise<Record<string, DailyClose[]>> {
  const params = new URLSearchParams({ keys: keys.join(','), from });
  const res = await fetch(`${base}/api/prices/daily?${params}`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()) as Record<string, DailyClose[]>;
}

async function fetchDirect(key: string): Promise<DailyClose[] | null> {
  const kraken = krakenSymbolFor(key);
  if (kraken) return fetchKrakenDaily(kraken);
  const td = twelveDataSymbolFor(key);
  const apiKey = getSettings().twelveDataKey;
  if (td && apiKey) return fetchDailyCloses(apiKey, td);
  return null; // pas de source directe (ex. Yahoo, réservé à la tour)
}

export async function loadDaily(db: LocalDb, keys: string[], from: string): Promise<Record<string, DailyClose[]>> {
  const cached = await db.daily.bulkGet(keys);
  const result: Record<string, DailyClose[]> = {};
  const stale: string[] = [];
  keys.forEach((k, i) => {
    const row = cached[i];
    result[k] = row?.closes ?? [];
    if (!row || Date.now() - row.fetchedAt > REFRESH_MS) stale.push(k);
  });
  if (stale.length === 0) return result;

  const now = Date.now();
  const base = apiBase();
  if (base !== null) {
    try {
      const fresh = await fetchFromTower(base, stale, from);
      await db.daily.bulkPut(Object.entries(fresh).map(([quoteKey, closes]) => ({ quoteKey, closes, fetchedAt: now })));
      Object.assign(result, fresh);
      return result;
    } catch {
      // Tour injoignable : on tente les sources directes
    }
  }
  for (const key of stale) {
    try {
      const closes = await fetchDirect(key);
      if (!closes) continue;
      await db.daily.put({ quoteKey: key, closes, fetchedAt: now });
      result[key] = closes;
    } catch {
      // Source indisponible : on garde le cache
    }
  }
  return result;
}
