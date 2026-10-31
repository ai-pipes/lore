import { describe, expect, it } from 'vitest';
import { fakeIdentity } from '../../../../test/fakes/identity.js';
import { IdentityError } from '../domain/user.js';
import { authenticateBearer } from './authenticate.js';
import { createToken, listTokens, mcpAddCommand, revokeToken, TOKEN_NAME_MAX_LENGTH } from './tokens.js';

async function setup() {
  const d = fakeIdentity();
  const alice = (await d.users.insert({ login: 'alice', displayName: 'Alice', role: 'member' }))!;
  const bob = (await d.users.insert({ login: 'bob', displayName: 'Bob', role: 'member' }))!;
  return { d, alice, bob };
}

describe('createToken', () => {
  it('returns an sk_ secret once and stores only its SHA-256 and a short prefix', async () => {
    const { d, alice } = await setup();
    const { token, record } = await createToken(d, alice.id, '  laptop  ');
    expect(token).toMatch(/^sk_/);
    expect(record).toMatchObject({ userId: alice.id, name: 'laptop', prefix: token.slice(0, 8), revokedAt: null, lastUsedAt: null });
    expect(record).not.toHaveProperty('hash');
    const row = d.tokens.rows.find((r) => r.id === record.id)!;
    expect(row.hash).toBe(d.secrets.sha256Hex(token));
    expect(JSON.stringify(d.tokens.rows)).not.toContain(token);
    expect(await authenticateBearer(d, token)).toMatchObject({ kind: 'user', userId: alice.id, via: 'token', tokenId: record.id });
  });

  it.each([
    ['an empty name', ''],
    ['a blank name', '   '],
    ['a too long name', 'x'.repeat(TOKEN_NAME_MAX_LENGTH + 1)],
  ])('rejects %s as invalid_input', async (_label, name) => {
    const { d, alice } = await setup();
    const e = await createToken(d, alice.id, name).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(IdentityError);
    expect((e as IdentityError).code).toBe('invalid_input');
    expect(d.tokens.rows).toHaveLength(0);
  });

  it('accepts a name of exactly 100 characters', async () => {
    const { d, alice } = await setup();
    expect(TOKEN_NAME_MAX_LENGTH).toBe(100);
    const { record } = await createToken(d, alice.id, 'x'.repeat(100));
    expect(record.name).toHaveLength(100);
  });
});

describe('listTokens', () => {
  it('lists only the user\'s own tokens, including revoked ones', async () => {
    const { d, alice, bob } = await setup();
    const a1 = await createToken(d, alice.id, 'one');
    await createToken(d, alice.id, 'two');
    await createToken(d, bob.id, 'bob');
    await revokeToken(d, alice.id, a1.record.id);
    const list = await listTokens(d, alice.id);
    expect(list.map((t) => t.name)).toEqual(['one', 'two']);
    expect(list[0].revokedAt).toEqual(d.clock.now());
  });
});

describe('revokeToken', () => {
  it('revokes the user\'s own token; it no longer authenticates', async () => {
    const { d, alice } = await setup();
    const { token, record } = await createToken(d, alice.id, 'laptop');
    d.clock.advance(1000);
    expect(await revokeToken(d, alice.id, record.id)).toBe(true);
    expect(d.tokens.rows[0].revokedAt).toEqual(d.clock.now());
    expect(await authenticateBearer(d, token)).toBeNull();
  });

  it('is false for another user\'s token, an unknown id and an already revoked token', async () => {
    const { d, alice, bob } = await setup();
    const { token, record } = await createToken(d, alice.id, 'laptop');
    expect(await revokeToken(d, bob.id, record.id)).toBe(false);
    expect(await authenticateBearer(d, token)).not.toBeNull();
    expect(await revokeToken(d, alice.id, 'nope')).toBe(false);
    expect(await revokeToken(d, alice.id, record.id)).toBe(true);
    expect(await revokeToken(d, alice.id, record.id)).toBe(false);
  });
});

describe('mcpAddCommand', () => {
  it('is a ready claude mcp add command with the bearer header', () => {
    expect(mcpAddCommand('http://localhost:4738/mcp', 'sk_abc')).toBe(
      'claude mcp add --transport http lore http://localhost:4738/mcp --header "Authorization: Bearer sk_abc"',
    );
  });
});
