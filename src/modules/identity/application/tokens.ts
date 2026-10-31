/**
 * Personal `sk_` tokens: created in the UI (shown once), listed, revoked. Tokens created here never
 * expire; CLI device-login tokens carry an expiry (see device-login.ts).
 */
import { IdentityError } from '../domain/user.js';
import type { ApiTokenRecord, IdentityDeps } from './ports.js';

export const TOKEN_NAME_MAX_LENGTH = 100;
/** The stored, displayable start of a token (`sk_` plus 5 characters); not enough to use it. */
const PREFIX_LENGTH = 8;

/**
 * A new `sk_` secret and the row that stores it: the trimmed `name` (1-100 characters, else
 * `IdentityError('invalid_input')`), the displayable prefix and the SHA-256 hex. Shared by the
 * Tokens page and the CLI device login so both store tokens the same way.
 */
export function newTokenSecret(d: IdentityDeps, name: string): { token: string; row: { name: string; prefix: string; hash: string } } {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > TOKEN_NAME_MAX_LENGTH) {
    throw new IdentityError('invalid_input', `token name must be 1-${TOKEN_NAME_MAX_LENGTH} characters`);
  }
  const token = d.secrets.random('sk_');
  return { token, row: { name: trimmed, prefix: token.slice(0, PREFIX_LENGTH), hash: d.secrets.sha256Hex(token) } };
}

/**
 * A new token for `userId`. The secret is returned once and only its SHA-256 hex is stored.
 * The name is trimmed and must be 1-100 characters, else `IdentityError('invalid_input')`.
 */
export async function createToken(
  d: IdentityDeps,
  userId: string,
  name: string,
): Promise<{ token: string; record: ApiTokenRecord }> {
  const { token, row } = newTokenSecret(d, name);
  const record = await d.tokens.insert({ userId, ...row });
  return { token, record };
}

/** The user's tokens, revoked ones included, oldest first. */
export async function listTokens(d: IdentityDeps, userId: string): Promise<ApiTokenRecord[]> {
  return d.tokens.listByUser(userId);
}

/** False when the token is unknown, someone else's or already revoked. */
export async function revokeToken(d: IdentityDeps, userId: string, tokenId: string): Promise<boolean> {
  return d.tokens.revoke(userId, tokenId, d.clock.now());
}

/** The `claude mcp add` command that registers Lore's MCP endpoint with this token. */
export function mcpAddCommand(mcpUrl: string, token: string): string {
  return `claude mcp add --transport http lore ${mcpUrl} --header "Authorization: Bearer ${token}"`;
}
