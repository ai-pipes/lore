import { describe, expect, it } from 'vitest';
import { displayNameOf, rewriteImageUrls } from './answer-context.js';

describe('rewriteImageUrls', () => {
  it('rewrites absolute library image URLs and relative paths, in markdown and <img>', () => {
    const md = [
      '![a](https://api.libraries.orders/versions/v1/images/x/a.png)',
      '![b](./img/b.png)',
      '<img alt="c" src="../c.png">',
      '![d](https://example.com/d.png)',
    ].join('\n');
    expect(rewriteImageUrls(md, 'orders', 'v2', 'orders/doc').split('\n')).toEqual([
      '![a](/static/libraries/orders/versions/v1/images/x/a.png)',
      '![b](/static/libraries/orders/versions/v2/images/orders/doc/b.png)',
      '<img alt="c" src="/static/libraries/orders/versions/v2/images/orders/doc/c.png">',
      '![d](https://example.com/d.png)',
    ]);
  });

  it('rewrites the src of an <img> with other attributes around it, and leaves tags without src alone', () => {
    const md = '<img class="w" src="./a.png" alt="x"> <img alt="none"> <img\nsrc="./b.png"\n/>';
    expect(rewriteImageUrls(md, 'orders', 'v2', 's')).toBe(
      '<img class="w" src="/static/libraries/orders/versions/v2/images/s/a.png" alt="x"> <img alt="none"> ' +
        '<img\nsrc="/static/libraries/orders/versions/v2/images/s/b.png"\n/>',
    );
  });

  it.each([
    ['unterminated <img tags', '<img '],
    ['unterminated <img src values', '<img src="'],
    ['unterminated ![ alt texts', '!['],
    ['unterminated ![a]( targets', '![a]('],
    ['src= inside one long tag', 'src="x" '],
  ])('runs in linear time on 200 KB of %s', (_name, token) => {
    const text = token.repeat(Math.ceil(200_000 / token.length));
    const started = performance.now();
    const out = rewriteImageUrls(text, 'orders', 'v2', 's');
    const elapsed = performance.now() - started;
    expect(out.length).toBeGreaterThanOrEqual(text.length);
    expect(elapsed).toBeLessThan(250);
  });
});

describe('displayNameOf', () => {
  it('joins library and slug with dots, dropping a repeated library prefix', () => {
    expect(displayNameOf('orders', 'orders/refund-create')).toBe('orders.refund-create');
    expect(displayNameOf('orders', 'billing/refund')).toBe('orders.billing.refund');
  });
});
