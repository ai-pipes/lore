import type { IdentityErrorCode } from '../../domain/user.js';

/**
 * The HTTP status of every identity error. A `Record` over the whole union, so a new error code
 * does not compile until it has a status (no silent 400 fallback).
 */
export const IDENTITY_ERROR_STATUS: Record<IdentityErrorCode, number> = {
  invalid_credentials: 401,
  rate_limited: 429,
  disabled: 403,
  weak_password: 400,
  user_exists: 409,
  not_found: 404,
  invalid_input: 400,
  invalid_state: 400,
  not_allowed: 403,
  idp_unavailable: 503,
  sso_only: 403,
  sso_managed: 409,
  sso_linked: 409,
  forbidden: 403,
  expired: 410,
  already_decided: 409,
};
