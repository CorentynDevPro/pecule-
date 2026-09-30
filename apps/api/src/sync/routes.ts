import type { FastifyInstance } from 'fastify';
import { syncRequestSchema, type SyncRequest } from '@pecule/shared';
import type { Pool } from '../db.js';
import { sync } from './service.js';

export async function syncRoutes(app: FastifyInstance, opts: { pool: Pool }): Promise<void> {
  app.post('/api/sync', async (request, reply) => {
    const parsed = syncRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Requête de synchronisation invalide', issues: parsed.error.issues });
    }
    const response = await sync(opts.pool, parsed.data as SyncRequest);
    if (response.rejected.length > 0) {
      request.log.warn({ rejected: response.rejected }, 'Modifications refusées pendant la synchronisation');
    }
    return response;
  });
}
