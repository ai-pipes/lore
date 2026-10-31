import { describe, expect, it } from 'vitest';
import { parseDotSlug, SLUG_PATTERN, slugCandidates } from './query.js';

describe('parseDotSlug', () => {
  it('splits a namespaced slug into a library and a query', () => {
    expect(parseDotSlug('store.accesscontrol-group-list')).toEqual({ library_id: 'store', query: 'accesscontrol group list' });
  });

  it('turns dots, dashes and slashes of the slug part into spaces', () => {
    expect(parseDotSlug('  orders.refund/create.v2  ')).toEqual({ library_id: 'orders', query: 'refund create v2' });
  });

  it('returns null for free text', () => {
    expect(parseDotSlug('how do refunds work?')).toBeNull();
    expect(parseDotSlug('nodot')).toBeNull();
  });
});

describe('slugCandidates', () => {
  it('returns null when the text is not a dotted slug', () => {
    expect(SLUG_PATTERN.test('plain words')).toBe(false);
    expect(slugCandidates('plain words')).toBeNull();
  });

  it('lowercases and lists the slug variants in lookup order', () => {
    expect(slugCandidates(' Order-Service.Create-Order.Something ')).toEqual({
      library_id: 'order-service',
      slugs: ['create-order/something', 'create-order.something'],
    });
  });

  it('keeps distinct variants for three dotted parts', () => {
    expect(slugCandidates('lib.a.b.c')?.slugs).toEqual(['a/b/c', 'a/b-c', 'a.b.c']);
  });
});
