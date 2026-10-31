import { DEFAULT_URL, normalizeUrl, resolveCredentials } from '../src/cli/credentials.js';

/**
 * The server and token of `npm run demo`. The server is `LORE_URL`, else `DEFAULT_URL` — never the
 * one in the credentials file, so the local `LORE_API_KEY` from `.env` cannot reach another server.
 * The token is `LORE_TOKEN`, else `LORE_API_KEY`, else the file's when the file is for that server.
 */
export function demoCredentials(env: NodeJS.ProcessEnv, home?: string): { url: string; token: string } {
  const url = normalizeUrl(env.LORE_URL || DEFAULT_URL);
  const { token } = resolveCredentials({ url }, { ...env, LORE_TOKEN: env.LORE_TOKEN || env.LORE_API_KEY }, home);
  return { url, token };
}
