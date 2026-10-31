import { describe, expect, it } from 'vitest';
import { createFakeCatalog } from '../../../../test/fakes/catalog.js';
import { createNamespace } from './namespaces.js';
import { authenticateProjectKey, createProjectKey, listProjectKeys, revokeProjectKey } from './project-keys.js';

async function setup() {
  const fake = createFakeCatalog();
  await createNamespace(fake.deps, { id: 'pay', displayName: 'Payments' });
  await fake.deps.libraries.upsert('billing', 'Billing', 'pay');
  await fake.deps.libraries.upsert('orders', 'Orders');
  return fake;
}

describe('createProjectKey', () => {
  it('returns the lpk_ key once and stores only its hash', async () => {
    const { deps, state } = await setup();
    const r = await createProjectKey(deps, { namespaceId: 'pay', name: 'ci', createdBy: 'u1' });
    if (!r.ok) throw new Error(r.error);
    expect(r.value.key.startsWith('lpk_')).toBe(true);
    expect(r.value.record).toMatchObject({ namespaceId: 'pay', libraryId: null, name: 'ci', createdBy: 'u1', prefix: r.value.key.slice(0, 12) });
    expect(state.projectKeys[0].hash).toBe(deps.keySecrets.sha256Hex(r.value.key));
    expect(JSON.stringify(await listProjectKeys(deps))).not.toContain(r.value.key);
  });

  it('may restrict the key to one library of the namespace', async () => {
    const { deps } = await setup();
    const r = await createProjectKey(deps, { namespaceId: 'pay', name: 'ci', libraryId: 'billing', createdBy: null });
    expect(r.ok && r.value.record.libraryId).toBe('billing');
    expect(await createProjectKey(deps, { namespaceId: 'pay', name: 'ci', libraryId: 'orders', createdBy: null })).toEqual({ ok: false, error: 'library_not_in_namespace' });
    expect(await createProjectKey(deps, { namespaceId: 'pay', name: 'ci', libraryId: 'nope', createdBy: null })).toEqual({ ok: false, error: 'library_not_in_namespace' });
  });

  it('is not_found for an unknown namespace and system_namespace for insights', async () => {
    const { deps } = await setup();
    expect(await createProjectKey(deps, { namespaceId: 'nope', name: 'ci', createdBy: null })).toEqual({ ok: false, error: 'not_found' });
    expect(await createProjectKey(deps, { namespaceId: 'insights', name: 'ci', createdBy: null })).toEqual({ ok: false, error: 'system_namespace' });
  });
});

describe('listProjectKeys and revokeProjectKey', () => {
  it('lists all keys or those of one namespace', async () => {
    const { deps } = await setup();
    await createProjectKey(deps, { namespaceId: 'pay', name: 'a', createdBy: null });
    await createProjectKey(deps, { namespaceId: 'default', name: 'b', createdBy: null });
    expect((await listProjectKeys(deps)).map((k) => k.name)).toEqual(['a', 'b']);
    expect((await listProjectKeys(deps, 'pay')).map((k) => k.name)).toEqual(['a']);
  });

  it('revokes an active key once', async () => {
    const { deps } = await setup();
    const r = await createProjectKey(deps, { namespaceId: 'pay', name: 'a', createdBy: null });
    if (!r.ok) throw new Error(r.error);
    expect(await revokeProjectKey(deps, r.value.record.id)).toBe(true);
    expect(await revokeProjectKey(deps, r.value.record.id)).toBe(false);
    expect(await revokeProjectKey(deps, 'nope')).toBe(false);
  });
});

describe('authenticateProjectKey', () => {
  it('resolves an active lpk_ key and records its use', async () => {
    const { deps, state } = await setup();
    const r = await createProjectKey(deps, { namespaceId: 'pay', name: 'ci', libraryId: 'billing', createdBy: null });
    if (!r.ok) throw new Error(r.error);
    state.now = new Date(Date.UTC(2026, 1, 1));
    expect(await authenticateProjectKey(deps, r.value.key)).toEqual({
      kind: 'project',
      keyId: r.value.record.id,
      name: 'ci',
      namespaceId: 'pay',
      libraryId: 'billing',
    });
    expect(state.projectKeys[0].lastUsedAt).toEqual(state.now);
  });

  it('is null for a revoked, unknown or non-lpk_ token', async () => {
    const { deps } = await setup();
    const r = await createProjectKey(deps, { namespaceId: 'pay', name: 'ci', createdBy: null });
    if (!r.ok) throw new Error(r.error);
    await revokeProjectKey(deps, r.value.record.id);
    expect(await authenticateProjectKey(deps, r.value.key)).toBeNull();
    expect(await authenticateProjectKey(deps, 'lpk_unknown')).toBeNull();
    expect(await authenticateProjectKey(deps, 'sk_whatever')).toBeNull();
  });
});
