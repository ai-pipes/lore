import { describe, it, expect } from 'vitest';
import { checkConfig, apiKeyWeakness, mcpPublicUrl, publicUrl, trustProxyFromEnv, cliTokenTtlDaysFromEnv, ssoSessionMaxHoursFromEnv } from '../../platform/config.js';
import { ssoConfigFromEnv } from '../../modules/identity/index.js';

const STRONG = 'q8V3nZ1xT0bLr7Kc5mWp2YhD9sGfJ4eA';
const base = { DATABASE_URL: 'postgres://x', LORE_PORT: '4737', LORE_MCP_PORT: '4738' };

describe('API key strength', () => {
  it.each(['changeme', 'CHANGEME', 'password', 'short-key', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'])('%s is weak', (k) => {
    expect(apiKeyWeakness(k)).not.toBeNull();
  });
  it('random base64 keys are accepted', () => {
    expect(apiKeyWeakness(STRONG)).toBeNull();
  });
});

describe('checkConfig serve', () => {
  it('rejects a weak LORE_API_KEY in production', () => {
    const r = checkConfig('serve', { ...base, NODE_ENV: 'production', LORE_API_KEY: 'changeme' });
    expect(r.errors.join()).toMatch(/LORE_API_KEY is a well-known default/);
  });

  it('warns that LORE_MCP_API_KEY is no longer used (MCP takes personal sk_ tokens)', () => {
    const r = checkConfig('serve', { ...base, NODE_ENV: 'production', LORE_API_KEY: STRONG, LORE_MCP_API_KEY: 'abc' });
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual(['LORE_MCP_API_KEY is no longer used; MCP clients use personal sk_ tokens from the Tokens page']);
  });

  it('only warns about weak keys outside production', () => {
    const r = checkConfig('serve', { ...base, LORE_API_KEY: 'changeme' });
    expect(r.errors).toEqual([]);
    expect(r.warnings.join()).toMatch(/LORE_API_KEY/);
  });

  it('accepts a strong key in production', () => {
    expect(checkConfig('serve', { ...base, NODE_ENV: 'production', LORE_API_KEY: STRONG })).toEqual({ errors: [], warnings: [] });
  });

  it('reports a missing key and an unknown embedding provider', () => {
    const r = checkConfig('serve', { ...base, LORE_EMBEDDING_PROVIDER: 'magic' });
    expect(r.errors).toContain('LORE_API_KEY');
    expect(r.errors).toContain('LORE_EMBEDDING_PROVIDER (must be openai-compatible, ollama, hash or none)');
  });

  it('rejects the removed openai embedding provider', () => {
    const r = checkConfig('serve', { ...base, LORE_API_KEY: STRONG, LORE_EMBEDDING_PROVIDER: 'openai' });
    expect(r.errors).toContain('LORE_EMBEDDING_PROVIDER=openai was removed; use openai-compatible with LORE_EMBEDDING_MODEL');
  });

  it('requires LORE_EMBEDDING_MODEL for openai-compatible embeddings', () => {
    const env = { ...base, LORE_API_KEY: STRONG, LORE_EMBEDDING_PROVIDER: 'openai-compatible' };
    expect(checkConfig('serve', env).errors).toContain(
      'LORE_EMBEDDING_MODEL (required when LORE_EMBEDDING_PROVIDER=openai-compatible)',
    );
    expect(checkConfig('serve', { ...env, LORE_EMBEDDING_MODEL: 'm', LORE_EMBEDDING_API_KEY: 'k' })).toEqual({ errors: [], warnings: [] });
  });

  it('warns when openai-compatible embeddings have neither a key nor a base URL', () => {
    const NO_KEY =
      'LORE_EMBEDDING_PROVIDER=openai-compatible has no key: set LORE_EMBEDDING_API_KEY or LLM_API_KEY, or LORE_EMBEDDING_BASE_URL for a local server';
    const env = { ...base, LORE_API_KEY: STRONG, LORE_EMBEDDING_PROVIDER: 'openai-compatible', LORE_EMBEDDING_MODEL: 'm' };
    expect(checkConfig('serve', env).warnings).toEqual([NO_KEY]);
    expect(checkConfig('reindex-embeddings', { DATABASE_URL: 'postgres://x', LORE_EMBEDDING_PROVIDER: 'openai-compatible', LORE_EMBEDDING_MODEL: 'm' }).warnings).toEqual([NO_KEY]);
    for (const extra of [
      { LORE_EMBEDDING_API_KEY: 'k' },
      { LLM_API_KEY: 'k', LLM_MODEL: 'x' },
      { LORE_EMBEDDING_BASE_URL: 'http://localhost:11434/v1' },
      { LLM_BASE_URL: 'http://localhost:11434/v1', LLM_MODEL: 'x' },
    ]) {
      expect(checkConfig('serve', { ...env, ...extra })).toEqual({ errors: [], warnings: [] });
    }
  });
});

