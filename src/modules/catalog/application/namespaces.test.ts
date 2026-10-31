import { describe, expect, it } from 'vitest';
import { createFakeCatalog } from '../../../../test/fakes/catalog.js';
import { assignLibrary, createNamespace, listNamespaces, renameNamespace } from './namespaces.js';

describe('createNamespace', () => {
  it('creates a namespace with a valid id', async () => {
    const { deps } = createFakeCatalog();
    const r = await createNamespace(deps, { id: 'pay', displayName: 'Payments' });
    expect(r).toEqual({ ok: true, value: expect.objectContaining({ id: 'pay', display_name: 'Payments', system: false }) });
  });

  it('rejects an invalid id or an empty display name', async () => {
    const { deps } = createFakeCatalog();
    expect(await createNamespace(deps, { id: 'Pay!', displayName: 'P' })).toEqual({ ok: false, error: 'invalid_id' });
    expect(await createNamespace(deps, { id: 'pay', displayName: '  ' })).toEqual({ ok: false, error: 'invalid_id' });
  });

  it('rejects an existing id, the reserved ones included', async () => {
    const { deps } = createFakeCatalog();
    await createNamespace(deps, { id: 'pay', displayName: 'Payments' });
    expect(await createNamespace(deps, { id: 'pay', displayName: 'Again' })).toEqual({ ok: false, error: 'exists' });
    expect(await createNamespace(deps, { id: 'insights', displayName: 'Mine' })).toEqual({ ok: false, error: 'exists' });
  });
});

describe('renameNamespace', () => {
  it('renames an existing namespace', async () => {
    const { deps } = createFakeCatalog();
    await createNamespace(deps, { id: 'pay', displayName: 'Payments' });
    const r = await renameNamespace(deps, 'pay', 'Pay team');
    expect(r.ok && r.value.display_name).toBe('Pay team');
  });

  it('is not_found for an unknown namespace', async () => {
    const { deps } = createFakeCatalog();
    expect(await renameNamespace(deps, 'nope', 'X')).toEqual({ ok: false, error: 'not_found' });
  });
});

describe('listNamespaces', () => {
  it('lists every namespace with its library ids', async () => {
    const { deps } = createFakeCatalog();
    await createNamespace(deps, { id: 'pay', displayName: 'Payments' });
    await deps.libraries.upsert('billing', 'Billing', 'pay');
    await deps.libraries.upsert('orders', 'Orders');
    const list = await listNamespaces(deps);
    expect(list.find((n) => n.id === 'pay')?.libraries).toEqual(['billing']);
    expect(list.find((n) => n.id === 'default')?.libraries).toEqual(['orders']);
    expect(list.find((n) => n.id === 'insights')?.libraries).toEqual([]);
  });
});

describe('assignLibrary', () => {
  it('moves a library into another namespace', async () => {
    const { deps } = createFakeCatalog();
    await createNamespace(deps, { id: 'pay', displayName: 'Payments' });
    await deps.libraries.upsert('billing', 'Billing');
    expect(await assignLibrary(deps, 'billing', 'pay')).toEqual({ ok: true, value: undefined });
    expect((await deps.libraries.get('billing'))?.namespace_id).toBe('pay');
  });

  it('is not_found for an unknown library or namespace', async () => {
    const { deps } = createFakeCatalog();
    await deps.libraries.upsert('billing', 'Billing');
    expect(await assignLibrary(deps, 'nope', 'default')).toEqual({ ok: false, error: 'not_found' });
    expect(await assignLibrary(deps, 'billing', 'nope')).toEqual({ ok: false, error: 'not_found' });
  });

  it('never moves a library into or out of the insights namespace', async () => {
    const { deps } = createFakeCatalog();
    await deps.libraries.upsert('billing', 'Billing');
    await deps.libraries.upsert('insights', 'Insights', 'insights');
    expect(await assignLibrary(deps, 'billing', 'insights')).toEqual({ ok: false, error: 'system_namespace' });
    expect(await assignLibrary(deps, 'insights', 'default')).toEqual({ ok: false, error: 'system_namespace' });
  });
});
