import { describe, it, expect, beforeEach } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { getDb } from '../../platform/db.js';
import { pgUserRepository } from '../../modules/identity/infrastructure/pg-users.js';
import { pgSessionRepository } from '../../modules/identity/infrastructure/pg-sessions.js';
import { web_sessions } from '../../modules/identity/infrastructure/schema.js';
import { pgTokenRepository } from '../../modules/identity/infrastructure/pg-tokens.js';
import { pgPendingLoginRepository } from '../../modules/identity/infrastructure/pg-pending-logins.js';
import { pgDeviceLoginRepository } from '../../modules/identity/infrastructure/pg-device-logins.js';
import { nodeSecrets } from '../../modules/identity/infrastructure/secrets.js';
import { createPgIdentity } from '../../modules/identity/infrastructure/compose.js';
import { cleanDb, createTestUser } from '../helpers.js';

/** The Postgres error of a violated constraint, as Drizzle wraps it. */
const violates = (constraint: string) => ({ cause: { constraint_name: constraint } });

const users = pgUserRepository;

beforeEach(async () => {
  await cleanDb();
});

describe('pgUserRepository', () => {
  it('inserts a user with defaults and finds it by id and login', async () => {
    const u = await users.insert({ login: 'alice', displayName: 'Alice', role: 'member', passwordHash: 'scrypt$x' });
    expect(u).toMatchObject({ login: 'alice', displayName: 'Alice', role: 'member', disabled: false, passwordHash: 'scrypt$x',
      oidcIss: null, oidcSub: null, email: null, groups: [], lastLoginAt: null });
    expect(u!.createdAt).toBeInstanceOf(Date);
    expect(await users.findById(u!.id)).toEqual(u);
    expect(await users.findByLogin('alice')).toEqual(u);
    expect(await users.findByLogin('nobody')).toBeNull();
    expect(await users.findById('00000000-0000-0000-0000-000000000000')).toBeNull();
  });

  it('returns null when the login already exists', async () => {
    await users.insert({ login: 'alice', displayName: 'Alice', role: 'member' });
    expect(await users.insert({ login: 'alice', displayName: 'Other', role: 'admin' })).toBeNull();
    expect(await users.count()).toBe(1);
  });

  it('round-trips an OIDC subject and its groups', async () => {
    const u = await users.insert({ login: 'bob', displayName: 'Bob', role: 'admin', oidcIss: 'https://idp', oidcSub: 's-1',
      email: 'bob@x.io', groups: ['lore-admins'] });
    const found = await users.findBySubject('https://idp', 's-1');
    expect(found).toEqual(u);
    expect(found!.groups).toEqual(['lore-admins']);
    expect(await users.findBySubject('https://idp', 's-2')).toBeNull();
    expect(await users.insert({ login: 'bob2', displayName: 'Bob', role: 'member', oidcIss: 'https://idp', oidcSub: 's-1' })).toBeNull();
  });

  it('rejects a half-set OIDC subject (check constraint)', async () => {
    await expect(users.insert({ login: 'carol', displayName: 'Carol', role: 'member', oidcIss: 'https://idp' })).rejects.toMatchObject(violates('users_oidc_subject_check'));
    await expect(users.insert({ login: 'carol', displayName: 'Carol', role: 'member', oidcSub: 's' })).rejects.toMatchObject(violates('users_oidc_subject_check'));
  });

  it('update rejects a taken login or provider subject (unique constraints)', async () => {
    await users.insert({ login: 'alice', displayName: 'A', role: 'member', oidcIss: 'i', oidcSub: 's1' });
    const bob = (await users.insert({ login: 'bob', displayName: 'B', role: 'member' }))!;
    await expect(users.update(bob.id, { login: 'alice' })).rejects.toMatchObject(violates('users_login_unique'));
    await expect(users.update(bob.id, { oidcIss: 'i', oidcSub: 's1' })).rejects.toMatchObject(violates('users_oidc_subject_unique'));
  });

  it('rejects an unknown role (check constraint)', async () => {
    await expect(users.insert({ login: 'dave', displayName: 'Dave', role: 'root' as never })).rejects.toMatchObject(violates('users_role_check'));
  });

  it('lists in login order, counts, and inserts only into an empty table', async () => {
    expect(await users.count()).toBe(0);
    const first = await users.insertIfEmpty({ login: 'root', displayName: 'Root', role: 'admin' });
    expect(first?.login).toBe('root');
    expect(await users.insertIfEmpty({ login: 'second', displayName: 'S', role: 'admin' })).toBeNull();
    await users.insert({ login: 'alice', displayName: 'Alice', role: 'member' });
    expect((await users.list()).map((u) => u.login)).toEqual(['alice', 'root']);
    expect(await users.count()).toBe(2);
  });

  it('updates a patch and returns the user, or null for an unknown id', async () => {
    const u = await users.insert({ login: 'erin', displayName: 'Erin', role: 'member' });
    const at = new Date('2026-10-31T10:00:00.000Z');
    const p = await users.update(u!.id, { role: 'admin', disabled: true, displayName: 'E', groups: ['g'], lastLoginAt: at,
      passwordHash: null, email: 'e@x.io', oidcIss: 'https://idp', oidcSub: 'e' });
    expect(p).toMatchObject({ role: 'admin', disabled: true, displayName: 'E', groups: ['g'], lastLoginAt: at, email: 'e@x.io',
      oidcIss: 'https://idp', oidcSub: 'e' });
    expect(await users.update(u!.id, {})).toEqual(p);
    expect(await users.update('00000000-0000-0000-0000-000000000000', { role: 'admin' })).toBeNull();
  });
});

