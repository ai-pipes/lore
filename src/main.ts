import 'dotenv/config';
import { Command } from 'commander';
import { registerClientCommands } from './cli/index.js';
import { registerServerCommands } from './platform/server-commands.js';

const program = new Command();

program
  .name('lore')
  .description('Local AI documentation storage and retrieval service')
  .version('1.0.0');

// `lore --help` lists the client commands (login, logout, whoami, push, images, namespace,
// project-key), then the server commands (serve, mcp, status, link-sso, unlink-sso).
registerClientCommands(program);
registerServerCommands(program);

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
