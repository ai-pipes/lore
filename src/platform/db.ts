import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import path from 'path';
import { existsSync } from 'fs';
import * as catalogSchema from '../modules/catalog/infrastructure/schema.js';
import * as chatSchema from '../modules/chat/infrastructure/schema.js';
import * as identitySchema from '../modules/identity/infrastructure/schema.js';

/** The schemas of all modules, combined. */
const schema = { ...catalogSchema, ...chatSchema, ...identitySchema };

export type DbClient = PostgresJsDatabase<typeof schema>;

let db: DbClient | null = null;

export function getDb(): DbClient {
  if (!db) throw new Error('Database not initialized. Call initDb() first.');
  return db;
}

export function resetDb(): void {
  db = null;
}

/** drizzle/ next to the working directory, or next to the CLI bundle (dist/cli.js → ../drizzle). */
function resolveMigrationsFolder(): string {
  const candidates = [
    process.env.LORE_MIGRATIONS_DIR,
    path.join(process.cwd(), 'drizzle'),
    process.argv[1] ? path.join(path.dirname(path.resolve(process.argv[1])), '..', 'drizzle') : undefined,
  ].filter((p): p is string => Boolean(p));
  return candidates.find((p) => existsSync(path.join(p, 'meta', '_journal.json'))) ?? candidates[0];
}

/** Advisory lock key held while migrations run (any constant unique to Lore). */
export const MIGRATION_LOCK_ID = 7_413_255_001;

/**
 * Applies pending migrations under a session-level advisory lock on the migration connection, so
 * instances starting at once (or `lore mcp` during an upgrade) apply each migration only once: the
 * others wait, then find nothing left to apply.
 */
export async function runMigrations(url: string, migrationsFolder = resolveMigrationsFolder()): Promise<void> {
  const migrationClient = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await migrationClient`select pg_advisory_lock(${MIGRATION_LOCK_ID})`;
    try {
      await migrate(drizzle(migrationClient, { schema }), { migrationsFolder });
    } finally {
      await migrationClient`select pg_advisory_unlock(${MIGRATION_LOCK_ID})`;
    }
  } finally {
    // Closing the session also releases the lock if unlocking failed
    await migrationClient.end();
  }
}

export async function initDb(): Promise<DbClient> {
  if (db) return db;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL environment variable is required');

  await runMigrations(url);

  // postgres.js prints NOTICEs (e.g. "query contains only stop words") with console.log by default,
  // which would corrupt the JSON-RPC stream of `lore mcp` on stdout: they are dropped.
  const client = postgres(url, { onnotice: () => {} });
  db = drizzle(client, { schema });
  return db;
}
