import { describe, expect, it } from 'vitest';
import { createFakeCatalog } from '../../../../test/fakes/catalog.js';
import { ensureLibraryVersion, ensureSystemLibrary, getLibrary, listLibraries, pushLibrary, registerLibrary } from './libraries.js';
import { createNamespace } from './namespaces.js';

describe('registerLibrary', () => {
  it('creates a new library and says so', async () => {
    const { deps } = createFakeCatalog();
    const r = await registerLibrary(deps, { id: 'orders-api', displayName: 'Orders' });
    expect(r.library).toMatchObject({ id: 'orders-api', display_name: 'Orders' });
    expect(r.created).toBe(true);
    expect(r).not.toHaveProperty('apiKey');
  });

  it('on an existing library updates the display name and is not created', async () => {
    const { deps } = createFakeCatalog();
    await registerLibrary(deps, { id: 'orders-api', displayName: 'Orders' });
    const again = await registerLibrary(deps, { id: 'orders-api', displayName: 'Orders v2' });
    expect(again.created).toBe(false);
    expect(again.library.display_name).toBe('Orders v2');
  });
});

describe('library queries', () => {
  it('gets and lists libraries', async () => {
    const { deps } = createFakeCatalog();
    await registerLibrary(deps, { id: 'a', displayName: 'A' });
    expect((await getLibrary(deps, 'a'))?.id).toBe('a');
    expect(await getLibrary(deps, 'b')).toBeUndefined();
    expect((await listLibraries(deps)).map((l) => l.id)).toEqual(['a']);
  });
});

describe('library namespaces', () => {
  it('a new library goes to default unless a namespace is given; renaming keeps it', async () => {
    const { deps } = createFakeCatalog();
    expect((await registerLibrary(deps, { id: 'a', displayName: 'A' })).library.namespace_id).toBe('default');
    expect((await registerLibrary(deps, { id: 'b', displayName: 'B', namespaceId: 'insights' })).library.namespace_id).toBe('insights');
    expect((await registerLibrary(deps, { id: 'b', displayName: 'B2', namespaceId: 'default' })).library.namespace_id).toBe('insights');
  });

  it('lists the libraries of one namespace', async () => {
    const { deps } = createFakeCatalog();
    await registerLibrary(deps, { id: 'a', displayName: 'A' });
    await registerLibrary(deps, { id: 'b', displayName: 'B', namespaceId: 'insights' });
    expect((await listLibraries(deps, 'insights')).map((l) => l.id)).toEqual(['b']);
  });

  it('ensureLibraryVersion creates the library in the given namespace', async () => {
    const { deps } = createFakeCatalog();
    await ensureLibraryVersion(deps, 'insights', 'Insights', 'v', 'insights');
    expect((await getLibrary(deps, 'insights'))?.namespace_id).toBe('insights');
    await ensureLibraryVersion(deps, 'insights', 'Insights', 'v', 'insights');
    await ensureLibraryVersion(deps, 'plain', 'Plain', 'v');
    expect((await getLibrary(deps, 'plain'))?.namespace_id).toBe('default');
  });

  it('ensureLibraryVersion never adopts a library of another namespace', async () => {
    const { deps, state } = createFakeCatalog();
    await registerLibrary(deps, { id: 'insights', displayName: 'Squatted' });
    await expect(ensureLibraryVersion(deps, 'insights', 'Insights', 'v', 'insights')).rejects.toThrow(
      'library "insights" belongs to namespace "default", not "insights"',
    );
    expect((await getLibrary(deps, 'insights'))?.namespace_id).toBe('default');
    expect(state.versions).toHaveLength(0);
  });

  it('pushLibrary refuses the reserved insights id for every caller', async () => {
    const { deps } = createFakeCatalog();
    deps.reservedLibraryIds = new Set(['kb-insights']);
    for (const actor of [{ kind: 'admin' } as const, { kind: 'project', keyId: 'k', namespaceId: 'default', libraryId: null } as const]) {
      const r = await pushLibrary(deps, actor, { id: 'kb-insights', displayName: 'Mine' });
      expect(r).toEqual({ ok: false, error: { status: 403, error: 'this library id is reserved for insights' } });
    }
    expect(await getLibrary(deps, 'kb-insights')).toBeUndefined();
  });
});

describe('ensureSystemLibrary', () => {
  it('creates the library in its namespace, moves it there from elsewhere, and is a no-op after', async () => {
    const { deps } = createFakeCatalog();
    expect(await ensureSystemLibrary(deps, 'kb-insights', 'Insights', 'insights')).toBe('created');
    expect((await getLibrary(deps, 'kb-insights'))?.namespace_id).toBe('insights');
    expect(await ensureSystemLibrary(deps, 'kb-insights', 'Insights', 'insights')).toBe('ok');
    await registerLibrary(deps, { id: 'old', displayName: 'Old' });
    expect(await ensureSystemLibrary(deps, 'old', 'Insights', 'insights')).toBe('moved');
    expect((await getLibrary(deps, 'old'))?.namespace_id).toBe('insights');
  });
});