describe('checkConfig: the LLM', () => {
  const MISSING_MODEL = 'LLM_MODEL (required when LLM_API_KEY or LLM_BASE_URL is set)';
  const OPENAI_KEY_WARNING = 'OPENAI_API_KEY is no longer used; set LLM_API_KEY (and LORE_EMBEDDING_API_KEY for embeddings)';
  const envs = {
    serve: { ...base, LORE_API_KEY: STRONG },
    mcp: { DATABASE_URL: 'postgres://x' },
    'reindex-embeddings': { DATABASE_URL: 'postgres://x' },
  };

  it.each(['serve', 'mcp'] as const)('%s: requires LLM_MODEL once LLM_API_KEY or LLM_BASE_URL is set', (command) => {
    const env = envs[command];
    expect(checkConfig(command, { ...env, LLM_API_KEY: 'k' }).errors).toEqual([MISSING_MODEL]);
    expect(checkConfig(command, { ...env, LLM_BASE_URL: 'http://localhost:11434/v1' }).errors).toEqual([MISSING_MODEL]);
    expect(checkConfig(command, { ...env, LLM_API_KEY: 'k', LLM_MODEL: 'openai/gpt-4o-mini' }).errors).toEqual([]);
    expect(checkConfig(command, { ...env, LLM_BASE_URL: 'http://localhost:11434/v1', LLM_MODEL: 'llama3' }).errors).toEqual([]);
    expect(checkConfig(command, env)).toEqual({ errors: [], warnings: [] });
  });

  it.each(['serve', 'mcp', 'reindex-embeddings'] as const)('%s: warns that OPENAI_API_KEY is no longer used', (command) => {
    const r = checkConfig(command, { ...envs[command], OPENAI_API_KEY: 'sk-old' });
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([OPENAI_KEY_WARNING]);
  });
});

