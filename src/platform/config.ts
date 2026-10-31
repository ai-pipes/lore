/**
 * Startup configuration validation. All environment variables are documented
 * in .env.example and the README "Configuration" table.
 *
 * Call validateConfig() before starting any server command to surface
 * missing or invalid environment variables with a clear error message.
 */

import { isIP } from 'net';
import { DEFAULT_CLI_TOKEN_TTL_DAYS, DEFAULT_SSO_SESSION_MAX_HOURS, MAX_SSO_SESSION_MAX_HOURS, MAX_CLI_TOKEN_TTL_DAYS, checkPassword, normalizeLogin, normalizeScopes, OIDC_REQUIRED } from '../modules/identity/index.js';

type Command = 'serve' | 'mcp' | 'status' | 'link-sso' | 'unlink-sso' | 'reindex-embeddings';
type Env = Record<string, string | undefined>;

const REQUIRED_BY_COMMAND: Record<Command, string[]> = {
  serve: ['DATABASE_URL', 'LORE_API_KEY', 'LORE_PORT', 'LORE_MCP_PORT'],
  mcp: ['DATABASE_URL'],
  status: ['DATABASE_URL'],
  // link-sso stores the provider's issuer with the subject, so it needs the OIDC settings
  'link-sso': ['DATABASE_URL', ...OIDC_REQUIRED],
  'unlink-sso': ['DATABASE_URL'],
  'reindex-embeddings': ['DATABASE_URL'],
};

/** Keys shorter than this are rejected in production. `openssl rand -hex 32` gives 64 chars. */
export const MIN_API_KEY_LENGTH = 24;
const WEAK_KEYS = new Set(['changeme', 'change-me', 'password', 'secret', 'admin', 'lore', 'test', 'apikey', 'api-key']);

/** Returns why a key is weak, or null if it looks strong enough. */
export function apiKeyWeakness(key: string): string | null {
  if (WEAK_KEYS.has(key.toLowerCase())) return 'is a well-known default';
  if (key.length < MIN_API_KEY_LENGTH) return `is shorter than ${MIN_API_KEY_LENGTH} characters`;
  if (new Set(key).size < 8) return 'has too few distinct characters';
  return null;
}

export interface ConfigReport {
  errors: string[];
  warnings: string[];
}

