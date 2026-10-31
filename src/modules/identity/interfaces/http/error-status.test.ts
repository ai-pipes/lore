import { describe, expect, it } from 'vitest';
import { IDENTITY_ERROR_STATUS } from './error-status.js';

describe('IDENTITY_ERROR_STATUS', () => {
  it('maps every identity error to a specific 4xx/5xx status, never a generic 400 fallback', () => {
    expect(IDENTITY_ERROR_STATUS).toEqual({
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
    });
  });
});
