import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import type { Config } from './config.js';
import { createPool, type Pool } from './db.js';
import { LiveHub } from './live/hub.js';
import { latestTicks, priceRoutes } from './prices/routes.js';
import { syncRoutes } from './sync/routes.js';

export interface AppContext {
  app: FastifyInstance;
  pool: Pool;
  hub: LiveHub;
}

export async function buildApp(config: Config, pool: Pool = createPool(config.DATABASE_URL)): Promise<AppContext> {
  const app = Fastify({
    logger: { level: config.LOG_LEVEL },
    bodyLimit: 5 * 1024 * 1024,
  });
  const hub = new LiveHub(config.DATABASE_URL, app.log);

  await app.register(websocket, { options: { maxPayload: 64 * 1024 } });
  await app.register(syncRoutes, { pool });
  await app.register(priceRoutes, { pool });

  app.get('/api/health', async () => {
    let db = false;
    try {
      await pool.query('SELECT 1');
      db = true;
    } catch {
      db = false;
    }
    return {
      ok: db,
      db,
      live: hub.listening,
      connectedDevices: hub.clientCount,
      feed: hub.feedStatus,
      serverTime: new Date().toISOString(),
    };
  });

  app.register(async (scope) => {
    scope.get('/api/live', { websocket: true }, async (socket) => {
      const snapshot = await latestTicks(pool).catch(() => []);
      hub.add(socket, snapshot);
    });
  });

  app.addHook('onClose', async () => {
    await hub.stop();
    await pool.end();
  });

  return { app, pool, hub };
}
