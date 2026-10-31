import { describe, it, expect, vi, afterEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { getDb } from '../../platform/db.js';
import { reserveStdoutForProtocol } from '../../platform/mcp/server.js';

// `lore mcp` speaks JSON-RPC on stdout: anything else printed there corrupts the stream.
describe('stdout stays clean for stdio MCP', () => {
  afterEach(() => vi.restoreAllMocks());

  it('does not print Postgres NOTICEs to stdout', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await getDb().execute(sql.raw(`DO $$ BEGIN RAISE NOTICE 'lore-notice-test'; END $$`));
    expect(log).not.toHaveBeenCalled();
  });

  it('routes console.log/info/debug to stderr (console.error) once stdout is reserved for the protocol', () => {
    const original = { log: console.log, info: console.info, debug: console.debug };
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      reserveStdoutForProtocol();
      console.log('to-stderr-log');
      console.info('to-stderr-info', 1);
      console.debug('to-stderr-debug');
    } finally {
      Object.assign(console, original);
    }
    expect(err.mock.calls).toEqual([['to-stderr-log'], ['to-stderr-info', 1], ['to-stderr-debug']]);
  });
});
