import type { VersionResponse } from '../contracts/catalog.js';
import { ApiError, apiRequest } from './client.js';
import { NotLoggedInError } from './credentials.js';

/** A failure the CLI reports as `Error: <message>` (exit 1) rather than as a stack trace. */
export class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliError';
  }
}

/** The current version of `library`, unless `version` is given. Exits on failure. */
export async function resolveVersion(baseUrl: string, library: string, token: string, version?: string): Promise<string> {
  if (version) return version;
  let versions: Array<Pick<VersionResponse, 'id' | 'is_current'>>;
  try {
    versions = await apiRequest(baseUrl, `/api/libraries/${library}/versions`, { token });
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    console.error(`Failed to fetch versions for ${library}: ${e.status}`);
    process.exit(1);
  }
  const current = versions.find((v) => v.is_current === true);
  if (!current) {
    console.error(`No current version found for library "${library}". Pass --ver explicitly.`);
    process.exit(1);
  }
  return current.id;
}

/**
 * Runs `fn`; on an `ApiError` prints `Error: <status> <body>`, on a `NotLoggedInError` or a
 * `CliError` prints `Error: <message>`, and exits 1.
 */
export async function orExit<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ApiError) console.error(`Error: ${e.status} ${e.body}`);
    else if (e instanceof NotLoggedInError || e instanceof CliError) console.error(`Error: ${e.message}`);
    else throw e;
    process.exit(1);
  }
}
