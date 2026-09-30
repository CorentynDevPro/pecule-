/**
 * Protocole de synchronisation local-first.
 *
 * Chaque appareil garde toutes ses données en local et fonctionne sans la tour.
 * Quand la tour répond, l'appareil envoie ses modifications en attente et reçoit
 * celles des autres appareils en un seul aller-retour :
 *
 *   POST /api/sync  { since, changes }  →  { cursor, changes }
 *
 * `since` est le dernier curseur reçu ; le serveur renvoie tout ce qui a changé après.
 */
import { z } from 'zod';
import { ENTITY_NAMES, type EntityName } from './entities.js';

export const changeSchema = z.object({
  entity: z.enum(ENTITY_NAMES as [EntityName, ...EntityName[]]),
  record: z.record(z.unknown()),
});

export const syncRequestSchema = z.object({
  since: z.number().int().nonnegative(),
  changes: z.array(changeSchema).max(5000),
});

export type Change = { entity: EntityName; record: Record<string, unknown> };
export type SyncRequest = { since: number; changes: Change[] };
export type SyncResponse = {
  cursor: number;
  changes: Change[];
  /** Modifications refusées par le serveur (validation), avec la raison. */
  rejected: { entity: string; id: unknown; reason: string }[];
};

/** Enregistrement minimal pour appliquer la règle « la dernière écriture gagne ». */
export interface Versioned {
  id: string;
  updatedAt: string;
}

/**
 * Faut-il remplacer `current` par `incoming` ?
 * La date la plus récente gagne ; à égalité, l'identifiant le plus grand départage,
 * pour que tous les appareils convergent vers le même état.
 */
export function shouldReplace(current: Versioned | undefined, incoming: Versioned): boolean {
  if (!current) return true;
  const a = Date.parse(current.updatedAt);
  const b = Date.parse(incoming.updatedAt);
  if (b !== a) return b > a;
  return canonical(incoming) > canonical(current);
}

/** Sérialisation à clés triées : deux appareils obtiennent la même chaîne pour le même contenu. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
