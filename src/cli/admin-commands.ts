/** `lore namespace …` and `lore project-key …`: the admin API over HTTP (the server checks the role). */
import type { Command } from 'commander';
import type {
  AssignLibraryRequest,
  AssignLibraryResponse,
  CreateNamespaceRequest,
  CreateProjectKeyRequest,
  CreateProjectKeyResponse,
  NamespaceResponse,
  ProjectKeyResponse,
} from '../contracts/namespaces.js';
import { apiRequest } from './client.js';
import { resolveCredentials } from './credentials.js';
import { orExit } from './shared.js';

/** The server and token a command talks to. */
export interface Connection {
  url: string;
  token: string;
}

const seg = encodeURIComponent;

export function createNamespace(c: Connection, id: string, displayName: string): Promise<Omit<NamespaceResponse, 'libraries'>> {
  const body: CreateNamespaceRequest = { id, display_name: displayName };
  return apiRequest(c.url, '/api/namespaces', { method: 'POST', token: c.token, json: body });
}

export function listNamespaces(c: Connection): Promise<NamespaceResponse[]> {
  return apiRequest(c.url, '/api/namespaces', { token: c.token });
}

export function assignLibrary(c: Connection, library: string, namespace: string): Promise<AssignLibraryResponse> {
  const body: AssignLibraryRequest = { namespace_id: namespace };
  return apiRequest(c.url, `/api/libraries/${seg(library)}/namespace`, { method: 'PUT', token: c.token, json: body });
}

export function createProjectKey(c: Connection, namespace: string, name: string, library?: string): Promise<CreateProjectKeyResponse> {
  const body: CreateProjectKeyRequest = { namespace_id: namespace, name, ...(library ? { library_id: library } : {}) };
  return apiRequest(c.url, '/api/project-keys', { method: 'POST', token: c.token, json: body });
}

export function listProjectKeys(c: Connection, namespace?: string): Promise<ProjectKeyResponse[]> {
  const query = namespace ? `?namespace=${seg(namespace)}` : '';
  return apiRequest(c.url, `/api/project-keys${query}`, { token: c.token });
}

export async function revokeProjectKey(c: Connection, id: string): Promise<void> {
  await apiRequest(c.url, `/api/project-keys/${seg(id)}`, { method: 'DELETE', token: c.token });
}

const URL_OPTION = ['-u, --url <url>', 'Lore server URL (default: LORE_URL or the stored URL)'] as const;

/** Resolves the credentials and runs `fn`, exiting 1 with a message on failure. */
function withConnection<T>(opts: { url?: string }, fn: (c: Connection) => Promise<T>): Promise<T> {
  return orExit(async () => fn(resolveCredentials(opts)));
}

export function registerAdminCommands(program: Command): void {
  const ns = program.command('namespace').description('Manage namespaces (admin)');

  ns.command('create <id>')
    .description('Create a namespace')
    .requiredOption('-n, --name <name>', 'Display name')
    .option(...URL_OPTION)
    .action(async (id: string, opts: { name: string; url?: string }) => {
      const created = await withConnection(opts, (c) => createNamespace(c, id, opts.name));
      console.log(`Created namespace ${created.id} (${created.display_name})`);
    });

  ns.command('list')
    .description('List namespaces and their libraries')
    .option(...URL_OPTION)
    .action(async (opts: { url?: string }) => {
      const list = await withConnection(opts, listNamespaces);
      for (const n of list) {
        const libs = n.libraries.length > 0 ? n.libraries.join(', ') : '(no libraries)';
        console.log(`  ${n.id.padEnd(24)} ${n.display_name}${n.system ? ' [system]' : ''}: ${libs}`);
      }
    });

  ns.command('assign <library> <namespace>')
    .description('Move a library to a namespace')
    .option(...URL_OPTION)
    .action(async (library: string, namespace: string, opts: { url?: string }) => {
      await withConnection(opts, (c) => assignLibrary(c, library, namespace));
      console.log(`Library ${library} is now in namespace ${namespace}`);
    });

  const pk = program.command('project-key').description('Manage project keys for CI pushes (admin)');

  pk.command('create <namespace>')
    .description('Create a project key (lpk_…); it is shown only once')
    .requiredOption('-n, --name <name>', 'Key name (e.g. github-actions)')
    .option('--library <id>', 'Allow pushes only to this library')
    .option(...URL_OPTION)
    .action(async (namespace: string, opts: { name: string; library?: string; url?: string }) => {
      const k = await withConnection(opts, (c) => createProjectKey(c, namespace, opts.name, opts.library));
      console.log(`Created project key ${k.id} "${k.name}" for namespace ${k.namespace_id}${k.library_id ? `, library ${k.library_id}` : ''}.`);
      console.log('Store it now (for example as the CI secret LORE_TOKEN); it is not shown again:');
      console.log(k.key);
    });

  pk.command('list')
    .description('List project keys')
    .option('--namespace <id>', 'Only keys of this namespace')
    .option(...URL_OPTION)
    .action(async (opts: { namespace?: string; url?: string }) => {
      const keys = await withConnection(opts, (c) => listProjectKeys(c, opts.namespace));
      if (keys.length === 0) {
        console.log('No project keys.');
        return;
      }
      for (const k of keys) {
        const scope = k.library_id ? `${k.namespace_id}/${k.library_id}` : k.namespace_id;
        const state = k.revoked_at ? 'revoked' : `last used ${k.last_used_at ?? 'never'}`;
        console.log(`  ${k.id}  ${k.prefix}…  ${k.name.padEnd(20)} ${scope.padEnd(30)} ${state}`);
      }
    });

  pk.command('revoke <id>')
    .description('Revoke a project key')
    .option(...URL_OPTION)
    .action(async (id: string, opts: { url?: string }) => {
      await withConnection(opts, (c) => revokeProjectKey(c, id));
      console.log(`Revoked project key ${id}`);
    });
}
