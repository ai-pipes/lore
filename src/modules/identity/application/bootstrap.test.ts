import { describe, expect, it } from 'vitest';
import { fakeIdentity } from '../../../../test/fakes/identity.js';
import { bootstrapAdmin } from './bootstrap.js';

function logger() {
  const lines: string[] = [];
  return { lines, info: (m: string) => lines.push(`info ${m}`), warn: (m: string) => lines.push(`warn ${m}`) };
}

describe('bootstrapAdmin', () => {
  it('creates the first admin once, then reports that users exist', async () => {
    const d = fakeIdentity();
    const log = logger();
    expect(await bootstrapAdmin(d, { login: ' Root ', password: 'root-password-123' }, log)).toBe('created');
    const root = await d.users.findByLogin('root');
    expect(root).toMatchObject({ role: 'admin', displayName: 'root', disabled: false });
    expect(await d.hasher.verify(root!.passwordHash!, 'root-password-123')).toBe(true);
    expect(await bootstrapAdmin(d, { login: 'root', password: 'root-password-123' }, log)).toBe('exists');
    expect(await bootstrapAdmin(d, { login: 'other', password: 'other-password-123' }, log)).toBe('exists');
    expect(await d.users.count()).toBe(1);
    expect(log.lines.join('\n')).not.toContain('root-password-123');
    expect(log.lines[0]).toMatch(/^info .*root/);
  });

  it('is skipped without env, or with only half of it, an invalid login or a weak password', async () => {
    const d = fakeIdentity();
    const log = logger();
    expect(await bootstrapAdmin(d, {}, log)).toBe('skipped');
    expect(await bootstrapAdmin(d, { login: 'root' }, log)).toBe('skipped');
    expect(await bootstrapAdmin(d, { password: 'root-password-123' }, log)).toBe('skipped');
    expect(await bootstrapAdmin(d, { login: 'a b', password: 'root-password-123' }, log)).toBe('skipped');
    expect(await bootstrapAdmin(d, { login: 'root', password: 'short' }, log)).toBe('skipped');
    expect(await d.users.count()).toBe(0);
    expect(log.lines.filter((l) => l.startsWith('warn'))).toHaveLength(4);
  });
});
