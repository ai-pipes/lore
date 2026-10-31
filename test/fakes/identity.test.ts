import { describe, expect, it } from 'vitest';
import { fakeIdentity, fakeRateLimiter } from './identity.js';

describe('fake identity ports', () => {
  it('behave like the Postgres adapters', async () => {
    const d = fakeIdentity({ adminKey: 'k' });
    const u = await d.users.insert({ login: 'alice', displayName: 'Alice', role: 'member', passwordHash: await d.hasher.hash('pw') });
    expect(await d.users.insert({ login: 'alice', displayName: 'A', role: 'admin' })).toBeNull();
    expect(await d.users.insertIfEmpty({ login: 'root', displayName: 'R', role: 'admin' })).toBeNull();
    await expect(d.users.insert({ login: 'x', displayName: 'X', role: 'member', oidcIss: 'i' })).rejects.toThrow();
    expect(await d.hasher.verify(u!.passwordHash!, 'pw')).toBe(true);
    expect((await d.users.update(u!.id, { disabled: true }))?.disabled).toBe(true);
    expect(d.secrets.random('sk_')).toMatch(/^sk_[A-Za-z0-9_-]{43}$/);
    const t = await d.tokens.insert({ userId: u!.id, name: 'n', prefix: 'sk_', hash: 'h' });
    expect(await d.tokens.findByHash('h')).toEqual(t);
    expect(await d.tokens.revoke(u!.id, t.id, d.clock.now())).toBe(true);
    expect(await d.tokens.revoke(u!.id, t.id, d.clock.now())).toBe(false);
    await d.sessions.insert({ idHash: 's', userId: u!.id, expiresAt: d.clock.now(), method: 'password', deadline: null });
    await d.sessions.deleteByUser(u!.id);
    expect(await d.sessions.find('s')).toBeNull();
    d.clock.advance(1000);
    expect(d.clock.now().getTime()).toBe(Date.parse('2026-10-31T12:00:01Z'));
  });

  it('users.update throws on a taken login or provider subject, like the unique constraints', async () => {
    const d = fakeIdentity();
    await d.users.insert({ login: 'alice', displayName: 'A', role: 'member', oidcIss: 'i', oidcSub: 's1' });
    const bob = (await d.users.insert({ login: 'bob', displayName: 'B', role: 'member' }))!;
    await expect(d.users.update(bob.id, { login: 'alice' })).rejects.toThrow(/users_login_unique/);
    await expect(d.users.update(bob.id, { oidcIss: 'i', oidcSub: 's1' })).rejects.toThrow(/users_oidc_subject_unique/);
    await expect(d.users.update(bob.id, { oidcIss: 'i' })).rejects.toThrow(/half-set/);
    expect((await d.users.findById(bob.id))?.login).toBe('bob');
    expect((await d.users.update(bob.id, { login: 'bob', oidcIss: 'i', oidcSub: 's2' }))?.oidcSub).toBe('s2');
  });

  it('rate limiter blocks after the limit and resets', () => {
    const l = fakeRateLimiter(1, 60);
    expect(l.hit('ip').allowed).toBe(false);
    expect(l.check('ip')).toEqual({ allowed: false, retryAfterSec: 60 });
    l.reset('ip');
    expect(l.check('ip')).toEqual({ allowed: true, retryAfterSec: 0 });
  });
});
