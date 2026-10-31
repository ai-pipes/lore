import { describe, expect, it } from 'vitest';
import { decidePush, type PushActor } from './push-policy.js';

const key = (libraryId: string | null = null): PushActor => ({ kind: 'project', keyId: 'k', namespaceId: 'pay', libraryId });

describe('decidePush: project keys', () => {
  it('rejects an existing library in another namespace', () => {
    expect(decidePush(key(), { libraryId: 'orders', namespaceId: 'shop' })).toEqual({ ok: false, status: 403, error: expect.any(String) });
  });

  it('creates a new library in the key namespace', () => {
    expect(decidePush(key(), { libraryId: 'new-svc', namespaceId: null })).toEqual({ ok: true, namespaceId: 'pay' });
  });

  it('pushes to an existing library of its namespace', () => {
    expect(decidePush(key(), { libraryId: 'billing', namespaceId: 'pay' })).toEqual({ ok: true, namespaceId: 'pay' });
  });

  it('a key restricted to one library may not push another', () => {
    expect(decidePush(key('a'), { libraryId: 'b', namespaceId: 'pay' }).ok).toBe(false);
    expect(decidePush(key('a'), { libraryId: 'b', namespaceId: null }).ok).toBe(false);
    expect(decidePush(key('a'), { libraryId: 'a', namespaceId: 'pay' })).toEqual({ ok: true, namespaceId: 'pay' });
  });

  it('a requested namespace must be absent or equal to the key namespace', () => {
    expect(decidePush(key(), { libraryId: 'x', namespaceId: null }, 'pay')).toEqual({ ok: true, namespaceId: 'pay' });
    expect(decidePush(key(), { libraryId: 'x', namespaceId: null }, 'shop')).toEqual({ ok: false, status: 403, error: expect.any(String) });
  });
});

describe('decidePush: admin and others', () => {
  it('nobody pushes to the insights namespace, the admin included', () => {
    expect(decidePush({ kind: 'admin' }, { libraryId: 'insights', namespaceId: 'insights' }).ok).toBe(false);
    expect(decidePush({ kind: 'admin' }, { libraryId: 'x', namespaceId: null }, 'insights')).toEqual({ ok: false, status: 403, error: expect.any(String) });
    expect(decidePush(key(), { libraryId: 'insights', namespaceId: 'insights' }).ok).toBe(false);
  });

  it('the admin creates a new library in the requested namespace or default', () => {
    expect(decidePush({ kind: 'admin' }, { libraryId: 'x', namespaceId: null })).toEqual({ ok: true, namespaceId: 'default' });
    expect(decidePush({ kind: 'admin' }, { libraryId: 'x', namespaceId: null }, 'pay')).toEqual({ ok: true, namespaceId: 'pay' });
  });

  it('the admin pushes to an existing library in any namespace', () => {
    expect(decidePush({ kind: 'admin' }, { libraryId: 'orders', namespaceId: 'shop' }, 'pay')).toEqual({ ok: true, namespaceId: 'shop' });
  });

  it('a caller that may not push is rejected', () => {
    expect(decidePush({ kind: 'none' }, { libraryId: 'x', namespaceId: 'default' })).toEqual({ ok: false, status: 403, error: expect.any(String) });
  });
});

describe('decidePush: reserved library ids (the configured insights library)', () => {
  const reserved = new Set(['kb-insights']);
  it('nobody pushes to a reserved id, whatever its namespace, existing or new', () => {
    for (const actor of [{ kind: 'admin' } as const, key(), key('kb-insights')]) {
      for (const namespaceId of [null, 'default', 'pay', 'insights']) {
        expect(decidePush(actor, { libraryId: 'kb-insights', namespaceId }, undefined, reserved)).toEqual({
          ok: false, status: 403, error: 'this library id is reserved for insights',
        });
      }
      expect(decidePush(actor, { libraryId: 'kb-insights', namespaceId: null }, 'pay', reserved).ok).toBe(false);
    }
  });

  it('other ids are unaffected', () => {
    expect(decidePush({ kind: 'admin' }, { libraryId: 'orders', namespaceId: null }, undefined, reserved).ok).toBe(true);
  });
});
