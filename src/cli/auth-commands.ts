/** `lore login`, `lore logout`, `lore whoami`: the CLI's sign-in over the device-login routes. */
import { spawn } from 'child_process';
import { hostname as osHostname } from 'os';
import type { Command } from 'commander';
import type { MeResponse } from '../contracts/auth.js';
import type { PollDeviceLoginResponse, StartDeviceLoginRequest, StartDeviceLoginResponse } from '../contracts/cli-login.js';
import { ApiError, apiRequest } from './client.js';
import {
  DEFAULT_URL,
  deleteCredentials,
  normalizeUrl,
  readCredentials,
  resolveCredentials,
  writeCredentials,
  type StoredCredentials,
} from './credentials.js';
import { CliError, orExit } from './shared.js';

export interface DeviceLoginIo {
  print(s: string): void;
  /** Opens the verification URL in a browser (best effort). */
  open(u: string): Promise<void>;
  sleep(ms: number): Promise<void>;
}

/** This machine's name as the server accepts it: 1-64 characters of `[A-Za-z0-9._-]`. */
export function cliHostname(raw: string = osHostname()): string {
  const name = raw.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 64);
  return name === '' ? 'cli' : name;
}

/**
 * The device-code flow: starts a sign-in request, prints the user code and opens the verification
 * URL, then polls until the request is approved (returns the new `sk_` token), denied or expired
 * (throws).
 */
export async function deviceLogin(url: string, hostname: string, io: DeviceLoginIo): Promise<StoredCredentials> {
  const base = normalizeUrl(url);
  const start: StartDeviceLoginRequest = { hostname };
  const s = await apiRequest<StartDeviceLoginResponse>(base, '/api/cli/login/start', { method: 'POST', json: start });
  const fromServer = sameOriginHttpUrl(base, s.verification_url);
  const verificationUrl = fromServer ?? `${base}/cli/login`;
  io.print(`To sign in the CLI on ${hostname}, open ${verificationUrl}`);
  io.print(`and type the code ${s.user_code}.`);
  // Only a URL on the server we sign in to is opened; anything else is not even printed.
  if (fromServer) await io.open(fromServer).catch(() => {});
  const deadline = Date.now() + s.expires_in * 1000;
  for (;;) {
    await io.sleep(s.interval * 1000);
    const p = await apiRequest<PollDeviceLoginResponse>(base, '/api/cli/login/poll', {
      method: 'POST',
      json: { device_code: s.device_code },
    });
    if (p.status === 'approved') return { url: base, token: p.token };
    if (p.status === 'denied') throw new CliError('the sign-in request was denied');
    if (p.status === 'expired' || Date.now() > deadline) throw new CliError('the sign-in request expired; run lore login again');
  }
}

/**
 * The server's `verification_url` when it is an http(s) URL on the same origin as `base`, else
 * null. A server never makes the CLI open a `file:` URL, a custom scheme or another site.
 */
function sameOriginHttpUrl(base: string, fromServer: string): string | null {
  try {
    const u = new URL(fromServer);
    if ((u.protocol === 'http:' || u.protocol === 'https:') && u.origin === new URL(base).origin) return u.href;
  } catch {
    // not a URL
  }
  return null;
}

/** `GET /api/auth/me` with `token`: throws `ApiError` (401) for a token the server does not accept. */
export function fetchMe(url: string, token: string): Promise<MeResponse> {
  return apiRequest<MeResponse>(url, '/api/auth/me', { token });
}

/**
 * `lore login`: with `token`, checks it and stores it; otherwise runs the device-code flow. The URL
 * is `o.url`, else `LORE_URL`, else the stored one, else `DEFAULT_URL`.
 */