describe('pgSessionRepository', () => {
  it('inserts, finds, extends and deletes sessions', async () => {
    const u = await users.insert({ login: 'alice', displayName: 'Alice', role: 'member' });
    const s = pgSessionRepository;
    const exp = new Date('2026-11-07T10:00:00.000Z');
    await s.insert({ idHash: 'h1', userId: u!.id, expiresAt: exp, method: 'password', deadline: null });
    await s.insert({ idHash: 'h2', userId: u!.id, expiresAt: exp, method: 'sso', deadline: new Date('2026-11-01T10:00:00.000Z') });
    expect(await s.find('h1')).toEqual({ userId: u!.id, expiresAt: exp, deadline: null });
    expect((await s.find('h2'))!.deadline).toEqual(new Date('2026-11-01T10:00:00.000Z'));
    const later = new Date('2026-11-08T10:00:00.000Z');
    const seen = new Date('2026-11-01T10:00:00.000Z');
    await s.extend('h1', later, seen);
    expect((await s.find('h1'))!.expiresAt).toEqual(later);
    // last_seen_at is the caller's clock, not the database host's
    const [row] = await getDb().select({ seen: web_sessions.last_seen_at }).from(web_sessions).where(eq(web_sessions.id_hash, 'h1'));
    expect(row.seen).toEqual(seen);
    await s.delete('h1');
    expect(await s.find('h1')).toBeNull();
    await s.deleteByUser(u!.id);
    expect(await s.find('h2')).toBeNull();
  });
});

describe('pgTokenRepository', () => {
  it('inserts, finds by hash, lists, touches and revokes tokens', async () => {
    const u = await users.insert({ login: 'alice', displayName: 'Alice', role: 'member' });
    const other = await users.insert({ login: 'bob', displayName: 'Bob', role: 'member' });
    const t = pgTokenRepository;
    const rec = await t.insert({ userId: u!.id, name: 'laptop', prefix: 'sk_abcd', hash: 'hash-1' });
    expect(rec).toMatchObject({ userId: u!.id, name: 'laptop', prefix: 'sk_abcd', lastUsedAt: null, revokedAt: null });
    expect(rec).not.toHaveProperty('hash');
    expect(await t.findByHash('hash-1')).toEqual(rec);
    expect(await t.findByHash('missing')).toBeNull();
    await t.insert({ userId: other!.id, name: 'x', prefix: 'sk_x', hash: 'hash-2' });
    expect((await t.listByUser(u!.id)).map((r) => r.name)).toEqual(['laptop']);
    const at = new Date('2026-10-31T10:00:00.000Z');
    await t.touch(rec.id, at);
    expect((await t.findByHash('hash-1'))!.lastUsedAt).toEqual(at);
    expect(await t.revoke(other!.id, rec.id, at)).toBe(false);
    expect(await t.revoke(u!.id, rec.id, at)).toBe(true);
    expect(await t.revoke(u!.id, rec.id, at)).toBe(false);
    expect((await t.findByHash('hash-1'))!.revokedAt).toEqual(at);
  });

  it('cascades sessions and tokens when a user is deleted', async () => {
    const u = await createTestUser();
    await getDb().execute(sql`DELETE FROM users WHERE id = ${u.id}`);
    expect(await pgTokenRepository.findByHash(nodeSecrets.sha256Hex(u.token))).toBeNull();
    expect(await pgSessionRepository.find(nodeSecrets.sha256Hex(u.cookie.split('=')[1]))).toBeNull();
  });
});

