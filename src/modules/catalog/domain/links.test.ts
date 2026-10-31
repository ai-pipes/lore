import { describe, expect, it } from 'vitest';
import { VALID_LINK_TYPES, acceptSuggestedLinks } from './links.js';

describe('acceptSuggestedLinks', () => {
  const known = ['orders/create', 'payments/charge'];

  it('keeps well-formed links to known slugs with a valid type and confidence >= 0.5', () => {
    const raw = [
      { toSlug: 'orders/create', linkType: 'calls-service', confidence: 0.9 },
      { toSlug: 'payments/charge', linkType: 'uses-dal', confidence: 0.5 },
    ];
    expect(acceptSuggestedLinks(raw, known)).toEqual(raw);
  });

  it('drops unknown slugs, invalid types, low confidence and malformed items', () => {
    const raw = [
      { toSlug: 'nope', linkType: 'calls-service', confidence: 0.9 },
      { toSlug: 'orders/create', linkType: 'invented', confidence: 0.9 },
      { toSlug: 'orders/create', linkType: 'references', confidence: 0.49 },
      { toSlug: 'orders/create', linkType: 'references', confidence: '0.9' },
      { toSlug: 42, linkType: 'references', confidence: 0.9 },
      null,
      'orders/create',
    ];
    expect(acceptSuggestedLinks(raw, known)).toEqual([]);
  });

  it('lists the link types the LLM may use', () => {
    expect(VALID_LINK_TYPES).toContain('references');
    expect(VALID_LINK_TYPES).toContain('depends-on');
  });
});

describe('parseSuggestedLinks', async () => {
  const { parseSuggestedLinks } = await import('./links.js');
  it('accepts a bare array, {links: [...]} and {results: [...]}', () => {
    expect(parseSuggestedLinks('[1]')).toEqual([1]);
    expect(parseSuggestedLinks('{"links":[2]}')).toEqual([2]);
    expect(parseSuggestedLinks('{"results":[3]}')).toEqual([3]);
  });
  it('returns [] for invalid JSON or a non-array payload', () => {
    expect(parseSuggestedLinks('not json')).toEqual([]);
    expect(parseSuggestedLinks('{"links":"x"}')).toEqual([]);
    expect(parseSuggestedLinks('{}')).toEqual([]);
  });
});