export async function login(
  o: { url?: string; token?: string },
  io: DeviceLoginIo,
  env: NodeJS.ProcessEnv = process.env,
  home?: string,
): Promise<StoredCredentials> {
  const url = normalizeUrl(o.url || env.LORE_URL || readCredentials(home)?.url || DEFAULT_URL);
  const creds = o.token ? { url, token: o.token } : await deviceLogin(url, cliHostname(), io);
  const me = await fetchMe(creds.url, creds.token);
  writeCredentials(creds, home);
  io.print(`Logged in: ${describeMe(me, creds.url)}`);
  return creds;
}

/**
 * `lore logout`: revokes a stored `sk_` token on the server (`DELETE /api/tokens/current`) and
 * deletes the credentials file. A server error only prints a warning: the file is deleted anyway.
 */
export async function logout(print: (s: string) => void, home?: string): Promise<void> {
  const creds = readCredentials(home);
  if (!creds) {
    deleteCredentials(home);
    print('Not logged in.');
    return;
  }
  if (creds.token.startsWith('sk_')) {
    try {
      await apiRequest(creds.url, '/api/tokens/current', { method: 'DELETE', token: creds.token });
    } catch (e) {
      const why = e instanceof ApiError ? `${e.status} ${e.body}` : e instanceof Error ? e.message : String(e);
      print(`Warning: could not revoke the token on ${creds.url} (${why}); revoke it on the Tokens page.`);
    }
  }
  deleteCredentials(home);
  print(`Logged out of ${creds.url}.`);
}

/** One line: `alice (admin) at <url>`, `project key "ci" for namespace pay at <url>` or `admin key at <url>`. */
export function describeMe(me: MeResponse, url: string): string {
  if (me.kind === 'user') return `${me.login} (${me.role}) at ${url}`;
  if (me.kind === 'project') return `project key "${me.key_name}" for namespace ${me.namespace} at ${url}`;
  return `admin key at ${url}`;
}

/** `lore whoami`: who the resolved credentials sign in as. */
export async function whoami(o: { url?: string }, env: NodeJS.ProcessEnv = process.env, home?: string): Promise<string> {
  const { url, token } = resolveCredentials(o, env, home);
  return describeMe(await fetchMe(url, token), url);
}

/**
 * The command that opens `u` in the default browser. On Windows it is `rundll32`, not `cmd /c start`:
 * cmd.exe would treat `&`, `|` and `^` in the URL as command operators.
 */
export function browserCommand(u: string, platform: NodeJS.Platform = process.platform): [string, string[]] {
  if (platform === 'darwin') return ['open', [u]];
  if (platform === 'win32') return ['rundll32', ['url.dll,FileProtocolHandler', u]];
  return ['xdg-open', [u]];
}

/** Opens `u` in the default browser; failures are ignored (the URL is printed anyway). */
function openBrowser(u: string): Promise<void> {
  const [cmd, args] = browserCommand(u);
  return new Promise((resolve) => {
    try {
      const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
      child.on('error', () => resolve());
      child.unref();
      resolve();
    } catch {
      resolve();
    }
  });
}

const terminalIo: DeviceLoginIo = {
  print: (s) => console.log(s),
  open: openBrowser,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

export function registerAuthCommands(program: Command): void {
  program
    .command('login')
    .description('Sign the CLI in to a Lore server (opens the browser; or store a token with --token)')
    .option('-u, --url <url>', `Lore server URL (default: LORE_URL, the stored URL or ${DEFAULT_URL})`)
    .option('--token <token>', 'Store this token (sk_… or lpk_…) instead of signing in in the browser')
    .action(async (opts: { url?: string; token?: string }) => {
      await orExit(() => login(opts, terminalIo));
    });

  program
    .command('logout')
    .description('Revoke the stored token and delete the credentials file')
    .action(async () => {
      await logout((s) => console.log(s));
    });

  program
    .command('whoami')
    .description('Show who the CLI is signed in as')
    .option('-u, --url <url>', 'Lore server URL')
    .action(async (opts: { url?: string }) => {
      console.log(await orExit(() => whoami(opts)));
    });
}
