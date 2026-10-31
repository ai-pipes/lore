import 'dotenv/config';
import { Command } from 'commander';
import { registerClientCommands } from './cli/index.js';
import { registerServerCommands } from './platform/server-commands.js';
import { LORE_VERSION } from './platform/version.js';

const program = new Command();

program
  .name('lore')
  .description('Living documentation for your services: push docs from CI, search and chat with citations, MCP')
  .version(LORE_VERSION);

// `lore --help` lists the client commands (login, logout, whoami, push, images, namespace,
// project-key), then the server commands (serve, mcp, status, link-sso, unlink-sso).
registerClientCommands(program);
registerServerCommands(program);

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
