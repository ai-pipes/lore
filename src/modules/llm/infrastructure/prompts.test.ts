import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  PROMPT_NAMES,
  renderPrompt,
  renderTemplate,
  loadPromptTemplate,
  resetPromptCache,
  getGlobalPromptVars,
} from './prompts.js';

const CALL_VARS: Record<string, Record<string, string>> = {
  'enrichment/links': { slug: 's', domain: 'd', summary: 'x', content: 'c', known_slugs: 'a, b', link_types: 'references' },
  'generator/endpoint-doc': {
    service: 'petstore-api', http_method: 'GET', route: '/pets/{petId}', operation_id: 'getPet', slug: 'pets/get-pet',
    domain: 'pets', entry_type: 'query_handler', handler_class: 'GetPetHandler', operation: '{}', components: '{}',
    known_slugs: '', source_code: '',
  },
};

let overrideDir: string;

beforeEach(() => {
  overrideDir = mkdtempSync(join(tmpdir(), 'lore-prompts-'));
  delete process.env.LORE_PROMPTS_DIR;
  resetPromptCache();
});

afterEach(() => {
  rmSync(overrideDir, { recursive: true, force: true });
  delete process.env.LORE_PROMPTS_DIR;
  delete process.env.LORE_PROMPT_VAR_EXAMPLE_LIBRARY;
  resetPromptCache();
  vi.restoreAllMocks();
});

describe('default prompts', () => {
  it.each(PROMPT_NAMES)('%s loads and renders without unresolved variables', (name) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = renderPrompt(name, CALL_VARS[name] ?? {});
    expect(out.length).toBeGreaterThan(20);
    expect(out).not.toMatch(/\{\{\s*\w+\s*\}\}/);
    expect(out.startsWith('<!--')).toBe(false); // documentation header is stripped
    expect(warn).not.toHaveBeenCalled();
  });

  it('default examples are neutral and derived from variables', () => {
    const out = renderPrompt('chat/system');
    expect(out).toContain('[ref:orders-api/orders/refund-create]');
    expect(out).toContain('orders-api.orders.refund-create');
  });

  it('throws for an unknown prompt name', () => {
    expect(() => loadPromptTemplate('chat/does-not-exist')).toThrow(/Unknown prompt/);
  });

  it('rejects path traversal in prompt names', () => {
    expect(() => loadPromptTemplate('../package')).toThrow(/Invalid prompt name/);
    expect(() => loadPromptTemplate('chat/../../etc/passwd')).toThrow(/Invalid prompt name/);
  });
});

describe('LORE_PROMPTS_DIR overrides', () => {
  it('override file wins over the default', () => {
    mkdirSync(join(overrideDir, 'chat'));
    writeFileSync(join(overrideDir, 'chat', 'system.md'), '<!-- custom -->\nYou are {{assistant_name}} for the Petstore team.');
    process.env.LORE_PROMPTS_DIR = overrideDir;
    resetPromptCache();
    expect(renderPrompt('chat/system')).toBe('You are Lore for the Petstore team.');
  });

  it('missing override file falls back to the default', () => {
    mkdirSync(join(overrideDir, 'chat'));
    writeFileSync(join(overrideDir, 'chat', 'system.md'), 'custom');
    process.env.LORE_PROMPTS_DIR = overrideDir;
    resetPromptCache();
    expect(renderPrompt('chat/context')).toContain('## Pinned documentation');
  });

  it('a non-existent override directory falls back to defaults', () => {
    process.env.LORE_PROMPTS_DIR = join(overrideDir, 'nope');
    resetPromptCache();
    expect(renderPrompt('search/extract-terms')).toContain('search terms');
  });

  it('variables.json and LORE_PROMPT_VAR_* set global variables (env wins)', () => {
    writeFileSync(join(overrideDir, 'variables.json'), JSON.stringify({ assistant_name: 'Docs Bot', example_library: 'from-json' }));
    process.env.LORE_PROMPTS_DIR = overrideDir;
    process.env.LORE_PROMPT_VAR_EXAMPLE_LIBRARY = 'petstore-api';
    resetPromptCache();
    const vars = getGlobalPromptVars();
    expect(vars.assistant_name).toBe('Docs Bot');
    expect(vars.example_library).toBe('petstore-api');
    expect(renderPrompt('chat/system')).toContain('[ref:petstore-api/orders/refund-create]');
  });
});

describe('template substitution', () => {
  it('replaces known variables, tolerating inner whitespace', () => {
    expect(renderTemplate('a {{x}} b {{ y }}', { x: 1, y: 'two' })).toBe('a 1 b two');
  });

  it('leaves unknown variables verbatim and reports them', () => {
    const unknown: string[] = [];
    expect(renderTemplate('hi {{name}} {{missing}}', { name: 'Ann' }, (k) => unknown.push(k))).toBe('hi Ann {{missing}}');
    expect(unknown).toEqual(['missing']);
  });

  it('warns once per prompt and variable', () => {
    mkdirSync(join(overrideDir, 'chat'));
    writeFileSync(join(overrideDir, 'chat', 'system.md'), 'x {{nope}}');
    process.env.LORE_PROMPTS_DIR = overrideDir;
    resetPromptCache();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(renderPrompt('chat/system')).toBe('x {{nope}}');
    renderPrompt('chat/system');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('does not re-expand placeholders inside substituted values', () => {
    const out = renderPrompt('enrichment/links', { ...CALL_VARS['enrichment/links'], content: 'evil {{slug}} {{assistant_name}}' });
    expect(out).toContain('evil {{slug}} {{assistant_name}}');
  });
});
