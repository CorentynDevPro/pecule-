/**
 * Historique des clôtures quotidiennes : récupéré depuis la tour, gardé en cache sur l'appareil
 * pour que la courbe de valeur s'affiche aussi hors connexion.
 */
import type { DailyClose } from '@pecule/shared';
import type { LocalDb } from '../db/local';

const REFRESH_MS = 6 * 3600_000;

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
  try {
    const params = new URLSearchParams({ keys: stale.join(','), from });
    const res = await fetch(`/api/prices/daily?${params}`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return result;
    const fresh = (await res.json()) as Record<string, DailyClose[]>;
    const now = Date.now();
    await db.daily.bulkPut(Object.entries(fresh).map(([quoteKey, closes]) => ({ quoteKey, closes, fetchedAt: now })));
    Object.assign(result, fresh);
  } catch {
    // Tour injoignable : on garde le cache
  }
  return result;
}
