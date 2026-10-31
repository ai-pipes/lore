/** Single sign-on settings from the environment (validated at startup by `platform/config.ts`). */
import type { GroupPolicy } from '../domain/user.js';
import { DEFAULT_GROUPS_CLAIM, DEFAULT_OIDC_SCOPES } from './openid-provider.js';

export interface SsoConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  /** `${PUBLIC_URL}/api/auth/sso/callback`. */
  redirectUri: string;
  /** Space-separated, always with `openid`. */
  scopes: string;
  groupsClaim: string;
  policy: GroupPolicy;
  /** A plain `http:` issuer is allowed (`OIDC_ALLOW_INSECURE=true`). */
  allowInsecure: boolean;
}

export const OIDC_REQUIRED = ['OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET'] as const;
export const SSO_CALLBACK_PATH = '/api/auth/sso/callback';
export const DEFAULT_OIDC_LOGIN_GROUP = 'lore-users';
export const DEFAULT_OIDC_ADMIN_GROUP = 'lore-admins';

/** Space- or comma-separated scopes as one space-separated list without duplicates. */
export function normalizeScopes(raw: string): string {
  return [...new Set(raw.split(/[\s,]+/).filter((s) => s !== ''))].join(' ');
}

/**
 * The SSO settings, or null when none of `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` is
 * set (password mode). Throws on a partial configuration or a missing `PUBLIC_URL`.
 */
export function ssoConfigFromEnv(env: Record<string, string | undefined>): SsoConfig | null {
  const missing = OIDC_REQUIRED.filter((k) => !env[k]);
  if (missing.length === OIDC_REQUIRED.length) return null;
  if (missing.length > 0) throw new Error(`single sign-on: ${missing.join(', ')} must be set too`);
  if (!env.PUBLIC_URL) throw new Error('single sign-on: PUBLIC_URL must be set');
  return {
    issuer: env.OIDC_ISSUER!,
    clientId: env.OIDC_CLIENT_ID!,
    clientSecret: env.OIDC_CLIENT_SECRET!,
    redirectUri: `${env.PUBLIC_URL.replace(/\/+$/, '')}${SSO_CALLBACK_PATH}`,
    scopes: normalizeScopes(env.OIDC_SCOPES || DEFAULT_OIDC_SCOPES),
    groupsClaim: env.OIDC_GROUPS_CLAIM || DEFAULT_GROUPS_CLAIM,
    policy: {
      loginGroup: env.OIDC_LOGIN_GROUP || DEFAULT_OIDC_LOGIN_GROUP,
      adminGroup: env.OIDC_ADMIN_GROUP || DEFAULT_OIDC_ADMIN_GROUP,
    },
    allowInsecure: env.OIDC_ALLOW_INSECURE === 'true',
  };
}
