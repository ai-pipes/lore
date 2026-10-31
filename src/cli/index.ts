import type { Command } from 'commander';
import { push } from './push.js';
import { registerImageCommands } from './images.js';
import { registerAuthCommands } from './auth-commands.js';
import { registerAdminCommands } from './admin-commands.js';
import { resolveCredentials } from './credentials.js';
import { orExit } from './shared.js';

/**
 * Client commands: they reach a Lore server over HTTP only and authenticate with `LORE_TOKEN`
 * (and `LORE_URL`) or the credentials file `lore login` writes.
 */
export function registerClientCommands(program: Command): void {
  registerAuthCommands(program);

  // lore push <dir>
  program
    .command('push <dir>')
    .description('Upload a directory of Markdown docs to Lore')
    .requiredOption('-l, --library <id>', 'Library slug (e.g. orders-service)')
    .requiredOption('-v, --ver <id>', 'Version id (e.g. git SHA)')
    .option('-b, --branch <name>', 'Git branch name (e.g. feature/new-payment)', process.env.GIT_BRANCH)
    .option('--namespace <id>', 'Namespace of a new library (admins; default "default")')
    .option('--no-promote', 'Upload docs without activating the version (for feature branches)')
    .option('--no-incremental', 'Force re-upload of all documents, ignoring content hashes')
    .option('--no-enrich', 'Skip LLM enrichment of document links')
    .option('-u, --url <url>', 'Lore server URL (default: LORE_URL or the stored URL)')
    .action(async (dir: string, opts: { library: string; ver: string; branch?: string; namespace?: string; promote: boolean; incremental: boolean; enrich: boolean; url?: string }) => {
      await orExit(async () => {
        const { url, token } = resolveCredentials(opts);
        await push({
          dir,
          library: opts.library,
          version: opts.ver,
          branch: opts.branch,
          namespace: opts.namespace,
          promote: opts.promote,
          incremental: opts.incremental,
          noEnrich: opts.enrich === false,
          baseUrl: url,
          token,
        });
      });
    });

  registerImageCommands(program);
  registerAdminCommands(program);
}
