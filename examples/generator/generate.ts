/**
 * Example doc generator: OpenAPI spec -> one Lore Markdown document per endpoint -> lore push.
 *
 * This is the "generation" half of the pipeline. Run it in CI on every merge
 * so the documentation is rebuilt from the code that was actually shipped.
 *
 *   npx tsx examples/generator/generate.ts \
 *     --spec examples/generator/petstore.openapi.json \
 *     --service petstore-api \
 *     --out generated-docs/petstore-api \
 *     [--source-dir src/routes]   # optional: code snippets mentioning the operationId go to the LLM
 *     [--push] [--version <sha>] [--dry-run] [--model openai/gpt-4o-mini]
 *
 * With an LLM (the server's settings: LLM_API_KEY and/or LLM_BASE_URL, OpenRouter
 * by default; the model from --model, GENERATOR_MODEL or LLM_MODEL) each endpoint
 * is written by the model using the `generator/endpoint-doc` prompt (override it
 * via LORE_PROMPTS_DIR).
 * Without one, or with --dry-run, it writes deterministic skeletons straight
 * from the spec, so the pipeline still works.
 */
import 'dotenv/config';
import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { dirname, extname, join } from 'path';
import matter from 'gray-matter';
import { createLanguageModel, llmConfigFromEnv, renderPrompt, type LanguageModel } from '../../src/modules/llm/index.js';
import { push } from '../../src/cli/push.js';
import { resolveCredentials } from '../../src/cli/credentials.js';

/* ── CLI args ─────────────────────────────────────────── */

interface Args {
  spec: string;
  service: string;
  out: string;
  sourceDir?: string;
  push: boolean;
  version?: string;
  dryRun: boolean;
  /** Empty when neither --model, GENERATOR_MODEL nor LLM_MODEL is set. */
  model: string;
  concurrency: number;
}

function parseArgs(argv: string[]): Args {
  const get = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const spec = get('spec');
  const service = get('service');
  if (!spec || !service) {
    console.error('Usage: generate.ts --spec <openapi.json> --service <library-id> [--out dir] [--source-dir dir] [--push] [--version sha] [--dry-run] [--model name]');
    process.exit(2);
  }
  return {
    spec,
    service,
    out: get('out') ?? join('generated-docs', service),
    sourceDir: get('source-dir'),
    push: argv.includes('--push'),
    version: get('version'),
    dryRun: argv.includes('--dry-run'),
    model: get('model') ?? process.env.GENERATOR_MODEL ?? process.env.LLM_MODEL ?? '',
    concurrency: Number(get('concurrency') ?? 4),
  };
}

/* ── OpenAPI helpers ──────────────────────────────────── */

type Json = Record<string, unknown>;
interface Operation {
  method: string;
  route: string;
  operationId: string;
  op: Json;
  slug: string;
  domain: string;
  entryType: string;
  handlerClass: string;
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase().replace(/^-|-$/g, '');
const pascal = (s: string) => kebab(s).split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');

export function collectOperations(spec: Json): Operation[] {
  const ops: Operation[] = [];
  for (const [route, item] of Object.entries((spec.paths ?? {}) as Record<string, Json>)) {
    for (const method of METHODS) {
      const op = item[method] as Json | undefined;
      if (!op) continue;
      const operationId = (op.operationId as string) ?? `${method}-${route}`;
      const tags = (op.tags as string[] | undefined) ?? [];
      const domain = kebab(tags[0] ?? route.split('/').filter((p) => p && !p.startsWith('{') && !/^v\d+$/.test(p) && p !== 'api')[0] ?? 'api');
      ops.push({
        method: method.toUpperCase(),
        route,
        operationId,
        op,
        domain,
        slug: `${domain}/${kebab(operationId)}`,
        entryType: method === 'get' ? 'query_handler' : 'handler',
        handlerClass: `${pascal(operationId)}Handler`,
      });
    }
  }
  return ops;
}

/** Resolve the component schemas an operation references (transitively). */
function referencedSchemas(spec: Json, op: Json): Json {
  const all = ((spec.components as Json | undefined)?.schemas ?? {}) as Record<string, Json>;
  const found: Json = {};
  const visit = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node as Json)) {
      if (k === '$ref' && typeof v === 'string') {
        const name = v.split('/').pop()!;
        if (!(name in found) && all[name]) {
          found[name] = all[name];
          visit(all[name]);
        }
      } else visit(v);
    }
  };
  visit(op);
  return found;
}

