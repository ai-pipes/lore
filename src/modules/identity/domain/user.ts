/** Users, principals and the identity module's errors. Plain TypeScript, no dependencies. */
import { DomainError } from '../../../shared-kernel/index.js';

export type Role = 'admin' | 'member';

export interface User {
  id: string;
  login: string;
  displayName: string;
  role: Role;
  disabled: boolean;
  /** Null for people created by single sign-on: they have never had a password. */
  passwordHash: string | null;
  /** Issuer and `sub` of the linked provider account; both null = not linked. */
  oidcIss: string | null;
  oidcSub: string | null;
  email: string | null;
  /** Provider groups as of the last single sign-on. */
  groups: string[];
  /** Last successful web sign-in (password or SSO). */
  lastLoginAt: Date | null;
  createdAt: Date;
}

/** Who is making a request: a user (web session or `sk_` token) or the break-glass admin key. */
export type Principal =
  | { kind: 'user'; userId: string; login: string; displayName: string; role: Role; via: 'session' | 'token'; tokenId?: string }
  | { kind: 'admin-key' };

/**
 * An admin acting interactively: signed in to the web UI with a session, or the break-glass admin
 * key. Creating users, resetting passwords and changing roles need this; an admin's `sk_` token
 * (which may sit in a script or an MCP client) is not enough.
 */
export function isInteractiveAdmin(p: Principal): boolean {
  return p.kind === 'admin-key' || (p.role === 'admin' && p.via === 'session');
}

/** What the identity provider tells us about a person. */
export interface OidcClaims {
  sub: string;
  preferredUsername: string | null;
  /** The person's full name (`name`), for the display name. */
  name: string | null;
  email: string | null;
  /** The provider vouches for `email` (`email_verified: true`). */
  emailVerified: boolean;
  groups: string[];
}

/** Provider groups that open the door (`loginGroup`) and that make a person an admin. */
export interface GroupPolicy {
  loginGroup: string;
  adminGroup: string;
}

/** The role a person with these groups gets, or null when they may not sign in at all. */
export function accessFor(groups: readonly string[], p: GroupPolicy): Role | null {
  if (groups.includes(p.adminGroup)) return 'admin';
  if (groups.includes(p.loginGroup)) return 'member';
  return null;
}

export type IdentityErrorCode =
  | 'invalid_credentials'
  | 'rate_limited'
  | 'disabled'
  | 'weak_password'
  | 'user_exists'
  | 'not_found'
  | 'invalid_input'
  /** Single sign-on: the login attempt is unknown, expired, not from this browser or refused. */
  | 'invalid_state'
  /** Single sign-on: the person is in neither the login nor the admin group. */
  | 'not_allowed'
  /** Single sign-on: the identity provider cannot be reached right now. */
  | 'idp_unavailable'
  /** Password sign-in is off: the web UI signs in with SSO only. */
  | 'sso_only'
  /** People and passwords are managed in the identity provider. */
  | 'sso_managed'
  /** The provider account is already linked to another user. */
  | 'sso_linked'
  | 'forbidden'
  | 'expired'
  /** CLI device login: the request was already approved or denied. */
  | 'already_decided';

export class IdentityError extends DomainError {
  constructor(
    override readonly code: IdentityErrorCode,
    message: string,
    readonly retryAfterSec?: number,
  ) {
    super(code, message);
    this.name = 'IdentityError';
  }
}

const LOGIN_RE = /^[a-z0-9][a-z0-9._-]{0,127}$/;

/** A login as stored: trimmed and lower-cased, 1-128 characters of `[a-z0-9._-]`; null if invalid. */
export function normalizeLogin(raw: string): string | null {
  const login = raw.trim().toLowerCase();
  return LOGIN_RE.test(login) ? login : null;
}

const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 1024; // bounds KDF work on hostile input

export function checkPassword(pw: string): IdentityError | null {
  if (pw.length < MIN_PASSWORD_LENGTH) {
    return new IdentityError('weak_password', `password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  if (pw.length > MAX_PASSWORD_LENGTH) {
    return new IdentityError('weak_password', 'password is too long');
  }
  return null;
}