/** Pure validation (no exit) so it can be tested. */
export function checkConfig(command: Command, env: Env = process.env): ConfigReport {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const name of REQUIRED_BY_COMMAND[command]) {
    if (!env[name]) errors.push(name);
  }

  const provider = (env.LORE_EMBEDDING_PROVIDER ?? '').toLowerCase();
  if (provider === 'openai') {
    errors.push('LORE_EMBEDDING_PROVIDER=openai was removed; use openai-compatible with LORE_EMBEDDING_MODEL');
  } else if (provider === 'openai-compatible') {
    if (!env.LORE_EMBEDDING_MODEL) {
      errors.push('LORE_EMBEDDING_MODEL (required when LORE_EMBEDDING_PROVIDER=openai-compatible)');
    }
    // The default endpoint is OpenRouter, which answers every keyless request with 401
    const hasKey = env.LORE_EMBEDDING_API_KEY || env.LLM_API_KEY;
    const hasBaseUrl = env.LORE_EMBEDDING_BASE_URL || env.LLM_BASE_URL;
    if (!hasKey && !hasBaseUrl) {
      warnings.push(
        'LORE_EMBEDDING_PROVIDER=openai-compatible has no key: set LORE_EMBEDDING_API_KEY or LLM_API_KEY, or LORE_EMBEDDING_BASE_URL for a local server',
      );
    }
  } else if (!['', 'ollama', 'hash', 'none'].includes(provider)) {
    errors.push('LORE_EMBEDDING_PROVIDER (must be openai-compatible, ollama, hash or none)');
  }

  if (env.LORE_PORT && Number.isNaN(parseInt(env.LORE_PORT, 10))) {
    errors.push('LORE_PORT (must be a valid integer)');
  }
  if (env.LORE_MCP_PORT && Number.isNaN(parseInt(env.LORE_MCP_PORT, 10))) {
    errors.push('LORE_MCP_PORT (must be a valid integer)');
  }

  if (command === 'serve' && env.LORE_DEVICE_COOKIE_SECRET && env.LORE_DEVICE_COOKIE_SECRET.length < 32) {
    errors.push('LORE_DEVICE_COOKIE_SECRET (at least 32 characters; generate one with: openssl rand -hex 32)');
  }
  if (command === 'serve') {
    for (const parse of [trustProxyFromEnv, cliTokenTtlDaysFromEnv, ssoSessionMaxHoursFromEnv]) {
      try {
        parse(env);
      } catch (e) {
        errors.push((e as Error).message);
      }
    }
  }

  // The commands that answer with the LLM: the server and the MCP server
  if (command === 'serve' || command === 'mcp') {
    if ((env.LLM_API_KEY || env.LLM_BASE_URL) && !env.LLM_MODEL) {
      errors.push('LLM_MODEL (required when LLM_API_KEY or LLM_BASE_URL is set)');
    }
  }
  // The commands that call the LLM or the embedding provider
  if ((command === 'serve' || command === 'mcp' || command === 'reindex-embeddings') && env.OPENAI_API_KEY) {
    warnings.push('OPENAI_API_KEY is no longer used; set LLM_API_KEY (and LORE_EMBEDDING_API_KEY for embeddings)');
  }

  const sso = command === 'serve' || command === 'link-sso' ? checkSso(env, errors) : false;

  if (command === 'serve' && sso && (env.LORE_ADMIN_LOGIN || env.LORE_ADMIN_PASSWORD)) {
    warnings.push('LORE_ADMIN_LOGIN/LORE_ADMIN_PASSWORD are ignored in SSO mode');
  }
  if (command === 'serve') {
    if (env.LORE_READ_KEY) warnings.push('LORE_READ_KEY is no longer used; users sign in at /login');
    if (env.LORE_MCP_API_KEY) {
      warnings.push('LORE_MCP_API_KEY is no longer used; MCP clients use personal sk_ tokens from the Tokens page');
    }
  }
  if (command === 'serve' && !sso) {
    // The first admin of a password install: both variables or neither
    const adminLogin = env.LORE_ADMIN_LOGIN;
    const adminPassword = env.LORE_ADMIN_PASSWORD;
    if (adminLogin && !adminPassword) errors.push('LORE_ADMIN_PASSWORD');
    if (adminPassword && !adminLogin) errors.push('LORE_ADMIN_LOGIN');
    if (adminLogin && normalizeLogin(adminLogin) === null) {
      errors.push('LORE_ADMIN_LOGIN (1-128 characters of a-z, 0-9, ".", "_" or "-", starting with a letter or digit)');
    }
    if (adminPassword && checkPassword(adminPassword)) {
      errors.push(`LORE_ADMIN_PASSWORD (must be ${adminPassword.length < 12 ? 'at least 12' : 'at most 1024'} characters)`);
    }
  }

  // Weak credentials: fatal in production, a warning in development
  if (command === 'serve') {
    const production = env.NODE_ENV === 'production';
    for (const name of ['LORE_API_KEY']) {
      const value = env[name];
      if (!value) continue;
      const weakness = apiKeyWeakness(value);
      if (!weakness) continue;
      const msg = `${name} ${weakness} (generate one with: openssl rand -hex 32)`;
      if (production) errors.push(msg);
      else warnings.push(msg);
    }
  }

  return { errors, warnings };
}

/** Fastify's `trustProxy`: false, or the addresses (IPs, CIDRs) of trusted proxies. */
export type TrustProxy = false | string[];

const isIpOrCidr = (v: string): boolean => {
  const [addr, bits, ...rest] = v.split('/');
  const family = isIP(addr);
  if (family === 0 || rest.length > 0) return false;
  if (bits === undefined) return true;
  const n = Number(bits);
  return /^\d+$/.test(bits) && n <= (family === 4 ? 32 : 128);
};

/**
 * `LORE_TRUST_PROXY`: whom to believe about the client address (`X-Forwarded-For`) and scheme
 * (`X-Forwarded-Proto`). Unset, empty or `false`: nobody, the TCP peer is the client. Otherwise a
 * comma-separated list of proxy IPs or CIDRs. Throws on anything else: `true` would let any client
 * pick its address, and Fastify trusts nobody for a hop count (it cannot check the peer), which
 * would silently put every client behind the proxy's address.
 */
export function trustProxyFromEnv(env: Env): TrustProxy {
  const raw = (env.LORE_TRUST_PROXY ?? '').trim();
  if (raw === '' || raw === 'false') return false;
  if (/^\d+$/.test(raw) && Number(raw) >= 1) {
    throw new Error('LORE_TRUST_PROXY (hop counts are not supported; list the proxy IPs/CIDRs, e.g. 172.16.0.0/12)');
  }
  const list = raw.split(',').map((x) => x.trim());
  if (list.every(isIpOrCidr)) return list;
  throw new Error('LORE_TRUST_PROXY (false, or comma-separated proxy IPs/CIDRs)');
}

