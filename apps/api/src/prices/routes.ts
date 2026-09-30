import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Candle, DailyClose, PriceTick } from '@pecule/shared';
import type { Pool } from '../db.js';

const INTERVALS: Record<string, number> = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14_400 };

const candlesQuery = z.object({
  key: z.string().min(3).max(80),
  interval: z.enum(['1m', '5m', '15m', '1h', '4h']).default('5m'),
  hours: z.coerce.number().int().min(1).max(24 * 30).default(24),
});

const dailyQuery = z.object({
  keys: z.string().min(3).max(2000),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function latestTicks(pool: Pool): Promise<PriceTick[]> {
  const { rows } = await pool.query<{
    quote_key: string;
    price: number;
    currency: string;
    change_pct: number | null;
    source_ts: Date;
  }>('SELECT quote_key, price, currency, change_pct, source_ts FROM price_latest');
  return rows.map((r) => ({ k: r.quote_key, p: r.price, c: r.currency, chg: r.change_pct, t: r.source_ts.getTime() }));
}

export async function priceRoutes(app: FastifyInstance, opts: { pool: Pool }): Promise<void> {
  const { pool } = opts;

  app.get('/api/prices/latest', async () => latestTicks(pool));

  // Bougies agrégées à partir des bougies d'une minute
  app.get('/api/prices/candles', async (request, reply) => {
    const parsed = candlesQuery.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'Paramètres invalides', issues: parsed.error.issues });
    const { key, interval, hours } = parsed.data;
    const step = INTERVALS[interval]!;
    const { rows } = await pool.query<{
      bucket: Date;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
    }>(
      `SELECT to_timestamp(floor(extract(epoch FROM ts) / $2) * $2) AS bucket,
              (array_agg(open ORDER BY ts))[1] AS open,
              max(high) AS high,
              min(low) AS low,
              (array_agg(close ORDER BY ts DESC))[1] AS close,
              sum(volume) AS volume
         FROM price_candle_1m
        WHERE quote_key = $1 AND ts >= now() - make_interval(hours => $3)
        GROUP BY bucket
        ORDER BY bucket
        LIMIT 5000`,
      [key, step, hours],
    );
    const candles: Candle[] = rows.map((r) => ({
      ts: r.bucket.getTime(),
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
      volume: r.volume,
    }));
    return candles;
  });

  // Clôtures quotidiennes de plusieurs actifs, pour la courbe de valeur du portefeuille
  app.get('/api/prices/daily', async (request, reply) => {
    const parsed = dailyQuery.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'Paramètres invalides', issues: parsed.error.issues });
    const keys = parsed.data.keys.split(',').map((k) => k.trim()).filter(Boolean).slice(0, 100);
    const { rows } = await pool.query<{ quote_key: string; day: string; close: number }>(
      `SELECT quote_key, day, close FROM price_daily
        WHERE quote_key = ANY($1) AND day >= $2
        ORDER BY quote_key, day`,
      [keys, parsed.data.from],
    );
    const result: Record<string, DailyClose[]> = Object.fromEntries(keys.map((k) => [k, []]));
    for (const r of rows) result[r.quote_key]?.push({ day: r.day, close: r.close });
    return result;
  });
}
