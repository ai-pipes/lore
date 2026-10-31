/**
 * Regression tests for stored XSS in the chat UI marker rendering
 * ([suggest:...], [ref:...] and **library.slug** chips). Runs the exact
 * client script shipped in the page inside jsdom with real marked + DOMPurify.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { JSDOM } from 'jsdom';
import { CHAT_JS, CHAT_MARKDOWN_JS, getChatHTML } from '../../modules/chat/index.js';

const NM = join(process.cwd(), 'node_modules');

let window: JSDOM['window'];
let render: (md: string) => string;

beforeAll(() => {
  const dom = new JSDOM('<!DOCTYPE html><body></body>', { runScripts: 'outside-only' });
  window = dom.window;
  window.eval(readFileSync(join(NM, 'marked/lib/marked.umd.js'), 'utf8'));
  window.eval(readFileSync(join(NM, 'dompurify/dist/purify.min.js'), 'utf8'));
  window.eval('var contextDocs = [];');
  window.eval(CHAT_MARKDOWN_JS);
  render = (md: string) => (window as unknown as { safeMarkdown: (s: string) => string }).safeMarkdown(md);
});

/** Parse rendered HTML and collect anything that could execute script. */
function dangerous(html: string): string[] {
  const box = window.document.createElement('div');
  box.innerHTML = html;
  const found: string[] = [];
  box.querySelectorAll('*').forEach((el) => {
    if (['SCRIPT', 'IFRAME', 'OBJECT', 'EMBED'].includes(el.tagName)) found.push(el.tagName);
    for (const attr of Array.from(el.attributes)) {
      if (/^on/i.test(attr.name)) found.push(`${el.tagName}[${attr.name}]`);
      if (/^\s*javascript:/i.test(attr.value)) found.push(`${el.tagName}[${attr.name}=js]`);
    }
  });
  return found;
}

function chips(html: string, selector: string) {
  const box = window.document.createElement('div');
  box.innerHTML = html;
  return Array.from(box.querySelectorAll(selector)).map((el) => ({
    lib: el.getAttribute('data-lib'),
    slug: el.getAttribute('data-slug'),
    text: el.textContent,
  }));
}

const PAYLOADS = [
  '[suggest:x" onmouseover="alert(1)" a=".slug]',
  '[suggest:lib.a" onmouseover="alert(1)]',
  '[suggest:lib.&lt;img src=x onerror=alert(1)&gt;]',
  '[suggest:lib.\\<img src=x onerror=alert(1)\\>]',
  '[ref:x" onmouseover="alert(1)/slug]',
  '[ref:lib/a" autofocus onfocus="alert(1)]',
  '[ref:lib/&lt;svg onload=alert(1)&gt;]',
  '**a" onclick="alert(1).b**',
  '<img src=x onerror=alert(1)>',
  '<a href="javascript:alert(1)">x</a>',
];

describe('chat markdown rendering — XSS regression', () => {
  it.each(PAYLOADS)('payload %s produces no executable markup', (payload) => {
    const html = render(`Answer ${payload} end`);
    expect(dangerous(html)).toEqual([]);
  });

  it('marker values with quotes are not turned into chips', () => {
    const html = render('[suggest:lib.a" onmouseover="alert(1)] and [ref:lib/a" x="y]');
    expect(chips(html, '.suggest-add')).toHaveLength(0);
    expect(chips(html, '.cite-chip')).toHaveLength(0);
  });

  it('valid citation markers become chips with exact data attributes', () => {
    const html = render('Refunds are async. [ref:orders-api/orders/refund-create]');
    expect(chips(html, '.cite-chip')).toEqual([
      expect.objectContaining({ lib: 'orders-api', slug: 'orders/refund-create', text: 'orders-api.orders.refund-create →' }),
    ]);
  });

  it('valid suggestion markers become chips', () => {
    const html = render('See [suggest:payments-service.payments/charge-card]');
    expect(chips(html, '.suggest-add')).toEqual([
      expect.objectContaining({ lib: 'payments-service', slug: 'payments/charge-card', text: '+ charge-card' }),
    ]);
  });

  it('markers inside code blocks are left untouched', () => {
    const html = render('`[ref:orders-api/orders/refund-create]`');
    expect(chips(html, '.cite-chip')).toHaveLength(0);
    expect(html).toContain('[ref:orders-api/orders/refund-create]');
  });

  it('bold library.slug names become citation chips', () => {
    const html = render('**orders-api.orders.refund-create**');
    expect(chips(html, '.cite-chip')).toEqual([
      expect.objectContaining({ lib: 'orders-api', slug: 'orders/refund-create' }),
    ]);
  });

  it('escapeHtml escapes quotes as well as angle brackets', () => {
    const esc = (window as unknown as { escapeHtml: (s: string) => string }).escapeHtml;
    expect(esc('<a href="x">\'')).toBe('&lt;a href=&quot;x&quot;&gt;&#39;');
  });
});

