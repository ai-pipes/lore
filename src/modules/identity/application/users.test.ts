import { describe, expect, it } from 'vitest';
import { fakeIdentity, fakeSso } from '../../../../test/fakes/identity.js';
import type { IdentityError } from '../domain/user.js';
import { authenticateSession } from './authenticate.js';
import { pollDeviceLogin } from './device-login.js';
import { passwordLogin } from './sessions.js';
import { createUser, listUsers, resetPassword, updateUser } from './users.js';

const PW = 'correct horse battery';

async function setup(o: { sso?: boolean } = {}) {
  const d = fakeIdentity(o.sso ? { sso: fakeSso() } : {});
  const admin = (await d.users.insert({ login: 'root', displayName: 'Root', role: 'admin', passwordHash: 'plain$x' }))!;
  return { d, admin };
}

async function sessionFor(d: ReturnType<typeof fakeIdentity>, userId: string, id: string) {
  await d.sessions.insert({ idHash: d.secrets.sha256Hex(id), userId, expiresAt: new Date(d.clock.now().getTime() + 3_600_000), method: 'password', deadline: null });
}

/** A device login (`lore login`) the user approved, not yet picked up by the CLI's poll. */
async function approvedDeviceLogin(d: ReturnType<typeof fakeIdentity>, userId: string, deviceCode: string, userCode: string) {
  await d.deviceLogins.insert({
    deviceCodeHash: d.secrets.sha256Hex(deviceCode), userCode, hostname: 'laptop', requestIp: '192.0.2.9',
    expiresAt: new Date(d.clock.now().getTime() + 600_000),
  });
  expect(await d.deviceLogins.decide(userCode, userId, 'approved', d.clock.now())).toBe(true);
}

function code(r: { ok: false; error: IdentityError } | { ok: true }) {
  return r.ok ? 'ok' : r.error.code;
}

describe('listUsers', () => {
  it('lists all users by login', async () => {
    const { d } = await setup();
    await createUser(d, { login: 'bob', displayName: 'Bob', password: PW, role: 'member' });
    await createUser(d, { login: 'alice', displayName: 'Alice', password: PW, role: 'member' });
    expect((await listUsers(d)).map((u) => u.login)).toEqual(['alice', 'bob', 'root']);
  });
});

