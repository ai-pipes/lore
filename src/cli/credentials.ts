/**
 * The CLI's credentials: `LORE_TOKEN`/`LORE_URL` from the environment, else the credentials file
 * `~/.config/lore/credentials.json` (mode 600, directory 700) that `lore login` writes. The file's
 * token is sent only to the server it was issued for.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';

export const DEFAULT_URL = 'http://localhost:4737';

export interface StoredCredentials {
  url: string;
  token: string;
}

/** No token for the server the command talks to. */
export class NotLoggedInError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotLoggedInError';
  }
}

/** `<home>/.config/lore/credentials.json`. */
export function credentialsPath(home: string = homedir()): string {
  return join(home, '.config', 'lore', 'credentials.json');
}

/** A server URL without trailing slashes. */
export function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/** The stored credentials, or null when there is no (valid) file. */
export function readCredentials(home?: string): StoredCredentials | null {
  const path = credentialsPath(home);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<StoredCredentials> | null;
    if (typeof parsed?.url !== 'string' || typeof parsed.token !== 'string' || !parsed.url || !parsed.token) return null;
    return { url: normalizeUrl(parsed.url), token: parsed.token };
  } catch {
    return null;
  }
}

/** Writes the file with mode 600 (directory 700), also when a file with looser mode already exists. */
export function writeCredentials(c: StoredCredentials, home?: string): void {
  const path = credentialsPath(home);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  chmodSync(dirname(path), 0o700);
  // Tighten an existing file before the token goes in: `mode` applies only to a new file.
  if (existsSync(path)) chmodSync(path, 0o600);
  writeFileSync(path, `${JSON.stringify({ url: normalizeUrl(c.url), token: c.token }, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

export function deleteCredentials(home?: string): void {
  rmSync(credentialsPath(home), { force: true });
}

/**
 * The server and token a command uses. The URL is `--url`, else `LORE_URL`, else the file's, else
 * `DEFAULT_URL`. The token is `LORE_TOKEN`, else the file's when the file is for that same URL.
 * Throws `NotLoggedInError` when there is no token.
 */
export function resolveCredentials(
  o: { url?: string },
  env: NodeJS.ProcessEnv = process.env,
  home?: string,
): { url: string; token: string; source: 'env' | 'file' } {
  const file = readCredentials(home);
  const url = normalizeUrl(o.url || env.LORE_URL || file?.url || DEFAULT_URL);
  if (env.LORE_TOKEN) return { url, token: env.LORE_TOKEN, source: 'env' };
  if (file && file.url === url) return { url, token: file.token, source: 'file' };
  throw new NotLoggedInError(`not logged in to ${url}: run lore login --url ${url}`);
}
