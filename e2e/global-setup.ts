// e2e/global-setup.ts
import { config as dotenvConfig } from 'dotenv';
import postgres from 'postgres';

dotenvConfig();

export default async function globalSetup(): Promise<void> {
  const devUrl = process.env.DATABASE_URL ?? '';
  const testUrl =
    process.env.TEST_DATABASE_URL ??
    devUrl.replace(/\/([^/?#]+)([?#].*)?$/, '/lore_test$2');

  if (!testUrl) throw new Error('Cannot determine test database URL — set DATABASE_URL in .env');

  const parsed = new URL(testUrl);
  const dbName = parsed.pathname.slice(1);
  parsed.pathname = '/postgres';

  const admin = postgres(parsed.toString(), { max: 1 });
  try {
    await admin.unsafe(`CREATE DATABASE "${dbName}"`);
    console.log(`[e2e] Created test database: ${dbName}`);
  } catch (e: any) {
    if (!e.message?.includes('already exists')) throw e;
  } finally {
    await admin.end();
  }
}
