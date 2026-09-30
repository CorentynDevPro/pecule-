import pg from 'pg';

// Conversions de types PostgreSQL → JavaScript, fixées une fois pour toute l'application :
// - date (1082) reste une chaîne « AAAA-MM-JJ » : un objet Date décalerait le jour selon le fuseau
// - bigint (20) devient un nombre : les montants en centimes restent loin de 2^53
// - numeric (1700) devient un nombre : quantités et prix n'ont pas besoin de plus de 15 chiffres
pg.types.setTypeParser(1082, (v) => v);
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v));

export type Pool = pg.Pool;
export type PoolClient = pg.PoolClient;

export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000 });
}

export { pg };
