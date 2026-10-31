import { describe, it, expect } from 'vitest';
import postgres from 'postgres';
import { MIGRATION_LOCK_ID, runMigrations } from '../../platform/db.js';

const url = process.env.DATABASE_URL!;

// Two instances starting at once (or `lore mcp` during an upgrade) must not apply the same
// migration twice: migrations run under a Postgres advisory lock.
describe('migrations', () => {
  it('wait for the migration lock held by another instance, and release it afterwards', async () => {
    const other = postgres(url, { max: 1, onnotice: () => {} });
    try {
      await other`select pg_advisory_lock(${MIGRATION_LOCK_ID})`;
      let done = false;
      const running = runMigrations(url).then(() => {
        done = true;
      });
      await new Promise((r) => setTimeout(r, 500));
      expect(done).toBe(false);

      await other`select pg_advisory_unlock(${MIGRATION_LOCK_ID})`;
      await running;
      expect(done).toBe(true);

      // released: another instance takes it at once
      const [{ locked }] = await other<{ locked: boolean }[]>`select pg_try_advisory_lock(${MIGRATION_LOCK_ID}) as locked`;
      expect(locked).toBe(true);
      await other`select pg_advisory_unlock(${MIGRATION_LOCK_ID})`;
    } finally {
      await other.end();
    }
  });

  it('releases the lock when a migration run fails', async () => {
    await expect(runMigrations(url, '/nonexistent/lore-migrations')).rejects.toThrow();
    const other = postgres(url, { max: 1, onnotice: () => {} });
    try {
      const [{ locked }] = await other<{ locked: boolean }[]>`select pg_try_advisory_lock(${MIGRATION_LOCK_ID}) as locked`;
      expect(locked).toBe(true);
      await other`select pg_advisory_unlock(${MIGRATION_LOCK_ID})`;
    } finally {
      await other.end();
    }
  });

  it('concurrent runs all succeed', async () => {
    await expect(Promise.all([runMigrations(url), runMigrations(url), runMigrations(url)])).resolves.toBeDefined();
  });
});