const pending = (state: string, expiresAt: Date) => ({ state, codeVerifier: `v-${state}`, nonce: `n-${state}`, returnTo: '/x', expiresAt });

describe('pgPendingLoginRepository', () => {

  it('consumes a state exactly once', async () => {
    const p = pending('s1', new Date(Date.now() + 600_000));
    await pgPendingLoginRepository.insert(p);
    expect(await pgPendingLoginRepository.consume('s1')).toEqual(p);
    expect(await pgPendingLoginRepository.consume('s1')).toBeNull();
    expect(await pgPendingLoginRepository.consume('unknown')).toBeNull();
  });

  it('drops expired attempts when a new one starts', async () => {
    await pgPendingLoginRepository.insert(pending('old', new Date(Date.now() - 1000)));
    await pgPendingLoginRepository.insert(pending('new', new Date(Date.now() + 600_000)));
    const rows = (await getDb().execute(sql`select state from oidc_pending`)) as unknown as { state: string }[];
    expect(rows.map((r) => r.state)).toEqual(['new']);
  });
});

describe('pgDeviceLoginRepository', () => {
  const devices = pgDeviceLoginRepository;
  const start = (code: string) =>
    devices.insert({ deviceCodeHash: `hash-${code}`, userCode: code, hostname: 'laptop', requestIp: '192.0.2.9', expiresAt: new Date(Date.now() + 600_000) });

  it('denyApprovedByUser denies only that user\'s approved, unconsumed requests', async () => {
    const bob = await users.insert({ login: 'bob', displayName: 'Bob', role: 'member' });
    const eve = await users.insert({ login: 'eve', displayName: 'Eve', role: 'member' });
    for (const c of ['BCDF-GHJK', 'LMNP-QRST', 'VWXZ-BCDF', 'GHJK-LMNP']) await start(c);
    await devices.decide('BCDF-GHJK', bob!.id, 'approved', new Date());
    await devices.decide('LMNP-QRST', eve!.id, 'approved', new Date());
    await devices.decide('VWXZ-BCDF', bob!.id, 'approved', new Date());
    const consumed = await devices.findByUserCode('VWXZ-BCDF');
    await devices.consumeAndIssueToken(consumed!.id, { name: 'cli-laptop', prefix: 'sk_c', hash: 'hc', expiresAt: new Date(Date.now() + 86_400_000) }, new Date());

    await devices.denyApprovedByUser(bob!.id);

    expect((await devices.findByUserCode('BCDF-GHJK'))!.status).toBe('denied');
    expect((await devices.findByUserCode('LMNP-QRST'))!.status).toBe('approved');
    expect((await devices.findByUserCode('VWXZ-BCDF'))!.status).toBe('consumed');
    expect((await devices.findByUserCode('GHJK-LMNP'))!.status).toBe('pending');
  });
});

describe('createTestUser and createPgIdentity', () => {
  it('creates a user with a verifiable password, an sk_ token and a session cookie', async () => {
    const u = await createTestUser({ login: 'Tester', role: 'admin', password: 'correct-horse-battery' });
    expect(u.login).toBe('tester');
    expect(u.token).toMatch(/^sk_[A-Za-z0-9_-]{43}$/);
    expect(u.cookie).toMatch(/^lore_session=[A-Za-z0-9_-]{43}$/);
    expect(u.bearer).toEqual({ authorization: `Bearer ${u.token}` });
    const d = createPgIdentity({ adminKey: 'k' });
    expect(d.adminKey).toBe('k');
    const user = await d.users.findById(u.id);
    expect(user?.role).toBe('admin');
    expect(await d.hasher.verify(user!.passwordHash!, 'correct-horse-battery')).toBe(true);
    expect((await d.tokens.findByHash(d.secrets.sha256Hex(u.token)))?.userId).toBe(u.id);
    expect((await d.sessions.find(d.secrets.sha256Hex(u.cookie.slice('lore_session='.length))))?.userId).toBe(u.id);
    const second = await createTestUser();
    expect(second.login).not.toBe(u.login);
    expect(second.password.length).toBeGreaterThanOrEqual(12);
  });
});
