import { and, eq, gt, lte } from 'drizzle-orm';
import { getDb } from '../../../platform/db.js';
import type { DeviceStatus } from '../domain/device-login.js';
import type { DeviceLoginRecord, DeviceLoginRepository } from '../application/ports.js';
import { api_tokens, cli_logins } from './schema.js';

const record = {
  id: cli_logins.id,
  userCode: cli_logins.user_code,
  hostname: cli_logins.hostname,
  requestIp: cli_logins.request_ip,
  status: cli_logins.status,
  userId: cli_logins.user_id,
  expiresAt: cli_logins.expires_at,
};

type Row = Omit<DeviceLoginRecord, 'status'> & { status: string };
const toRecord = (r: Row | undefined): DeviceLoginRecord | null => (r ? { ...r, status: r.status as DeviceStatus } : null);

/**
 * CLI device logins in Postgres, keyed by the SHA-256 hex of the device code. The row never holds a
 * token: the token is inserted into `api_tokens` by the transaction that consumes the row.
 */
export const pgDeviceLoginRepository: DeviceLoginRepository = {
  async insert(r) {
    const rows = await getDb()
      .insert(cli_logins)
      .values({
        device_code_hash: r.deviceCodeHash,
        user_code: r.userCode,
        hostname: r.hostname,
        request_ip: r.requestIp,
        status: 'pending',
        expires_at: r.expiresAt,
      })
      .onConflictDoNothing()
      .returning({ id: cli_logins.id });
    return rows.length > 0;
  },

  async findByUserCode(userCode) {
    const rows = await getDb().select(record).from(cli_logins).where(eq(cli_logins.user_code, userCode)).limit(1);
    return toRecord(rows[0]);
  },

  async findByDeviceCodeHash(hash) {
    const rows = await getDb().select(record).from(cli_logins).where(eq(cli_logins.device_code_hash, hash)).limit(1);
    return toRecord(rows[0]);
  },

  async decide(userCode, userId, status, now) {
    const rows = await getDb()
      .update(cli_logins)
      .set({ status, user_id: userId })
      .where(and(eq(cli_logins.user_code, userCode), eq(cli_logins.status, 'pending'), gt(cli_logins.expires_at, now)))
      .returning({ id: cli_logins.id });
    return rows.length > 0;
  },

  async consumeAndIssueToken(id, token, now) {
    return getDb().transaction(async (tx) => {
      // The conditional update takes the row lock: a concurrent poll waits, then matches nothing.
      const rows = await tx
        .update(cli_logins)
        .set({ status: 'consumed' })
        .where(and(eq(cli_logins.id, id), eq(cli_logins.status, 'approved'), gt(cli_logins.expires_at, now)))
        .returning({ userId: cli_logins.user_id });
      const userId = rows[0]?.userId;
      if (!userId) return null;
      await tx
        .insert(api_tokens)
        .values({ user_id: userId, name: token.name, prefix: token.prefix, hash: token.hash, expires_at: token.expiresAt });
      return { userId };
    });
  },

  async deny(id) {
    await getDb()
      .update(cli_logins)
      .set({ status: 'denied' })
      .where(and(eq(cli_logins.id, id), eq(cli_logins.status, 'approved')));
  },

  async denyApprovedByUser(userId) {
    await getDb()
      .update(cli_logins)
      .set({ status: 'denied' })
      .where(and(eq(cli_logins.user_id, userId), eq(cli_logins.status, 'approved')));
  },

  async deleteExpired(now) {
    await getDb().delete(cli_logins).where(lte(cli_logins.expires_at, now));
  },
};