describe('pushLibrary', () => {
  const key = { kind: 'project' as const, keyId: 'k', namespaceId: 'pay', libraryId: null };

  it('a project key creates a new library in its namespace', async () => {
    const { deps } = createFakeCatalog();
    await createNamespace(deps, { id: 'pay', displayName: 'Payments' });
    const r = await pushLibrary(deps, key, { id: 'svc', displayName: 'Svc' });
    expect(r.ok && r.value).toMatchObject({ created: true, library: { id: 'svc', namespace_id: 'pay' } });
  });

  it('a library of another namespace is 403', async () => {
    const { deps } = createFakeCatalog();
    await registerLibrary(deps, { id: 'orders', displayName: 'Orders' });
    const r = await pushLibrary(deps, key, { id: 'orders', displayName: 'Orders' });
    expect(r).toEqual({ ok: false, error: { status: 403, error: expect.any(String) } });
  });

  it('a library another namespace created between the check and the write is 403, not renamed', async () => {
    const { deps } = createFakeCatalog();
    await createNamespace(deps, { id: 'pay', displayName: 'Payments' });
    // The check sees no library; another namespace creates it before the write
    const get = deps.libraries.get.bind(deps.libraries);
    deps.libraries.get = async (id) => {
      deps.libraries.get = get;
      const before = await get(id);
      await registerLibrary(deps, { id, displayName: 'Theirs', namespaceId: 'default' });
      return before;
    };
    const r = await pushLibrary(deps, key, { id: 'svc', displayName: 'Mine' });
    expect(r).toEqual({ ok: false, error: { status: 403, error: expect.any(String) } });
    expect(await getLibrary(deps, 'svc')).toMatchObject({ display_name: 'Theirs', namespace_id: 'default' });
  });

  it('created is decided by the write itself', async () => {
    const { deps } = createFakeCatalog();
    await createNamespace(deps, { id: 'pay', displayName: 'Payments' });
    const first = await pushLibrary(deps, key, { id: 'svc', displayName: 'Svc' });
    const second = await pushLibrary(deps, key, { id: 'svc', displayName: 'Svc 2' });
    expect([first.ok && first.value.created, second.ok && second.value.created]).toEqual([true, false]);
  });

  it('the admin creates a library in an existing requested namespace, 404 for an unknown one', async () => {
    const { deps } = createFakeCatalog();
    await createNamespace(deps, { id: 'pay', displayName: 'Payments' });
    const r = await pushLibrary(deps, { kind: 'admin' }, { id: 'svc', displayName: 'Svc', namespaceId: 'pay' });
    expect(r.ok && r.value.library.namespace_id).toBe('pay');
    expect(await pushLibrary(deps, { kind: 'admin' }, { id: 'x', displayName: 'X', namespaceId: 'nope' })).toEqual({
      ok: false,
      error: { status: 404, error: 'namespace not found' },
    });
  });

  it('re-registering an existing library renames it', async () => {
    const { deps } = createFakeCatalog();
    await registerLibrary(deps, { id: 'orders', displayName: 'Orders' });
    const r = await pushLibrary(deps, { kind: 'admin' }, { id: 'orders', displayName: 'Orders 2' });
    expect(r.ok && r.value).toMatchObject({ created: false, library: { display_name: 'Orders 2', namespace_id: 'default' } });
  });

  it('an id that is not a library slug is 400 and nothing is written', async () => {
    const { deps } = createFakeCatalog();
    await createNamespace(deps, { id: 'pay', displayName: 'Payments' });
    for (const id of ['x/../../../tmp/escape', '..', 'Upper', '', 'a b', '-x']) {
      for (const actor of [{ kind: 'admin' as const }, key]) {
        expect(await pushLibrary(deps, actor, { id, displayName: 'Evil' })).toEqual({
          ok: false,
          error: { status: 400, error: expect.stringContaining('library id') },
        });
      }
    }
    expect(await listLibraries(deps)).toEqual([]);
  });
});

describe('library id validation on internal creation paths', () => {
  const bad = 'x/../../../tmp/escape';

  it('registerLibrary, ensureLibraryVersion and ensureSystemLibrary refuse an invalid id', async () => {
    const { deps } = createFakeCatalog();
    await expect(registerLibrary(deps, { id: bad, displayName: 'X' })).rejects.toThrow(/library id/);
    await expect(ensureLibraryVersion(deps, bad, 'X', 'v1')).rejects.toThrow(/library id/);
    await expect(ensureSystemLibrary(deps, bad, 'X', 'insights')).rejects.toThrow(/library id/);
    expect(await listLibraries(deps)).toEqual([]);
  });
});

describe('a new library id may not differ from an existing one only by letter case', () => {
  // A legacy row from before ids were validated; on a case-insensitive file system both ids
  // would share one image directory.
  function withLegacy() {
    const fake = createFakeCatalog();
    fake.state.libraries.set('PaymentService', {
      id: 'PaymentService', display_name: 'Legacy', namespace_id: 'default', created_at: '2025-01-01T00:00:00.000Z',
    });
    return fake;
  }

  it('pushLibrary answers 409 and writes nothing', async () => {
    const { deps, state } = withLegacy();
    expect(await pushLibrary(deps, { kind: 'admin' }, { id: 'paymentservice', displayName: 'New' })).toEqual({
      ok: false,
      error: { status: 409, error: expect.stringContaining('PaymentService') },
    });
    expect([...state.libraries.keys()]).toEqual(['PaymentService']);
  });

  it('the internal creation paths refuse it too', async () => {
    const { deps, state } = withLegacy();
    await expect(registerLibrary(deps, { id: 'paymentservice', displayName: 'X' })).rejects.toThrow(/PaymentService/);
    await expect(ensureLibraryVersion(deps, 'paymentservice', 'X', 'v1')).rejects.toThrow(/PaymentService/);
    await expect(ensureSystemLibrary(deps, 'paymentservice', 'X', 'insights')).rejects.toThrow(/PaymentService/);
    expect([...state.libraries.keys()]).toEqual(['PaymentService']);
  });

  it('an existing library is still renamed, and other ids are unaffected', async () => {
    const { deps } = withLegacy();
    await registerLibrary(deps, { id: 'orders', displayName: 'Orders' });
    const r = await pushLibrary(deps, { kind: 'admin' }, { id: 'orders', displayName: 'Orders 2' });
    expect(r.ok && r.value.created).toBe(false);
  });
});