describe('chat page', () => {
  it('references only same-origin assets and has no inline scripts or styles', () => {
    const html = getChatHTML();
    expect(html).not.toMatch(/https?:\/\//);
    const scripts = html.match(/<script\b[^>]*>/g) ?? [];
    expect(scripts.length).toBeGreaterThan(0);
    for (const tag of scripts) expect(tag).toMatch(/src="\/assets\//);
    expect(html).not.toMatch(/<script>(?!<)/); // no inline script bodies
    expect(html).not.toMatch(/<style\b/);
    expect(html).not.toMatch(/\sstyle="/);
    expect(html).not.toMatch(/\son[a-z]+="/);
    expect(html).not.toContain('nonce');
  });

  it('client script embeds the tested renderer and runs mermaid in strict mode', () => {
    expect(CHAT_JS).toContain('function safeMarkdown(text)');
    expect(CHAT_JS).toContain("securityLevel: 'strict'");
  });

  it('mermaid output never gets a nonce and SVG <style> is stripped', () => {
    expect(CHAT_JS).not.toMatch(/setAttribute\('nonce'/);
    expect(CHAT_JS).toContain("FORBID_TAGS: ['style']");
    expect(CHAT_JS).toMatch(/secure: \[[^\]]*'themeCSS'[^\]]*\]/);
    expect(CHAT_JS).toContain('loreCleanMermaidSource(pres[i].textContent)');
  });
});

describe('loreCleanMermaidSource', () => {
  const clean = (s: string) => (window as unknown as { loreCleanMermaidSource: (s: string) => string }).loreCleanMermaidSource(s);

  it('removes %%{init}%% directives, including multi-line ones', () => {
    const src = '%%{init: {"themeCSS": ".node rect { fill: url(https://evil.example/x) }"}}%%\nflowchart LR\n  A --> B';
    expect(clean(src)).not.toContain('themeCSS');
    expect(clean(src)).toContain('flowchart LR');
    expect(clean('%%{\n  init: { "fontFamily": "x" }\n}%%\ngraph TD\nA-->B')).not.toContain('fontFamily');
  });

  it('removes YAML front-matter config', () => {
    const src = '---\nconfig:\n  themeCSS: "* { display: none }"\n---\nflowchart LR\n  A --> B';
    expect(clean(src)).not.toContain('themeCSS');
    expect(clean(src).trim().startsWith('flowchart LR')).toBe(true);
  });

  it('keeps ordinary %% comments and diagram text', () => {
    expect(clean('flowchart LR\n  %% a comment\n  A --> B')).toContain('%% a comment');
  });
});

describe('safeMarkdown <img> preprocessing', () => {
  it('turns a raw <img> into a Markdown image', () => {
    const box = window.document.createElement('div');
    box.innerHTML = render('<img alt="diagram" src="/static/libraries/a/versions/v/images/s/d.png">');
    const img = box.querySelector('img');
    expect(img?.getAttribute('src')).toBe('/static/libraries/a/versions/v/images/s/d.png');
    expect(img?.getAttribute('alt')).toBe('diagram');
  });

  it('stays fast on 200 KB of unterminated <img tags', () => {
    const started = performance.now();
    render('<img '.repeat(40_000));
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});
