import {
  ENTITIES,
  ENTITY_NAMES,
  shouldReplace,
  toCamel,
  toSnake,
  type Change,
  type EntityName,
  type SyncRequest,
  type SyncResponse,
  type Versioned,
} from '@pecule/shared';
import type { Pool, PoolClient } from '../db.js';

/** Verrou applicatif : les écritures de synchronisation sont sérialisées pour que
 *  l'ordre des numéros server_seq corresponde à l'ordre des validations. */
const SYNC_LOCK_ID = 727002;

export function rowToRecord(row: Record<string, unknown>): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === 'server_seq') continue;
    record[toCamel(key)] = value instanceof Date ? value.toISOString() : value;
  }
  return record;
}

/** Normalise un horodatage ISO pour que client et serveur comparent la même chaîne. */
function normalizeTimestamp(value: string): string {
  return new Date(value).toISOString();
}

async function applyChange(
  client: PoolClient,
  entity: EntityName,
  raw: Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { schema, table } = ENTITIES[entity];
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, reason: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
  }
  const record = { ...(parsed.data as Record<string, unknown>) } as Record<string, unknown> & Versioned;
  record.updatedAt = normalizeTimestamp(record.updatedAt);

  const existing = await client.query(`SELECT * FROM "${table}" WHERE id = $1 FOR UPDATE`, [record.id]);
  const current = existing.rows[0] ? (rowToRecord(existing.rows[0]) as unknown as Versioned) : undefined;
  if (!shouldReplace(current, record)) return { ok: true };

  const keys = Object.keys(record);
  const columns = keys.map((k) => `"${toSnake(k)}"`);
  const values = keys.map((k) => record[k]);
  const placeholders = keys.map((_, i) => `$${i + 1}`);
  const updates = columns.filter((c) => c !== '"id"').map((c) => `${c} = EXCLUDED.${c}`);
  await client.query(
    `INSERT INTO "${table}" (${columns.join(', ')}) VALUES (${placeholders.join(', ')})
     ON CONFLICT (id) DO UPDATE SET ${updates.join(', ')}, server_seq = nextval('sync_seq')`,
    values,
  );
  return { ok: true };
}

export async function pullChanges(db: Pool | PoolClient, since: number): Promise<{ cursor: number; changes: Change[] }> {
  const changes: Change[] = [];
  let cursor = since;
  for (const entity of ENTITY_NAMES) {
    const { table } = ENTITIES[entity];
    const { rows } = await db.query(`SELECT * FROM "${table}" WHERE server_seq > $1 ORDER BY server_seq`, [since]);
    for (const row of rows) {
      cursor = Math.max(cursor, Number(row.server_seq));
      changes.push({ entity, record: rowToRecord(row) });
    }
  }
  return { cursor, changes };
}

export async function sync(pool: Pool, request: SyncRequest): Promise<SyncResponse> {
  const rejected: SyncResponse['rejected'] = [];
  if (request.changes.length > 0) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1)', [SYNC_LOCK_ID]);
      for (const change of request.changes) {
        // Point de sauvegarde : une modification refusée par la base n'annule pas les autres.
        await client.query('SAVEPOINT change');
        try {
          const result = await applyChange(client, change.entity, change.record);
          if (!result.ok) rejected.push({ entity: change.entity, id: change.record.id, reason: result.reason });
          await client.query('RELEASE SAVEPOINT change');
        } catch (err) {
          await client.query('ROLLBACK TO SAVEPOINT change');
          rejected.push({ entity: change.entity, id: change.record.id, reason: (err as Error).message });
        }
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }
  const { cursor, changes } = await pullChanges(pool, request.since);
  return { cursor, changes, rejected };
}
