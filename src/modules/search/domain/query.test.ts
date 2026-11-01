import { describe, expect, it } from 'vitest';
import { anyTermQuery, parseDotSlug, termsAreTranslated, SLUG_PATTERN, slugCandidates } from './query.js';

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

describe('anyTermQuery', () => {
  it('joins the terms with OR so a document matching only some of them is still found', () => {
    expect(anyTermQuery('cancellation cost courier assigned')).toBe('cancellation or cost or courier or assigned');
  });
  it('drops web-search operators the extractor may emit: quotes, a leading minus, and or/and/not words', () => {
    expect(anyTermQuery('"order created" -draft OR refund and not')).toBe('order or created or draft or refund');
  });
  it('keeps a single term and returns an empty string for blank input', () => {
    expect(anyTermQuery('  refund ')).toBe('refund');
    expect(anyTermQuery('   ')).toBe('');
  });
});

describe('termsAreTranslated', () => {
  it('is false when the terms are words of the (English) question', () => {
    expect(termsAreTranslated('Which endpoint returns the estimated delivery time of an order?', 'estimated delivery time endpoint')).toBe(false);
    expect(termsAreTranslated('How is the delivery price calculated?', 'delivery price calculation')).toBe(false);
  });
  it('is true when the terms translate a question in another language', () => {
    expect(termsAreTranslated('Wie wird der Lieferpreis berechnet?', 'delivery price calculation')).toBe(true);
    expect(termsAreTranslated('Сколько стоит отмена заказа?', 'order cancellation cost')).toBe(true);
  });
  it('is false for empty terms', () => {
    expect(termsAreTranslated('q', '  ')).toBe(false);
  });
});
