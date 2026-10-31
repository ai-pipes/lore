import { describe, expect, it } from 'vitest';
import { MAX_INSIGHT_LINKS, collectRefs, insightTitle, transcriptOf } from './insight.js';

describe('collectRefs', () => {
  it('keeps pinned documents first, then [ref:] citations in order, without duplicates', () => {
    const refs = collectRefs(
      ['see [ref:orders-api/orders/doc-1] and [ref:orders-api/orders/doc-2] and [ref:orders-api/orders/doc-1]'],
      [{ library_id: 'orders-api', slug: 'orders/doc-2' }, { bogus: true }, null, 'x'],
      'insights',
    );
    expect(refs).toEqual([
      { library: 'orders-api', slug: 'orders/doc-2' },
      { library: 'orders-api', slug: 'orders/doc-1' },
    ]);
  });

  it(`caps at ${MAX_INSIGHT_LINKS} distinct refs, pinned first`, () => {
    const pinned = Array.from({ length: 10 }, (_, i) => ({ library_id: 'p', slug: `pinned-${i}` }));
    const text = Array.from({ length: 200 }, (_, i) => `[ref:lib/doc-${i}]`).join(' ');
    const refs = collectRefs([text], pinned, 'insights');
    expect(MAX_INSIGHT_LINKS).toBe(50);
    expect(refs).toHaveLength(50);
    expect(refs.slice(0, 10).every((r) => r.library === 'p')).toBe(true);
    expect(refs[10]).toEqual({ library: 'lib', slug: 'doc-0' });
  });

  it('honours a custom limit', () => {
    expect(collectRefs(['[ref:a/x] [ref:a/y] [ref:a/z]'], [], 'insights', 2)).toHaveLength(2);
  });

  it('drops self-references to the insights library and overlong slugs', () => {
    const long = 'a'.repeat(301);
    expect(collectRefs([`[ref:insights/insight/x] [ref:lib/${long}]`], [{ library_id: 'insights', slug: 'y' }], 'insights')).toEqual([]);
  });

  it('returns nothing when there is nothing to cite', () => {
    expect(collectRefs(['no refs here'], [], 'insights')).toEqual([]);
  });
});

describe('transcriptOf', () => {
  it('renders user and assistant turns only', () => {
    expect(
      transcriptOf([
        { role: 'user', content: 'q' },
        { role: 'search', content: 'ignored' },
        { role: 'assistant', content: 'a' },
      ]),
    ).toBe('**User:** q\n\n**AI:** a');
  });
});

describe('insightTitle', () => {
  it('prefers the given title, then the first summary line without heading marks, then the session title', () => {
    expect(insightTitle('  Mine  ', '# Summary\nbody', 'Session')).toBe('Mine');
    expect(insightTitle(undefined, '## Refunds after delivery\n\nbody', 'Session')).toBe('Refunds after delivery');
    expect(insightTitle('   ', '', 'Session')).toBe('Session');
  });
});