describe('checkConfig serve: first admin and removed settings', () => {
  const serve = { ...base, LORE_API_KEY: STRONG };

  it('needs LORE_ADMIN_LOGIN and LORE_ADMIN_PASSWORD together', () => {
    expect(checkConfig('serve', { ...serve, LORE_ADMIN_LOGIN: 'a' }).errors).toContain('LORE_ADMIN_PASSWORD');
    expect(checkConfig('serve', { ...serve, LORE_ADMIN_PASSWORD: 'admin-password-1' }).errors).toContain('LORE_ADMIN_LOGIN');
    expect(checkConfig('serve', { ...serve, LORE_ADMIN_LOGIN: 'root', LORE_ADMIN_PASSWORD: 'admin-password-1' })).toEqual({ errors: [], warnings: [] });
  });

  it('rejects an admin password shorter than 12 characters and an invalid login', () => {
    const short = checkConfig('serve', { ...serve, LORE_ADMIN_LOGIN: 'root', LORE_ADMIN_PASSWORD: 'x'.repeat(11) });
    expect(short.errors.join()).toMatch(/LORE_ADMIN_PASSWORD \(must be at least 12 characters\)/);
    const bad = checkConfig('serve', { ...serve, LORE_ADMIN_LOGIN: 'a b', LORE_ADMIN_PASSWORD: 'admin-password-1' });
    expect(bad.errors.join()).toMatch(/LORE_ADMIN_LOGIN \(/);
  });

  it('warns that LORE_READ_KEY is no longer used', () => {
    const r = checkConfig('serve', { ...serve, LORE_READ_KEY: 'whatever' });
    expect(r.errors).toEqual([]);
    expect(r.warnings).toContain('LORE_READ_KEY is no longer used; users sign in at /login');
  });
});

describe('checkConfig serve: single sign-on', () => {
  const serve = { ...base, LORE_API_KEY: STRONG };
  const oidcAll = { OIDC_ISSUER: 'https://id.example', OIDC_CLIENT_ID: 'lore', OIDC_CLIENT_SECRET: 'secret' };

  it('needs all three of OIDC_ISSUER, OIDC_CLIENT_ID and OIDC_CLIENT_SECRET', () => {
    expect(checkConfig('serve', { ...serve, OIDC_ISSUER: 'https://id' }).errors).toContainEqual(
      expect.stringMatching(/OIDC_CLIENT_ID.*OIDC_CLIENT_SECRET/),
    );
    expect(checkConfig('serve', { ...serve, OIDC_CLIENT_SECRET: 's' }).errors).toContainEqual(
      expect.stringMatching(/^OIDC_ISSUER, OIDC_CLIENT_ID \(/),
    );
  });

  it('SSO mode needs PUBLIC_URL, a valid one', () => {
    expect(checkConfig('serve', { ...serve, ...oidcAll }).errors).toContainEqual(expect.stringMatching(/PUBLIC_URL/));
    expect(checkConfig('serve', { ...serve, ...oidcAll, PUBLIC_URL: 'not a url' }).errors).toContainEqual(
      expect.stringMatching(/PUBLIC_URL \(must be/),
    );
    expect(checkConfig('serve', { ...serve, ...oidcAll, PUBLIC_URL: 'https://l' })).toEqual({ errors: [], warnings: [] });
  });

  it('a plain-http issuer needs OIDC_ALLOW_INSECURE=true', () => {
    const http = { ...serve, ...oidcAll, PUBLIC_URL: 'https://l', OIDC_ISSUER: 'http://id' };
    expect(checkConfig('serve', http).errors).toContainEqual(expect.stringMatching(/OIDC_ALLOW_INSECURE/));
    expect(checkConfig('serve', { ...http, OIDC_ALLOW_INSECURE: 'true' }).errors).toEqual([]);
    expect(checkConfig('serve', { ...http, OIDC_ISSUER: 'nope' }).errors).toContainEqual(expect.stringMatching(/OIDC_ISSUER \(must be/));
    expect(checkConfig('serve', { ...http, OIDC_ALLOW_INSECURE: 'yes' }).errors).toContainEqual(
      expect.stringMatching(/OIDC_ALLOW_INSECURE \(must be true or false\)/),
    );
  });

  it('treats empty optional SSO variables as unset (docker compose forwards them as ${VAR:-})', () => {
    const sso = { ...serve, ...oidcAll, PUBLIC_URL: 'https://l' };
    const empty = {
      OIDC_SCOPES: '',
      OIDC_GROUPS_CLAIM: '',
      OIDC_LOGIN_GROUP: '',
      OIDC_ADMIN_GROUP: '',
      OIDC_ALLOW_INSECURE: '',
      LORE_MCP_PUBLIC_URL: '',
    };
    expect(checkConfig('serve', { ...sso, ...empty }).errors).toEqual([]);
    expect(checkConfig('serve', { ...serve, ...empty, PUBLIC_URL: '', OIDC_ISSUER: '', OIDC_CLIENT_ID: '', OIDC_CLIENT_SECRET: '' }).errors).toEqual([]);
  });

  it('OIDC_SCOPES must include openid', () => {
    const sso = { ...serve, ...oidcAll, PUBLIC_URL: 'https://l' };
    expect(checkConfig('serve', { ...sso, OIDC_SCOPES: 'profile email' }).errors).toContainEqual(expect.stringMatching(/OIDC_SCOPES/));
    expect(checkConfig('serve', { ...sso, OIDC_SCOPES: 'openid,email' }).errors).toEqual([]);
  });

  it('in SSO mode LORE_ADMIN_LOGIN/PASSWORD are ignored with a warning', () => {
    const r = checkConfig('serve', { ...serve, ...oidcAll, PUBLIC_URL: 'https://l', LORE_ADMIN_LOGIN: 'root', LORE_ADMIN_PASSWORD: 'short' });
    expect(r.errors).toEqual([]);
    expect(r.warnings).toContain('LORE_ADMIN_LOGIN/LORE_ADMIN_PASSWORD are ignored in SSO mode');
  });
});

describe('ssoConfigFromEnv', () => {
  const oidcAll = { OIDC_ISSUER: 'https://id.example', OIDC_CLIENT_ID: 'lore', OIDC_CLIENT_SECRET: 'secret' };

  it('is null when none of the three is set', () => {
    expect(ssoConfigFromEnv({})).toBeNull();
  });

  it('derives the redirect URI from PUBLIC_URL and applies the defaults', () => {
    expect(ssoConfigFromEnv({ ...oidcAll, PUBLIC_URL: 'https://lore.example/' })).toEqual({
      issuer: 'https://id.example',
      clientId: 'lore',
      clientSecret: 'secret',
      redirectUri: 'https://lore.example/api/auth/sso/callback',
      scopes: 'openid profile email groups',
      groupsClaim: 'groups',
      policy: { loginGroup: 'lore-users', adminGroup: 'lore-admins' },
      allowInsecure: false,
    });
  });

  it('reads the optional settings', () => {
    const c = ssoConfigFromEnv({
      ...oidcAll,
      PUBLIC_URL: 'http://l:3000',
      OIDC_SCOPES: 'openid, email openid',
      OIDC_GROUPS_CLAIM: 'roles',
      OIDC_LOGIN_GROUP: 'u',
      OIDC_ADMIN_GROUP: 'a',
      OIDC_ALLOW_INSECURE: 'true',
    });
    expect(c).toMatchObject({
      redirectUri: 'http://l:3000/api/auth/sso/callback',
      scopes: 'openid email',
      groupsClaim: 'roles',
      policy: { loginGroup: 'u', adminGroup: 'a' },
      allowInsecure: true,
    });
  });

  it('throws on a partial configuration or a missing PUBLIC_URL', () => {
    expect(() => ssoConfigFromEnv({ OIDC_ISSUER: 'https://id' })).toThrow(/OIDC_CLIENT_ID/);
    expect(() => ssoConfigFromEnv(oidcAll)).toThrow(/PUBLIC_URL/);
  });
});

describe('link-sso / unlink-sso configuration', () => {
  const oidc = { OIDC_ISSUER: 'https://id.example', OIDC_CLIENT_ID: 'lore', OIDC_CLIENT_SECRET: 's', PUBLIC_URL: 'https://lore.example' };

  it('link-sso needs the database and the OIDC settings', () => {
    expect(checkConfig('link-sso', { DATABASE_URL: 'postgres://x', ...oidc })).toEqual({ errors: [], warnings: [] });
    const none = checkConfig('link-sso', { DATABASE_URL: 'postgres://x' });
    expect(none.errors).toEqual(expect.arrayContaining(['OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET']));
    const noPublic = checkConfig('link-sso', { DATABASE_URL: 'postgres://x', ...oidc, PUBLIC_URL: undefined });
    expect(noPublic.errors.join()).toMatch(/PUBLIC_URL/);
  });

  it('unlink-sso needs only the database', () => {
    expect(checkConfig('unlink-sso', { DATABASE_URL: 'postgres://x' })).toEqual({ errors: [], warnings: [] });
    expect(checkConfig('unlink-sso', {}).errors).toEqual(['DATABASE_URL']);
  });
});

describe('public URLs', () => {
  it('publicUrl is PUBLIC_URL without trailing slashes, undefined when unset or empty', () => {
    expect(publicUrl({ PUBLIC_URL: 'https://lore.example.com/' })).toBe('https://lore.example.com');
    expect(publicUrl({ PUBLIC_URL: '' })).toBeUndefined();
    expect(publicUrl({})).toBeUndefined();
  });

  it('mcpPublicUrl falls back to localhost on LORE_MCP_PORT, also when LORE_MCP_PUBLIC_URL is empty', () => {
    expect(mcpPublicUrl({ LORE_MCP_PUBLIC_URL: '', LORE_MCP_PORT: '5000' })).toBe('http://localhost:5000/mcp');
    expect(mcpPublicUrl({ LORE_MCP_PUBLIC_URL: 'https://mcp.example.com/mcp' })).toBe('https://mcp.example.com/mcp');
  });
});

describe('LORE_TRUST_PROXY', () => {
  const serve = (v: string | undefined) => checkConfig('serve', { ...base, LORE_API_KEY: STRONG, LORE_TRUST_PROXY: v });

  it.each([
    [undefined, false],
    ['', false],
    ['false', false],
    ['10.0.0.0/8, 127.0.0.1', ['10.0.0.0/8', '127.0.0.1']],
    ['::1', ['::1']],
  ])('%s → %j', (v, expected) => {
    expect(trustProxyFromEnv({ LORE_TRUST_PROXY: v })).toEqual(expected);
    expect(serve(v).errors).toEqual([]);
  });

  it.each(['true', '0', '-1', '1.5', 'proxy.local', '10.0.0.0/99', '10.0.0.1,,'])('rejects %s', (v) => {
    expect(() => trustProxyFromEnv({ LORE_TRUST_PROXY: v })).toThrow(/LORE_TRUST_PROXY/);
    expect(serve(v).errors.join()).toMatch(/LORE_TRUST_PROXY/);
  });

  // Fastify trusts no proxy for a hop count (it cannot check the peer), so a count would silently
  // put every client behind the proxy's address. Refuse it and ask for the proxies' addresses.
  it.each(['1', '2'])('refuses the hop count %s and asks for the proxy addresses', (v) => {
    expect(() => trustProxyFromEnv({ LORE_TRUST_PROXY: v })).toThrow(/hop counts are not supported.*IPs\/CIDRs/);
    expect(serve(v).errors.join()).toMatch(/hop counts are not supported/);
  });
});

describe('LORE_CLI_TOKEN_TTL_DAYS', () => {
  const serve = (v: string | undefined) => checkConfig('serve', { ...base, LORE_API_KEY: STRONG, LORE_CLI_TOKEN_TTL_DAYS: v });

  it.each([
    [undefined, 90],
    ['', 90],
    ['1', 1],
    ['30', 30],
    ['3650', 3650],
  ])('%s → %d days', (v, days) => {
    expect(cliTokenTtlDaysFromEnv({ LORE_CLI_TOKEN_TTL_DAYS: v })).toBe(days);
    expect(serve(v).errors).toEqual([]);
  });

  it.each(['0', '-5', '1.5', '3651', 'never'])('rejects %s', (v) => {
    expect(() => cliTokenTtlDaysFromEnv({ LORE_CLI_TOKEN_TTL_DAYS: v })).toThrow(/LORE_CLI_TOKEN_TTL_DAYS/);
    expect(serve(v).errors.join()).toMatch(/LORE_CLI_TOKEN_TTL_DAYS/);
  });
});

describe('LORE_SSO_SESSION_MAX_HOURS', () => {
  it.each([[undefined, 24], ['', 24], ['1', 1], ['8', 8], ['720', 720]])('%s -> %d hours', (v, hours) => {
    expect(ssoSessionMaxHoursFromEnv({ LORE_SSO_SESSION_MAX_HOURS: v })).toBe(hours);
  });
  it.each(['0', '-1', '1.5', '721', 'day'])('rejects %s', (v) => {
    expect(() => ssoSessionMaxHoursFromEnv({ LORE_SSO_SESSION_MAX_HOURS: v })).toThrow(/LORE_SSO_SESSION_MAX_HOURS/);
  });
});

describe('LORE_DEVICE_COOKIE_SECRET', () => {
  it('is optional, and must be at least 32 characters when set', () => {
    const serve = (v?: string) => checkConfig('serve', { ...base, LORE_API_KEY: STRONG, LORE_DEVICE_COOKIE_SECRET: v }).errors;
    expect(serve()).toEqual([]);
    expect(serve('x'.repeat(32))).toEqual([]);
    expect(serve('short').join()).toMatch(/LORE_DEVICE_COOKIE_SECRET/);
  });
});
