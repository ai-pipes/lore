import type { Command } from 'commander';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Error: ${name} environment variable is required`);
    process.exit(1);
  }
  return value;
}

/**
 * `lore link-sso <login> <sub>` / `lore unlink-sso <login>` against the database directly: links an
 * existing user to (or unlinks it from) the provider identity `sub` of `OIDC_ISSUER`. Returns the
 * line to print, or throws with the reason.
 */
export async function ssoLinkCommand(
  action: { link: true; login: string; sub: string } | { link: false; login: string },
  env: Record<string, string | undefined> = process.env,
): Promise<string> {
  const { initDb } = await import('./db.js');
  const { createPgIdentity, linkSso, ssoConfigFromEnv, unlinkSso } = await import('../modules/identity/index.js');
  await initDb();
  const d = createPgIdentity({ sso: action.link ? ssoConfigFromEnv(env) : null });
  const r = action.link ? await linkSso(d, action.login, action.sub) : await unlinkSso(d, action.login);
  if (!r.ok) throw new Error(r.error.message);
  return action.link
    ? `Linked ${action.login} to ${action.sub} at ${env.OIDC_ISSUER}`
    : `Unlinked ${action.login} from single sign-on`;
}

async function runSsoLink(command: 'link-sso' | 'unlink-sso', action: Parameters<typeof ssoLinkCommand>[0]): Promise<void> {
  const { validateConfig } = await import('./config.js');
  validateConfig(command);
  try {
    console.log(await ssoLinkCommand(action));
  } catch (e) {
    console.error(`Error: ${(e as Error).message}`);
    process.exit(1);
  }
  process.exit(0); // close the DB pool
}

/**
 * Server commands: `serve`, `mcp`, `status`, `link-sso`, `unlink-sso`, `reindex-embeddings`. They load the server code (DB, Fastify, MCP) with
 * `await import()` inside the action, so client commands such as `lore push` never load it.
 */
export function registerServerCommands(program: Command): void {
  // lore serve
  program
    .command('serve')
    .description('Start the HTTP API and the MCP server (Streamable HTTP and SSE)')
    .action(async () => {
      const { mcpPublicUrl, validateConfig } = await import('./config.js');
      validateConfig('serve');
      const port = parseInt(requireEnv('LORE_PORT'), 10);
      const mcpPort = parseInt(requireEnv('LORE_MCP_PORT'), 10);

      const { initDb } = await import('./db.js');
      const { initEmbeddings } = await import('../modules/catalog/index.js');
      const { buildServer } = await import('./http/server.js');
      const { startMcpSse } = await import('./mcp/server.js');
      const { bootstrapAdmin, createPgIdentity, ssoConfigFromEnv } = await import('../modules/identity/index.js');

      await initDb();
      initEmbeddings();

      const app = await buildServer();
      const sso = ssoConfigFromEnv(process.env);
      app.log.info(sso ? `Sign-in: single sign-on via ${sso.issuer}` : 'Sign-in: password');
      await bootstrapAdmin(
        createPgIdentity({ adminKey: process.env.LORE_API_KEY, sso }),
        { login: process.env.LORE_ADMIN_LOGIN, password: process.env.LORE_ADMIN_PASSWORD },
        { info: (m) => app.log.info(m), warn: (m) => app.log.warn(m) },
      );
      await app.listen({ port, host: process.env.LORE_HOST || '0.0.0.0' });

      // MCP authenticates personal sk_ tokens (Tokens page) and LORE_API_KEY against the database.
      startMcpSse(mcpPort);
      app.log.info(`MCP clients connect to ${mcpPublicUrl(process.env)} with a personal token from /tokens`);

      const shutdown = async (signal: string) => {
        app.log.info(`Received ${signal}, shutting down...`);
        await app.close();
        process.exit(0);
      };

      process.on('SIGTERM', () => shutdown('SIGTERM'));
      process.on('SIGINT', () => shutdown('SIGINT'));
    });

  // lore mcp (stdio for Claude Desktop)
  program
    .command('mcp')
    .description('Start MCP server over stdio')
    .action(async () => {
      const { validateConfig } = await import('./config.js');
      validateConfig('mcp');
      const { initDb } = await import('./db.js');
      const { initEmbeddings } = await import('../modules/catalog/index.js');
      const { startMcpStdio } = await import('./mcp/server.js');
      await initDb();
      initEmbeddings();
      await startMcpStdio();
    });

  // lore status
  program
    .command('status')
    .description('Show registered libraries')
    .action(async () => {
      const { validateConfig } = await import('./config.js');
      validateConfig('status');
      const { initDb } = await import('./db.js');
      const { listLibraries } = await import('../modules/catalog/index.js');
      await initDb();

      const libs = await listLibraries();
      if (libs.length === 0) {
        console.log('No libraries registered.');
        process.exit(0);
      }

      console.log('\nLibraries:\n');
      for (const lib of libs) {
        console.log(
          `  ${lib.id.padEnd(30)} version: ${(lib.current_version ?? '(none)').padEnd(45)} docs: ${lib.document_count}`,
        );
      }
      console.log();
      process.exit(0); // close the DB pool
    });

  // lore link-sso <login> <sub>
  program
    .command('link-sso <login> <sub>')
    .description('Link an existing user to a single sign-on identity (the provider\'s "sub"); needs the OIDC settings')
    .action(async (login: string, sub: string) => runSsoLink('link-sso', { link: true, login, sub }));

  // lore unlink-sso <login>
  program
    .command('unlink-sso <login>')
    .description('Remove the single sign-on link of a user')
    .action(async (login: string) => runSsoLink('unlink-sso', { link: false, login }));

  // lore reindex-embeddings [--all]
  program
    .command('reindex-embeddings')
    .description('Recompute document vectors with the configured embedding model')
    .option('--all', 're-embed every document, not only missing or stale ones')
    .action(async (opts: { all?: boolean }) => {
      const { validateConfig } = await import('./config.js');
      validateConfig('reindex-embeddings');
      const { initDb } = await import('./db.js');
      const { createPgCatalog, initEmbeddings, reindexEmbeddings } = await import('../modules/catalog/index.js');
      await initDb();
      initEmbeddings();
      const { createLanguageModel } = await import('../modules/llm/index.js');
      const deps = createPgCatalog({ llm: createLanguageModel() });
      const modelId = deps.embedder.modelId();
      if (!deps.embedder.available() || modelId === null) {
        console.error('No embedding provider is configured (LORE_EMBEDDING_PROVIDER)');
        process.exit(1);
      }
      const total = await deps.vectors.countStale(modelId, { all: !!opts.all });
      console.log(`Reindexing ${total} documents with ${modelId}`);
      let done = 0;
      try {
        const r = await reindexEmbeddings(deps, {
          all: opts.all,
          onProgress: (n, of) => {
            done = n;
            console.log(`${n}/${of}`);
          },
        });
        if (!r.ok) {
          console.error('No embedding provider is configured (LORE_EMBEDDING_PROVIDER)');
          process.exit(1);
        }
        console.log(`Done: ${r.value.done} documents`);
      } catch (e) {
        console.error(`Failed after ${done}/${total}: ${(e as Error).message}`);
        process.exit(1);
      }
      process.exit(0); // close the DB pool
    });
}
