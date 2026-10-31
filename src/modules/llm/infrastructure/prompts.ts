/**
 * Prompt templates.
 *
 * Every LLM prompt Lore uses lives in a Markdown file under `prompts/` (shipped
 * with the repo and the Docker image). A prompt is addressed by its path
 * without extension, e.g. `chat/system` → `prompts/chat/system.md`.
 *
 * Customization:
 *   LORE_PROMPTS_DIR        — directory with override files. A file there with
 *                             the same relative path (e.g. `chat/system.md`)
 *                             replaces the default; missing files fall back to
 *                             the defaults.
 *   LORE_PROMPT_VAR_<NAME>  — sets the global template variable `<name>`
 *                             (lower-cased), e.g. LORE_PROMPT_VAR_EXAMPLE_LIBRARY.
 *   <LORE_PROMPTS_DIR>/variables.json — same, as a flat JSON object.
 *
 * Templates use `{{variable}}` placeholders. Substitution is single-pass: values
 * are inserted literally and never re-scanned, so document content containing
 * `{{...}}` is safe. Unknown variables are left in place verbatim and reported
 * once with a warning. A leading `<!-- ... -->` comment (used to document the
 * prompt) is stripped from the rendered output.
 */
import { existsSync, readFileSync } from 'fs';
import { dirname, join, resolve, sep } from 'path';

export type PromptVars = Record<string, string | number | undefined | null>;

/** Names of all prompts shipped with Lore. */
export const PROMPT_NAMES = [
  'chat/system',
  'chat/context',
  'chat/brainstorm',
  'chat/tool-get-document',
  'chat/tool-list-libraries',
  'search/extract-terms',
  'publish/summary',
  'enrichment/links',
  'generator/endpoint-doc',
  'mcp/search_docs',
  'mcp/get_document',
  'mcp/list_libraries',
  'mcp/list_endpoints',
  'mcp/get_library_overview',
  'mcp/find_related_docs',
  'mcp/find_by_data_source',
  'mcp/find_by_external_dependency',
  'mcp/ask_lore',
  'mcp/get_service_topology',
  'mcp/get_document_diff',
] as const;

export type PromptName = (typeof PROMPT_NAMES)[number];

/** Global variables available to every template. */
export const DEFAULT_PROMPT_VARS: Record<string, string> = {
  assistant_name: 'Lore',
  example_library: 'orders-api',
  example_slug: 'orders/refund-create',
  example_related_slug: 'orders/refund-webhook',
  example_entity: 'orders',
  example_queue: 'order-events',
};

const NAME_RE = /^[a-z0-9][a-z0-9_-]*(\/[a-z0-9][a-z0-9_-]*)*$/i;
const VAR_RE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;
const LEADING_COMMENT_RE = /^\s*<!--[\s\S]*?-->\s*/;

const fileCache = new Map<string, string>();
const warned = new Set<string>();
let globalVarsCache: Record<string, string> | null = null;

function isDir(p: string): boolean {
  return existsSync(join(p, 'chat', 'system.md'));
}

/** Directory with the default templates shipped with Lore. */
export function getDefaultPromptsDir(): string {
  const candidates = [
    process.env.LORE_DEFAULT_PROMPTS_DIR,
    join(process.cwd(), 'prompts'),
    process.argv[1] ? join(dirname(resolve(process.argv[1])), '..', 'prompts') : undefined,
    process.argv[1] ? join(dirname(resolve(process.argv[1])), 'prompts') : undefined,
  ].filter((p): p is string => Boolean(p));
  for (const c of candidates) if (isDir(c)) return c;
  throw new Error(
    `Default prompt templates not found (looked in: ${candidates.join(', ')}). ` +
      'Run Lore from the repository root or set LORE_DEFAULT_PROMPTS_DIR.',
  );
}

function getOverrideDir(): string | undefined {
  return process.env.LORE_PROMPTS_DIR || undefined;
}

function safeJoin(base: string, name: string): string {
  const full = resolve(base, `${name}.md`);
  if (!full.startsWith(resolve(base) + sep)) throw new Error(`Invalid prompt name: ${name}`);
  return full;
}

/** Raw template text (override if present, else default), without substitution. */
export function loadPromptTemplate(name: string): string {
  if (!NAME_RE.test(name)) throw new Error(`Invalid prompt name: ${name}`);
  const cached = fileCache.get(name);
  if (cached !== undefined) return cached;

  let text: string | undefined;
  const overrideDir = getOverrideDir();
  if (overrideDir) {
    const p = safeJoin(overrideDir, name);
    if (existsSync(p)) text = readFileSync(p, 'utf8');
  }
  if (text === undefined) {
    const p = safeJoin(getDefaultPromptsDir(), name);
    if (!existsSync(p)) throw new Error(`Unknown prompt "${name}" (no default template at ${p})`);
    text = readFileSync(p, 'utf8');
  }
  text = text.replace(LEADING_COMMENT_RE, '').replace(/\s+$/, '');
  fileCache.set(name, text);
  return text;
}

/** Global variables: defaults < variables.json in LORE_PROMPTS_DIR < LORE_PROMPT_VAR_* env. */
export function getGlobalPromptVars(): Record<string, string> {
  if (globalVarsCache) return globalVarsCache;
  const vars: Record<string, string> = { ...DEFAULT_PROMPT_VARS };

  const overrideDir = getOverrideDir();
  if (overrideDir) {
    const p = join(overrideDir, 'variables.json');
    if (existsSync(p)) {
      const parsed = JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>;
      for (const [k, v] of Object.entries(parsed)) {
        if (v !== null && typeof v !== 'object') vars[k] = String(v);
      }
    }
  }
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith('LORE_PROMPT_VAR_') && v !== undefined) {
      vars[k.slice('LORE_PROMPT_VAR_'.length).toLowerCase()] = v;
    }
  }
  // Derived: dot-notation display name of the example document
  if (!('example_dotted' in vars)) {
    vars.example_dotted = `${vars.example_library}.${vars.example_slug.replace(/\//g, '.')}`;
  }
  globalVarsCache = vars;
  return vars;
}

/** Substitute `{{var}}` placeholders in a template string. Single pass; unknown vars are kept. */
export function renderTemplate(
  template: string,
  vars: PromptVars,
  onUnknown?: (name: string) => void,
): string {
  return template.replace(VAR_RE, (match, key: string) => {
    const value = vars[key];
    if (value === undefined || value === null) {
      onUnknown?.(key);
      return match;
    }
    return String(value);
  });
}

/** Load a prompt by name and render it with global + call-specific variables. */
export function renderPrompt(name: PromptName | string, vars: PromptVars = {}): string {
  const template = loadPromptTemplate(name);
  return renderTemplate(template, { ...getGlobalPromptVars(), ...vars }, (key) => {
    const id = `${name}:${key}`;
    if (warned.has(id)) return;
    warned.add(id);
    console.warn(`[prompts] "${name}" references unknown variable {{${key}}}; left as-is`);
  });
}

/** Clear caches (tests, or after changing LORE_PROMPTS_DIR at runtime). */
export function resetPromptCache(): void {
  fileCache.clear();
  warned.clear();
  globalVarsCache = null;
}
