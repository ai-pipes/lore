import { cruise, type IViolation } from 'dependency-cruiser';
import extractDepcruiseConfig from 'dependency-cruiser/config-utl/extract-depcruise-config';
import extractTSConfig from 'dependency-cruiser/config-utl/extract-ts-config';
import { is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

export type Violation = IViolation;

const RULES = [
  'domain-is-pure',
  'application-only-domain',
  'no-inward-infra',
  'modules-via-index',
  'platform-db-only',
  'cli-no-server',
  'contracts-are-leaf',
  'shared-kernel-is-pure',
  'llm-sdk-in-adapter',
  'no-circular',
];

const ruleSet = await extractDepcruiseConfig('./.dependency-cruiser.cjs');
const tsConfig = extractTSConfig('./tsconfig.json');
const { tsConfig: _tsConfigFile, ...cruiseOptions } = ruleSet.options ?? {};

export async function violationsIn(dir: string): Promise<Violation[]> {
  const result = await cruise(
    [dir],
    {
      // The same cruise options as `npm run arch` (doNotFollow, tsPreCompilationDeps, resolution)
      ...cruiseOptions,
      ruleSet,
      validate: true,
      // The bad fixtures must never count against the real tree.
      ...(dir === 'src' || dir.startsWith('src/') ? { exclude: { path: 'test/architecture/fixtures' } } : {}),
    },
    undefined,
    { tsConfig },
  );
  if (typeof result.output === 'string') throw new Error('unexpected string output');
  return result.output.summary.violations;
}

describe('architecture rules', () => {
  it('runs with the cruise options of .dependency-cruiser.cjs', () => {
    expect(cruiseOptions).toMatchObject({ tsPreCompilationDeps: true, doNotFollow: { path: 'node_modules' } });
  });

  it.each(RULES)('rule %s fires on its bad fixture', async (rule) => {
    const v = await violationsIn(`test/architecture/fixtures/${rule}`);
    expect(v.filter((x) => x.rule.name === rule).length).toBeGreaterThan(0);
  });

  it('domain importing node:crypto breaks domain-is-pure', async () => {
    const v = await violationsIn('test/architecture/fixtures/domain-is-pure');
    expect(v).toContainEqual(
      expect.objectContaining({
        rule: expect.objectContaining({ name: 'domain-is-pure' }),
        from: expect.stringContaining('modules/x/domain/a.ts'),
      }),
    );
  });

  it('platform, entry point, client CLI and contracts are in place', async () => {
    const files = [
      'src/main.ts',
      'src/cli/index.ts',
      'src/cli/client.ts',
      'src/cli/push.ts',
      'src/contracts/catalog.ts',
      'src/platform/http/server.ts',
      'src/platform/http/security.ts',
      'src/platform/server-commands.ts',
      'src/platform/db.ts',
    ];
    expect(files.filter((f) => !existsSync(f))).toEqual([]);
    expect(['src/app', 'src/index.ts'].filter((f) => existsSync(f))).toEqual([]);
    const cli = await violationsIn('src/cli');
    expect(cli.filter((x) => x.rule.name === 'cli-no-server')).toEqual([]);
  });

  it.each(['src/modules/llm', 'src/modules/identity'])('module %s is in place and clean', async (dir) => {
    expect(existsSync(`${dir}/index.ts`)).toBe(true);
    expect(await violationsIn(dir)).toEqual([]);
  });

  it('catalog module (libraries, versions) is in place and clean', async () => {
    expect(existsSync('src/modules/catalog/index.ts')).toBe(true);
    expect(existsSync('src/catalog')).toBe(false);
    const v = await violationsIn('src/modules/catalog');
    expect(
      v.filter((x) => ['application-only-domain', 'domain-is-pure', 'no-inward-infra'].includes(x.rule.name)),
    ).toEqual([]);
    expect(v).toEqual([]);
  });

  it('catalog module (documents, images, embeddings, diff, topology, enrichment) is in place and clean', async () => {
    const files = [
      'src/modules/catalog/domain/document.ts',
      'src/modules/catalog/domain/metadata.ts',
      'src/modules/catalog/domain/image-type.ts',
      'src/modules/catalog/application/diff.ts',
      'src/modules/catalog/application/enrichment.ts',
      'src/modules/catalog/application/topology.ts',
      'src/modules/catalog/infrastructure/pg-documents.ts',
      'src/modules/catalog/infrastructure/pg-images.ts',
      'src/modules/catalog/infrastructure/pg-document-search.ts',
      'src/modules/catalog/infrastructure/pg-topology.ts',
      'src/modules/catalog/infrastructure/file-storage.ts',
      'src/modules/catalog/infrastructure/llm-link-suggester.ts',
      'src/modules/catalog/infrastructure/version-filter.ts',
      'src/modules/catalog/infrastructure/embeddings/EmbeddingProvider.ts',
      'src/modules/catalog/interfaces/http/documents.ts',
      'src/modules/catalog/interfaces/http/images.ts',
      'src/modules/catalog/interfaces/http/diff.ts',
      'src/modules/catalog/interfaces/http/topology.ts',
    ];
    expect(files.filter((f) => !existsSync(f))).toEqual([]);
    expect(['src/content', 'src/catalog', 'src/shared/version-filter.ts'].filter((f) => existsSync(f))).toEqual([]);
    expect(await violationsIn('src/modules/catalog')).toEqual([]);
  });

  it('search module is in place and clean', async () => {
    const files = [
      'src/modules/search/index.ts',
      'src/modules/search/domain/query.ts',
      'src/modules/search/domain/grouping.ts',
      'src/modules/search/application/ports.ts',
      'src/modules/search/application/pipeline.ts',
      'src/modules/search/application/ranking.ts',
      'src/modules/search/infrastructure/catalog-index.ts',
      'src/modules/search/infrastructure/llm-term-extractor.ts',
      'src/modules/search/infrastructure/compose.ts',
    ];
    expect(files.filter((f) => !existsSync(f))).toEqual([]);
    expect(existsSync('src/discovery')).toBe(false);
    expect(await violationsIn('src/modules/search')).toEqual([]);
  });

  it('chat module is in place and clean; the legacy folders are gone', async () => {
    const files = [
      'src/modules/chat/index.ts',
      'src/modules/chat/domain/insight.ts',
      'src/modules/chat/domain/session.ts',
      'src/modules/chat/application/ports.ts',
      'src/modules/chat/application/answer.ts',
      'src/modules/chat/application/sessions.ts',
      'src/modules/chat/application/insights.ts',
      'src/modules/chat/infrastructure/schema.ts',
      'src/modules/chat/infrastructure/pg-chat.ts',
      'src/modules/chat/infrastructure/compose.ts',
      'src/modules/chat/interfaces/http/routes.ts',
      'src/modules/chat/interfaces/web/chat-html.ts',
      'src/modules/chat/interfaces/web/chat-assets.ts',
      'src/modules/chat/interfaces/web/chat-markdown.ts',
      'src/platform/mcp/tools.ts',
    ];
    expect(files.filter((f) => !existsSync(f))).toEqual([]);
    const legacy = ['src/shared', 'src/app', 'src/ai-gateway', 'src/content', 'src/catalog', 'src/discovery'];
    expect(legacy.filter((f) => existsSync(f))).toEqual([]);
    expect(await violationsIn('src/modules/chat')).toEqual([]);
  });

  it('every rule is an error', () => {
    const forbidden = (ruleSet as { forbidden?: { name: string; severity?: string }[] }).forbidden ?? [];
    expect(forbidden.map((r) => r.name).sort()).toEqual([...RULES].sort());
    expect(forbidden.filter((r) => r.severity !== 'error').map((r) => r.name)).toEqual([]);
  });

  it('accepts the real source tree', async () => {
    expect(await violationsIn('src')).toEqual([]);
  });

  it('module indexes export no tables', async () => {
    for (const m of ['catalog', 'search', 'chat', 'llm', 'identity']) {
      const mod = await import(`../../src/modules/${m}/index.ts`);
      expect(Object.entries(mod).filter(([, v]) => is(v as object, PgTable)).map(([k]) => k)).toEqual([]);
    }
  });
});
