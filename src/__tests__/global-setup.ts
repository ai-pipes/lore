/**
 * Vitest globalSetup — runs once in the main process before any test workers start.
 * Creates the test database if it doesn't exist so that initDb() (called in setup.ts
 * beforeAll) can connect and run migrations safely.
 */
import { config as dotenvConfig } from 'dotenv';
import postgres from 'postgres';

dotenvConfig();

export default async function setup(): Promise<void> {
  const devUrl = process.env.DATABASE_URL ?? '';
  const testUrl =
    process.env.TEST_DATABASE_URL ??
    devUrl.replace(/\/([^/?#]+)([?#].*)?$/, '/lore_test$2');

  if (!testUrl) throw new Error('Cannot determine test database URL');

  const parsed = new URL(testUrl);
  const dbName = parsed.pathname.slice(1); // strip leading /
  parsed.pathname = '/postgres';

  const admin = postgres(parsed.toString(), { max: 1 });
  try {
    await admin.unsafe(`CREATE DATABASE "${dbName}"`);
    console.log(`[test] Created test database: ${dbName}`);
  } catch (e: any) {
    if (!e.message?.includes('already exists')) throw e;
    // Already exists — nothing to do
  } finally {
    await admin.end();
  }
}
