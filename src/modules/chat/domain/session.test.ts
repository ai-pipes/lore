import { describe, expect, it } from 'vitest';
import { MESSAGE_ROLES, PUBLISH_SLUG_RE, UUID_RE, autoTitleOf, validateSessionBody } from './session.js';

describe('autoTitleOf', () => {
  it('keeps titles of up to 60 characters', () => {
    expect(autoTitleOf('short')).toBe('short');
    expect(autoTitleOf('x'.repeat(60))).toBe('x'.repeat(60));
  });

  it('truncates to 57 characters + "..." above 60', () => {
    const title = autoTitleOf('y'.repeat(61));
    expect(title).toBe('y'.repeat(57) + '...');
    expect(title).toHaveLength(60);
  });
});

describe('validateSessionBody', () => {
  it('accepts an empty object and valid fields', () => {
    expect(validateSessionBody({})).toBeNull();
    expect(validateSessionBody({ title: 't', pinned_docs: [], scope_filters: [] })).toBeNull();
  });

  it('rejects non-objects', () => {
    expect(validateSessionBody(null as never)).toBe('body must be a JSON object');
    expect(validateSessionBody([] as never)).toBe('body must be a JSON object');
    expect(validateSessionBody('x' as never)).toBe('body must be a JSON object');
  });

  it('rejects bad field types', () => {
    expect(validateSessionBody({ title: 5 })).toBe('title must be a string (max 200 chars)');
    expect(validateSessionBody({ title: 'x'.repeat(201) })).toBe('title must be a string (max 200 chars)');
    expect(validateSessionBody({ pinned_docs: {} })).toBe('pinned_docs must be an array');
    expect(validateSessionBody({ scope_filters: 'a' })).toBe('scope_filters must be an array');
  });
});

describe('patterns', () => {
  it('message roles', () => {
    expect([...MESSAGE_ROLES]).toEqual(['user', 'assistant', 'search']);
  });

  it('publish slugs', () => {
    expect(PUBLISH_SLUG_RE.test('team/refunds_v2')).toBe(true);
    expect(PUBLISH_SLUG_RE.test('Bad Slug')).toBe(false);
    expect(PUBLISH_SLUG_RE.test('a//b')).toBe(false);
  });

  it('session ids', () => {
    expect(UUID_RE.test('00000000-0000-0000-0000-000000000000')).toBe(true);
    expect(UUID_RE.test('not-a-uuid')).toBe(false);
  });
});
