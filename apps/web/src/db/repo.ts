/**
 * Écritures locales. Chaque modification :
 *  1. est validée avec le même schéma que la tour,
 *  2. est enregistrée sur l'appareil,
 *  3. est mise en file d'attente pour être envoyée à la tour dès qu'elle répond.
 */
import { ENTITIES, type EntityName, type EntityRecordMap } from '@pecule/shared';
import type { LocalDb } from './local';

type Draft<E extends EntityName> = Omit<EntityRecordMap[E], 'updatedAt' | 'deleted' | 'id'> & { id?: string };

export class ValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(issues.join(' · '));
  }
}

export function newId(): string {
  return crypto.randomUUID();
}

/** Horodatage strictement croissant, même pour deux écritures dans la même milliseconde. */
let lastStamp = 0;
function stamp(): string {
  const now = Math.max(Date.now(), lastStamp + 1);
  lastStamp = now;
  return new Date(now).toISOString();
}

export class Repo {
  private listeners = new Set<() => void>();

  constructor(private readonly db: LocalDb) {}

  /** Prévenu après chaque écriture locale (déclenche une synchronisation). */
  onWrite(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  async save<E extends EntityName>(entity: E, draft: Draft<E>): Promise<EntityRecordMap[E]> {
    const record = { ...draft, id: draft.id ?? newId(), updatedAt: stamp(), deleted: false };
    const parsed = ENTITIES[entity].schema.safeParse(record);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i) => i.message));
    }
    const value = parsed.data as EntityRecordMap[E];
    await this.write(entity, value as unknown as { id: string; updatedAt: string; deleted: boolean });
    return value;
  }

  async remove(entity: EntityName, id: string): Promise<void> {
    const table = this.db.entityTable(entity);
    const current = await table.get(id);
    if (!current) return;
    await this.write(entity, { ...current, deleted: true, updatedAt: stamp() });
  }

  private async write(entity: EntityName, value: { id: string; updatedAt: string; deleted: boolean }): Promise<void> {
    const table = this.db.entityTable(entity);
    await this.db.transaction('rw', table, this.db.outbox, async () => {
      await table.put(value);
      await this.db.outbox.put({ key: `${entity}:${value.id}`, entity, id: value.id, updatedAt: value.updatedAt });
    });
    for (const fn of this.listeners) fn();
  }
}
