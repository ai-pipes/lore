/**
 * CHAT_JS is an untagged template literal, so a regex escape such as `\b` or `\s` in its source
 * is consumed by TypeScript (`\b` becomes a backspace, `\s` becomes `s`) unless it is doubled.
 * These tests run the regexes exactly as they are shipped to the browser.
 */
import { describe, it, expect } from 'vitest';
import { CHAT_JS } from '../../modules/chat/index.js';

/** The regex literal in CHAT_JS that follows `prefix`, evaluated as the browser would. */
function shippedRegex(prefix: string): RegExp {
  const at = CHAT_JS.indexOf(prefix);
  expect(at, `${prefix} not found in CHAT_JS`).toBeGreaterThanOrEqual(0);
  const literal = /^\/(?:\\.|[^/\\\n])+\/[gimsuy]*/.exec(CHAT_JS.slice(at + prefix.length));
  expect(literal).not.toBeNull();
  return new Function(`return ${literal![0]};`)() as RegExp;
}

describe('CHAT_JS regexes', () => {
  it('contains no control characters (a lost escape such as \\b turns into one)', () => {
    // eslint-disable-next-line no-control-regex
    expect(CHAT_JS).not.toMatch(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/);
  });

  it('the in:<service> <question> shortcut splits the scope from the question', () => {
    const re = shippedRegex('var scopeMatch = text.match(');
    expect('in:petstore-api how do I authenticate?'.match(re)?.slice(1)).toEqual([
      'petstore-api',
      'how do I authenticate?',
    ]);
    expect('in:petstore-api'.match(re)).toBeNull();
    expect('Sin:x Ss y'.match(re)).toBeNull();
  });

  it('the find panel title-cases domain names', () => {
    const re = shippedRegex(".replace(/[-_]/g, ' ').replace(");
    expect('order-service'.replace(/[-_]/g, ' ').replace(re, (c) => c.toUpperCase())).toBe('Order Service');
  });
});
