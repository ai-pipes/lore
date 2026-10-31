import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { getDb } from '../db.js';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => ({ status: 'ok' }));

  app.get('/health/live', async () => ({ status: 'ok' }));

  app.get('/health/ready', async (_, reply) => {
    try {
      await getDb().execute(sql`SELECT 1`);
      return { status: 'ok' };
    } catch {
      reply.status(503);
      return { status: 'error', message: 'database unavailable' };
    }
  });
}