function schemaType(s: Json | undefined): string {
  if (!s) return '';
  if (s.$ref) return String(s.$ref).split('/').pop()!;
  if (s.type === 'array') return `${schemaType(s.items as Json)}[]`;
  return [s.type, s.format].filter(Boolean).join(':') || 'object';
}

/** Deterministic document built only from the spec (no LLM). */
export function skeletonDoc(spec: Json, o: Operation): string {
  const params = (o.op.parameters as Json[] | undefined) ?? [];
  const body = (((o.op.requestBody as Json | undefined)?.content as Json | undefined)?.['application/json'] as Json | undefined)?.schema as Json | undefined;
  const schemas = referencedSchemas(spec, o.op) as Record<string, Json>;
  const bodySchema = body?.$ref ? schemas[String(body.$ref).split('/').pop()!] : body;
  const required = new Set((bodySchema?.required as string[] | undefined) ?? []);

  const rows: string[] = params.map((p) => {
    const sch = p.schema as Json | undefined;
    const extra = [sch?.enum ? `one of ${(sch.enum as string[]).join(', ')}` : '', sch?.default !== undefined ? `default ${sch.default}` : ''].filter(Boolean).join('; ');
    return `| \`${p.name}\` | ${p.in} | ${schemaType(sch)} | ${p.required ? 'yes' : 'no'} | ${extra} |`;
  });
  for (const [name, prop] of Object.entries(((bodySchema?.properties ?? {}) as Record<string, Json>))) {
    const extra = [prop.enum ? `one of ${(prop.enum as string[]).join(', ')}` : '', prop.maxItems ? `max ${prop.maxItems} items` : '', prop.maxLength ? `max ${prop.maxLength} chars` : '', prop.maximum !== undefined ? `max ${prop.maximum}` : ''].filter(Boolean).join('; ');
    rows.push(`| \`${name}\` | body | ${schemaType(prop)} | ${required.has(name) ? 'yes' : 'no'} | ${extra} |`);
  }

  const responses = Object.entries((o.op.responses ?? {}) as Record<string, Json>);
  const ok = responses.filter(([c]) => c.startsWith('2'));
  const errors = responses.filter(([c]) => !c.startsWith('2'));
  const summary = String(o.op.summary ?? `${o.method} ${o.route}`).replace(/\s+/g, ' ').trim();

  const fm = {
    slug: o.slug,
    domain: o.domain,
    entry_type: o.entryType,
    handler_class: o.handlerClass,
    http_method: o.method,
    route: o.route,
    summary,
    category: 'specification',
    generated_at: new Date().toISOString(),
  };
  const lines = [
    `# ${o.handlerClass}`,
    '',
    `${summary}.${o.op.description ? ` ${o.op.description}` : ''}`,
    '',
    '## Request',
    '',
    rows.length ? '| Parameter | Location | Type | Required | Notes |\n|-----------|----------|------|----------|-------|\n' + rows.join('\n') : 'No parameters.',
    '',
    '## Response',
    '',
    ...ok.map(([code, r]) => {
      const sch = ((r.content as Json | undefined)?.['application/json'] as Json | undefined)?.schema as Json | undefined;
      return `\`${code}\` — ${r.description ?? ''}${sch ? ` (\`${schemaType(sch)}\`)` : ''}`;
    }),
    '',
    '## Business Logic',
    '',
    'Not specified. (Skeleton generated from the OpenAPI spec without an LLM.)',
    '',
    '## Error Handling',
    '',
    errors.length ? '| HTTP code | Condition |\n|-----------|-----------|\n' + errors.map(([c, r]) => `| \`${c}\` | ${r.description ?? ''} |`).join('\n') : 'Not specified.',
  ];
  if (Object.keys(schemas).length) {
    lines.push('', '## Schemas', '', '```json', JSON.stringify(schemas, null, 2), '```');
  }
  return matter.stringify(lines.join('\n') + '\n', fm);
}

/* ── Source code context (optional) ───────────────────── */

function findSource(dir: string | undefined, operationId: string, limit = 6000): string {
  if (!dir || !existsSync(dir)) return '';
  const needles = [operationId, pascal(operationId), kebab(operationId)];
  const hits: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      if (name === 'node_modules' || name.startsWith('.')) continue;
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (['.ts', '.js', '.py', '.go', '.cs', '.java', '.kt', '.rb'].includes(extname(p))) {
        const text = readFileSync(p, 'utf8');
        if (needles.some((n) => text.includes(n))) hits.push(`// ${p}\n${text}`);
      }
    }
  };
  walk(dir);
  return hits.join('\n\n').slice(0, limit);
}

