/**
 * Réglages propres à cet appareil, jamais synchronisés :
 * - l'adresse de la tour (vide = aucune tour : mode autonome) ;
 * - la clé Twelve Data, utilisée par l'appareil lui-même quand la tour est absente.
 *
 * Deux façons de servir l'application :
 * - depuis la tour (build par défaut) : la tour est à la même adresse que l'application ;
 * - depuis GitHub Pages (build autonome) : aucune tour tant que tu n'en indiques pas une.
 */
import type { LocalDb } from '../db/local';

export const STANDALONE_BUILD = import.meta.env.VITE_STANDALONE === '1';

export interface DeviceSettings {
  /** null = pas de tour ; '' = même adresse que l'application ; sinon https://tour.xxx.ts.net */
  towerUrl: string | null;
  twelveDataKey: string;
}

const KEY = 'deviceSettings';

export function defaultSettings(): DeviceSettings {
  return { towerUrl: STANDALONE_BUILD ? null : '', twelveDataKey: '' };
}

let current: DeviceSettings = defaultSettings();
const listeners = new Set<(s: DeviceSettings) => void>();

export function getSettings(): DeviceSettings {
  return current;
}

export async function loadSettings(db: LocalDb): Promise<DeviceSettings> {
  current = { ...defaultSettings(), ...(await db.getMeta<Partial<DeviceSettings>>(KEY, {})) };
  return current;
}

export async function saveSettings(db: LocalDb, patch: Partial<DeviceSettings>): Promise<DeviceSettings> {
  current = { ...current, ...patch };
  await db.setMeta(KEY, current);
  for (const fn of listeners) fn(current);
  return current;
}

export function onSettings(fn: (s: DeviceSettings) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Normalise une adresse saisie : « tour.tail1234.ts.net » → « https://tour.tail1234.ts.net » */
export function normalizeTowerUrl(input: string): string | null {
  const trimmed = input.trim().replace(/\/+$/, '');
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const u = new URL(withScheme);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

/** Base HTTP de l'API, ou null sans tour. */
export function apiBase(s: DeviceSettings = current): string | null {
  return s.towerUrl;
}

/** Adresse WebSocket des cours en direct, ou null sans tour. */
export function liveUrl(s: DeviceSettings = current): string | null {
  if (s.towerUrl === null) return null;
  const base = s.towerUrl || `${location.protocol}//${location.host}`;
  return `${base.replace(/^http/, 'ws')}/api/live`;
}
