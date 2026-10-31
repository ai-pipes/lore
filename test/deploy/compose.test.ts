import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The lore service lists its environment explicitly (no env_file), so every
// variable the README tells operators to put into .env must be forwarded here.
const compose = readFileSync(new URL('../../docker-compose.yml', import.meta.url), 'utf8');

function loreEnvironment(): Map<string, string> {
  const service = compose.split(/^ {2}lore:\s*$/m)[1]?.split(/^ {2}\S/m)[0] ?? '';
  const block = service.split(/^ {4}environment:\s*$/m)[1]?.split(/^ {4}\S/m)[0] ?? '';
  const vars = new Map<string, string>();
  for (const m of block.matchAll(/^ {6}([A-Z_][A-Z0-9_]*):\s*(.*)$/gm)) vars.set(m[1], m[2].trim());
  return vars;
}

describe('docker-compose.yml lore service', () => {
  const env = loreEnvironment();

  it('is parsed', () => {
    expect(env.get('DATABASE_URL')).toBe('postgres://lore:lore@postgres:5432/lore');
  });

  it.each([
    'PUBLIC_URL',
    'OIDC_ISSUER',
    'OIDC_CLIENT_ID',
    'OIDC_CLIENT_SECRET',
    'OIDC_SCOPES',
    'OIDC_GROUPS_CLAIM',
    'OIDC_LOGIN_GROUP',
    'OIDC_ADMIN_GROUP',
    'OIDC_ALLOW_INSECURE',
    'LORE_MCP_PUBLIC_URL',
    'LORE_TRUST_PROXY',
    'LORE_CLI_TOKEN_TTL_DAYS',
    'LORE_DEVICE_COOKIE_SECRET',
  ])('forwards %s from .env, empty when unset', (name) => {
    expect(env.get(name)).toBe(`\${${name}:-}`);
  });
});