/* ── LLM generation ───────────────────────────────────── */

/** Bounds on each generation request. */
const GENERATE_REQUEST = { timeoutMs: 120_000, maxRetries: 1 };

/** The server's LLM settings with the generator's model choice on top. */
export function generatorLlmEnv(env: Record<string, string | undefined>, model: string): Record<string, string | undefined> {
  return { ...env, LLM_MODEL: model };
}

export async function llmDoc(model: LanguageModel, spec: Json, o: Operation, knownSlugs: string[], sourceDir?: string): Promise<string | null> {
  const prompt = renderPrompt('generator/endpoint-doc', {
    service: (spec.info as Json | undefined)?.title as string ?? 'service',
    http_method: o.method,
    route: o.route,
    operation_id: o.operationId,
    slug: o.slug,
    domain: o.domain,
    entry_type: o.entryType,
    handler_class: o.handlerClass,
    operation: JSON.stringify(o.op, null, 2),
    components: JSON.stringify(referencedSchemas(spec, o.op), null, 2),
    known_slugs: knownSlugs.join('\n'),
    source_code: findSource(sourceDir, o.operationId),
  });
  let text = (await model.complete({ messages: [{ role: 'user', content: prompt }], temperature: 0, ...GENERATE_REQUEST })).trim();
  text = text.replace(/^```(?:markdown|md)?\n([\s\S]*?)\n```$/, '$1').trim();

  // Validate: frontmatter must parse and keep the slug we asked for
  try {
    const parsed = matter(text);
    if (parsed.data.slug !== o.slug || !parsed.content.trim()) return null;
    parsed.data.generated_at = new Date().toISOString();
    if (Array.isArray(parsed.data.links)) {
      parsed.data.links = (parsed.data.links as Json[]).filter((l) => typeof l?.slug === 'string' && knownSlugs.includes(l.slug as string));
      if ((parsed.data.links as Json[]).length === 0) delete parsed.data.links;
    }
    return matter.stringify(parsed.content.trim() + '\n', parsed.data);
  } catch {
    return null;
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.max(1, limit) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}

/* ── main ─────────────────────────────────────────────── */

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const spec = JSON.parse(readFileSync(args.spec, 'utf8')) as Json;
  const ops = collectOperations(spec);
  const knownSlugs = ops.map((o) => o.slug);

  const env = generatorLlmEnv(process.env, args.model);
  const endpointSet = Boolean(process.env.LLM_API_KEY || process.env.LLM_BASE_URL);
  if (!args.dryRun && endpointSet && !args.model) {
    console.error('LLM_API_KEY / LLM_BASE_URL is set but no model: pass --model or set GENERATOR_MODEL or LLM_MODEL.');
    process.exit(2);
  }
  const useLlm = !args.dryRun && llmConfigFromEnv(env) !== null;
  if (!useLlm) {
    console.log(args.dryRun ? 'Dry run: writing skeletons from the spec.' : 'No LLM configured (LLM_API_KEY / LLM_BASE_URL): writing skeletons from the spec.');
  } else {
    console.log(`Generating ${ops.length} documents with ${args.model}...`);
  }
  const model = useLlm ? createLanguageModel(env) : null;

  let fallbacks = 0;
  const docs = await mapLimit(ops, args.concurrency, async (o) => {
    let text: string | null = null;
    if (model) {
      try {
        text = await llmDoc(model, spec, o, knownSlugs, args.sourceDir);
      } catch (err) {
        console.warn(`  ${o.slug}: LLM failed (${err instanceof Error ? err.message : err}), using skeleton`);
      }
      if (!text) fallbacks++;
    }
    return { o, text: text ?? skeletonDoc(spec, o) };
  });

  for (const { o, text } of docs) {
    const file = join(args.out, `${o.slug}.md`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
    console.log(`  wrote ${file}`);
  }
  if (fallbacks) console.log(`${fallbacks} document(s) fell back to skeletons.`);

  if (args.push) {
    const version = args.version ?? process.env.GITHUB_SHA ?? execFileSync('git', ['rev-parse', 'HEAD']).toString().trim();
    // LORE_URL + LORE_TOKEN (a project key in CI), else the credentials of `lore login`.
    const { url, token } = resolveCredentials({});
    await push({
      dir: args.out,
      library: args.service,
      version,
      branch: process.env.GITHUB_REF_NAME,
      baseUrl: url,
      token,
      promote: true,
      incremental: true,
    });
  }
}

if (process.argv[1] && /generate\.ts$/.test(process.argv[1])) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