/** `LORE_CLI_TOKEN_TTL_DAYS`: days a `lore login` token lives (default 90, 1..3650). Throws on anything else. */
export function cliTokenTtlDaysFromEnv(env: Env): number {
  const raw = (env.LORE_CLI_TOKEN_TTL_DAYS ?? '').trim();
  if (raw === '') return DEFAULT_CLI_TOKEN_TTL_DAYS;
  const days = Number(raw);
  if (/^\d+$/.test(raw) && days >= 1 && days <= MAX_CLI_TOKEN_TTL_DAYS) return days;
  throw new Error(`LORE_CLI_TOKEN_TTL_DAYS (a whole number of days, 1-${MAX_CLI_TOKEN_TTL_DAYS})`);
}

/** `LORE_SSO_SESSION_MAX_HOURS`: absolute lifetime in hours of an SSO web session (default 24, 1..720). Throws on anything else. */
export function ssoSessionMaxHoursFromEnv(env: Env): number {
  const raw = (env.LORE_SSO_SESSION_MAX_HOURS ?? '').trim();
  if (raw === '') return DEFAULT_SSO_SESSION_MAX_HOURS;
  const hours = Number(raw);
  if (/^\d+$/.test(raw) && hours >= 1 && hours <= MAX_SSO_SESSION_MAX_HOURS) return hours;
  throw new Error(`LORE_SSO_SESSION_MAX_HOURS (a whole number of hours, 1-${MAX_SSO_SESSION_MAX_HOURS})`);
}

/** `PUBLIC_URL` (where people open Lore) without trailing slashes; undefined when unset or empty. */
export function publicUrl(env: Env): string | undefined {
  return env.PUBLIC_URL ? env.PUBLIC_URL.replace(/\/+$/, '') : undefined;
}

/** The MCP endpoint as clients reach it: `LORE_MCP_PUBLIC_URL`, else `http://localhost:<LORE_MCP_PORT ?? 4738>/mcp`. */
export function mcpPublicUrl(env: Env): string {
  return env.LORE_MCP_PUBLIC_URL || `http://localhost:${env.LORE_MCP_PORT || 4738}/mcp`;
}

const isUrl = (v: string, protocols: string[]): boolean => {
  try {
    return protocols.includes(new URL(v).protocol);
  } catch {
    return false;
  }
};

/**
 * Single sign-on settings: all of OIDC_ISSUER, OIDC_CLIENT_ID and OIDC_CLIENT_SECRET or none (a
 * partial set is a mistake, not "SSO off"); SSO mode needs PUBLIC_URL (the redirect URI is derived
 * from it) and an https issuer unless OIDC_ALLOW_INSECURE=true. True when SSO is on.
 */
function checkSso(env: Env, errors: string[]): boolean {
  const missing = OIDC_REQUIRED.filter((k) => !env[k]);
  if (missing.length === OIDC_REQUIRED.length) return false;
  if (missing.length > 0) {
    errors.push(`${missing.join(', ')} (required when any of ${OIDC_REQUIRED.join(', ')} is set)`);
    return false;
  }
  // Empty means unset: docker compose forwards optional variables as ${VAR:-}
  const allowInsecure = env.OIDC_ALLOW_INSECURE || undefined;
  if (allowInsecure !== undefined && allowInsecure !== 'true' && allowInsecure !== 'false') {
    errors.push('OIDC_ALLOW_INSECURE (must be true or false)');
  }
  const issuer = env.OIDC_ISSUER!;
  if (!isUrl(issuer, ['https:', 'http:'])) {
    errors.push('OIDC_ISSUER (must be an https: URL)');
  } else if (new URL(issuer).protocol === 'http:' && allowInsecure !== 'true') {
    errors.push('OIDC_ISSUER (must be an https: URL; set OIDC_ALLOW_INSECURE=true to allow http:)');
  }
  if (!env.PUBLIC_URL) {
    errors.push('PUBLIC_URL (required in SSO mode: the redirect URI is ${PUBLIC_URL}/api/auth/sso/callback)');
  } else if (!isUrl(env.PUBLIC_URL, ['https:', 'http:'])) {
    errors.push('PUBLIC_URL (must be an http: or https: URL)');
  }
  if (env.OIDC_SCOPES && !normalizeScopes(env.OIDC_SCOPES).split(' ').includes('openid')) {
    errors.push('OIDC_SCOPES (must include openid)');
  }
  return true;
}

export function validateConfig(command: Command): void {
  const { errors, warnings } = checkConfig(command);
  for (const w of warnings) console.warn(`WARNING: ${w}`);
  if (errors.length > 0) {
    console.error(
      `Configuration error — missing or invalid environment variables:\n` +
        errors.map((m) => `  • ${m}`).join('\n'),
    );
    process.exit(1);
  }
}