describe('createUser', () => {
  it('creates a user with a hashed password and a normalized login', async () => {
    const { d } = await setup();
    const r = await createUser(d, { login: '  Alice ', displayName: ' Alice A. ', password: PW, role: 'member' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({ login: 'alice', displayName: 'Alice A.', role: 'member', disabled: false });
    expect(r.value.passwordHash).toBe(`plain$${PW}`);
  });

  it('uses the login as the display name when it is blank', async () => {
    const { d } = await setup();
    const r = await createUser(d, { login: 'carol', displayName: '  ', password: PW, role: 'admin' });
    expect(r.ok && r.value.displayName).toBe('carol');
    expect(r.ok && r.value.role).toBe('admin');
  });

  it('rejects a short password as weak_password', async () => {
    const { d } = await setup();
    expect(code(await createUser(d, { login: 'a', displayName: 'A', password: 'x'.repeat(11), role: 'member' }))).toBe('weak_password');
    expect(d.users.store).toHaveLength(1);
  });

  it('rejects a duplicate login in any case as user_exists', async () => {
    const { d } = await setup();
    await createUser(d, { login: 'alice', displayName: 'A', password: PW, role: 'member' });
    expect(code(await createUser(d, { login: 'ALICE', displayName: 'A', password: PW, role: 'member' }))).toBe('user_exists');
  });

  it('reports a lost insert race as user_exists', async () => {
    const { d } = await setup();
    d.users.insert = async () => null;
    expect(code(await createUser(d, { login: 'zed', displayName: 'Z', password: PW, role: 'member' }))).toBe('user_exists');
  });

  it.each([
    ['an invalid login', { login: 'no spaces', displayName: 'X', role: 'member' }],
    ['a too long display name', { login: 'x', displayName: 'x'.repeat(201), role: 'member' }],
    ['an unknown role', { login: 'x', displayName: 'X', role: 'owner' }],
  ])('rejects %s as invalid_input', async (_l, i) => {
    const { d } = await setup();
    expect(code(await createUser(d, { ...i, password: PW } as never))).toBe('invalid_input');
  });

  it('is sso_managed in SSO mode', async () => {
    const { d } = await setup({ sso: true });
    expect(code(await createUser(d, { login: 'x', displayName: 'X', password: PW, role: 'member' }))).toBe('sso_managed');
  });
});

describe('updateUser', () => {
  it('changes the display name and the role', async () => {
    const { d, admin } = await setup();
    const bob = (await createUser(d, { login: 'bob', displayName: 'Bob', password: PW, role: 'member' }));
    if (!bob.ok) throw new Error('setup');
    const r = await updateUser(d, admin.id, bob.value.id, { displayName: ' Robert ', role: 'admin' });
    expect(r.ok && r.value).toMatchObject({ displayName: 'Robert', role: 'admin' });
  });

  it('disabling cancels the user\'s approved device logins, so enabling them again mints no token', async () => {
    const { d, admin } = await setup();
    const bob = (await d.users.insert({ login: 'bob', displayName: 'Bob', role: 'member' }))!;
    await approvedDeviceLogin(d, bob.id, 'bob-device', 'BCDF-GHJK');
    expect(code(await updateUser(d, admin.id, bob.id, { disabled: true }))).toBe('ok');
    expect(code(await updateUser(d, admin.id, bob.id, { disabled: false }))).toBe('ok');
    expect(await pollDeviceLogin(d, 'bob-device')).toEqual({ status: 'denied' });
    expect(d.tokens.rows).toHaveLength(0);
  });

  it('disabling ends the user\'s sessions; enabling does not bring them back', async () => {
    const { d, admin } = await setup();
    const bob = (await d.users.insert({ login: 'bob', displayName: 'Bob', role: 'member' }))!;
    await sessionFor(d, bob.id, 's1');
    await sessionFor(d, admin.id, 's2');
    const r = await updateUser(d, admin.id, bob.id, { disabled: true });
    expect(r.ok && r.value.disabled).toBe(true);
    expect(await authenticateSession(d, 's1')).toBeNull();
    expect(await authenticateSession(d, 's2')).not.toBeNull();
    const back = await updateUser(d, admin.id, bob.id, { disabled: false });
    expect(back.ok && back.value.disabled).toBe(false);
    expect(await authenticateSession(d, 's1')).toBeNull();
  });

  it('an actor cannot disable or demote themself (forbidden)', async () => {
    const { d, admin } = await setup();
    expect(code(await updateUser(d, admin.id, admin.id, { disabled: true }))).toBe('forbidden');
    expect(code(await updateUser(d, admin.id, admin.id, { role: 'member' }))).toBe('forbidden');
    expect(code(await updateUser(d, admin.id, admin.id, { displayName: 'Me', role: 'admin', disabled: false }))).toBe('ok');
  });

  it('the admin key (no actor) may change anyone', async () => {
    const { d, admin } = await setup();
    expect(code(await updateUser(d, null, admin.id, { role: 'member' }))).toBe('ok');
  });

  it('an unknown id is not_found', async () => {
    const { d, admin } = await setup();
    expect(code(await updateUser(d, admin.id, 'nope', { displayName: 'x' }))).toBe('not_found');
    d.users.update = async () => null;
    expect(code(await updateUser(d, null, admin.id, { displayName: 'x' }))).toBe('not_found');
  });

  it.each([
    ['a blank display name', { displayName: '  ' }],
    ['a too long display name', { displayName: 'x'.repeat(201) }],
    ['an unknown role', { role: 'owner' }],
    ['a non-boolean disabled', { disabled: 'yes' }],
  ])('rejects %s as invalid_input', async (_l, p) => {
    const { d, admin } = await setup();
    const bob = (await d.users.insert({ login: 'bob', displayName: 'Bob', role: 'member' }))!;
    expect(code(await updateUser(d, admin.id, bob.id, p as never))).toBe('invalid_input');
  });
});

describe('resetPassword', () => {
  it('sets a new hash, ends the user\'s sessions and revokes their personal tokens', async () => {
    const { d, admin } = await setup();
    const bob = (await d.users.insert({ login: 'bob', displayName: 'Bob', role: 'member', passwordHash: 'plain$old' }))!;
    await sessionFor(d, bob.id, 's1');
    await d.tokens.insert({ userId: bob.id, name: 'laptop', prefix: 'sk_x', hash: 'h1' });
    await d.tokens.insert({ userId: admin.id, name: 'mine', prefix: 'sk_y', hash: 'h2' });
    expect(code(await resetPassword(d, admin.id, bob.id, PW))).toBe('ok');
    expect((await d.users.findById(bob.id))!.passwordHash).toBe(`plain$${PW}`);
    expect(await authenticateSession(d, 's1')).toBeNull();
    expect(d.tokens.rows.find((t) => t.hash === 'h1')!.revokedAt).toEqual(d.clock.now());
    expect(d.tokens.rows.find((t) => t.hash === 'h2')!.revokedAt).toBeNull();
  });

  it('cancels device logins the user approved before the reset, so no token is minted afterwards', async () => {
    const { d, admin } = await setup();
    const bob = (await d.users.insert({ login: 'bob', displayName: 'Bob', role: 'member', passwordHash: 'plain$old' }))!;
    await approvedDeviceLogin(d, bob.id, 'bob-device', 'BCDF-GHJK');
    await approvedDeviceLogin(d, admin.id, 'root-device', 'LMNP-QRST');
    expect(code(await resetPassword(d, admin.id, bob.id, PW))).toBe('ok');
    expect(await pollDeviceLogin(d, 'bob-device')).toEqual({ status: 'denied' });
    expect(d.tokens.rows.filter((t) => t.userId === bob.id)).toHaveLength(0);
    expect((await pollDeviceLogin(d, 'root-device')).status).toBe('approved');
  });

  it('an admin changing their own password must give the current one', async () => {
    const { d, admin } = await setup(); // root's password is "x"
    expect(code(await resetPassword(d, admin.id, admin.id, PW))).toBe('forbidden');
    expect(code(await resetPassword(d, admin.id, admin.id, PW, 'wrong'))).toBe('forbidden');
    expect((await d.users.findById(admin.id))!.passwordHash).toBe('plain$x');
    expect(code(await resetPassword(d, admin.id, admin.id, PW, 'x'))).toBe('ok');
    expect((await d.users.findById(admin.id))!.passwordHash).toBe(`plain$${PW}`);
  });

  it('wrong current passwords count against the login lock; the lock ends the caller\'s sessions', async () => {
    const d = fakeIdentity({ loginAccountLimit: 3 });
    const root = (await d.users.insert({ login: 'root', displayName: 'Root', role: 'admin', passwordHash: 'plain$x' }))!;
    await sessionFor(d, root.id, 'mine');
    // a correct one before the limit works and gives its attempt back
    expect(code(await resetPassword(d, root.id, root.id, PW, 'wrong'))).toBe('forbidden');
    expect(code(await resetPassword(d, root.id, root.id, PW, 'x'))).toBe('ok');
    expect(d.loginAccountLimiter.counts.get(d.signInKeys.loginKey('root'))).toBe(1);
    await sessionFor(d, root.id, 'mine');
    await approvedDeviceLogin(d, root.id, 'root-device', 'BCDF-GHJK');
    expect(code(await resetPassword(d, root.id, root.id, 'another password 2', 'wrong'))).toBe('forbidden');
    const hashes = d.hasher.verifyCalls;
    expect(code(await resetPassword(d, root.id, root.id, 'another password 2', PW))).toBe('rate_limited');
    expect(d.hasher.verifyCalls).toBe(hashes); // no verify while locked
    expect(await authenticateSession(d, 'mine')).toBeNull();
    expect(await pollDeviceLogin(d, 'root-device')).toEqual({ status: 'denied' });
    expect((await d.users.findById(root.id))!.passwordHash).toBe(`plain$${PW}`);
    // and password sign-in of that login is locked too
    expect(code(await passwordLogin(d, { login: 'root', password: PW, ip: '10.0.0.1' }))).toBe('rate_limited');
  });

  it('the admin key (no user) needs no current password', async () => {
    const { d, admin } = await setup();
    expect(code(await resetPassword(d, null, admin.id, PW))).toBe('ok');
  });

  it('rejects a weak password, an unknown id and SSO mode', async () => {
    const { d, admin } = await setup();
    expect(code(await resetPassword(d, null, admin.id, 'short'))).toBe('weak_password');
    expect(code(await resetPassword(d, null, 'nope', PW))).toBe('not_found');
    d.users.update = async () => null;
    expect(code(await resetPassword(d, null, admin.id, PW))).toBe('not_found');
    const s = await setup({ sso: true });
    expect(code(await resetPassword(s.d, null, s.admin.id, PW))).toBe('sso_managed');
  });
});
