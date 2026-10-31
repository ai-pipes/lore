import { describe, it, expect } from 'vitest';
import { MAX_JSON_DEPTH, malformedInput } from './input-guard.js';

const req = (r: { params?: unknown; query?: unknown; body?: unknown }) =>
  malformedInput({ params: r.params ?? {}, query: r.query ?? {}, body: r.body });

function nested(depth: number): unknown {
  let v: unknown = 'leaf';
  for (let i = 0; i < depth; i++) v = [v];
  return v;
}

describe('malformedInput', () => {
  it('accepts ordinary input, tabs, newlines and carriage returns', () => {
    expect(req({ params: { id: 'orders-api' }, query: { q: 'a\tb\r\nc', limit: '10' }, body: { a: [1, 'x', null, true] } })).toBeNull();
    expect(req({ query: undefined, body: undefined })).toBeNull();
  });

  it('rejects control characters in params and query values', () => {
    expect(req({ params: { id: 'a\u0000' } })).toBe('Route parameter "id" contains a control character');
    expect(req({ query: { q: 'a\u001f' } })).toBe('Query parameter "q" contains a control character');
    expect(req({ query: { q: 'a\u000b' } })).toMatch(/control character/);
  });

  it('rejects repeated query parameters', () => {
    expect(req({ query: { q: ['a', 'b'] } })).toBe('Query parameter "q" is given more than once');
  });

  it('rejects NUL in JSON strings and keys, but keeps other control characters in bodies', () => {
    expect(req({ body: { a: { b: ['ok', 'x\u0000'] } } })).toBe('JSON body contains a NUL character');
    expect(req({ body: { ['k\u0000']: 1 } })).toBe('JSON body contains a NUL character');
    expect(req({ body: '\u0000' })).toBe('JSON body contains a NUL character');
    expect(req({ body: { content: 'page\fbreak \u001b[1m' } })).toBeNull();
  });

  it(`caps JSON nesting at ${MAX_JSON_DEPTH} levels`, () => {
    expect(req({ body: nested(MAX_JSON_DEPTH) })).toBeNull();
    expect(req({ body: nested(MAX_JSON_DEPTH + 1) })).toMatch(/nested too deep/);
  });

  it('ignores Buffer bodies', () => {
    expect(req({ body: Buffer.from([0, 0, 0]) })).toBeNull();
  });
});
