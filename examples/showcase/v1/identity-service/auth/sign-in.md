---
slug: auth/sign-in
domain: auth
entry_type: handler
handler_class: SignInHandler
http_method: POST
route: /api/v1/auth/sign-in
summary: Signs a user in with e-mail and password or phone OTP and returns a 15-minute JWT and a 30-day refresh token
category: specification
links:
  - slug: auth/refresh-token
    type: related_to
  - slug: schemas/users
    type: references
  - slug: events/user-registered
    type: references
  - slug: gateway/rate-limits
    library: api-gateway
    type: related_to
  - slug: decisions/gateway-auth-at-edge
    library: api-gateway
    type: references
---

# SignInHandler

Authenticates a customer or courier and starts a new refresh token family. Ops staff sign in through SSO and get
`403 sso_required` here.

## Request

| Field | Location | Type | Required | Description |
|-------|----------|------|----------|-------------|
| `method` | body | string | yes | `password` or `phone_otp` |
| `email` | body | string | for `password` | Case-insensitive |
| `password` | body | string | for `password` | 10–128 characters |
| `phone` | body | string | for `phone_otp` | E.164, e.g. `+4915112345678` |
| `otp` | body | string | for `phone_otp` | 6 digits, valid 5 minutes |
| `device_id` | body | string | yes | Stable app installation id, stored with the refresh token |

## Response

`200 OK`

| Field | Type | Description |
|-------|------|-------------|
| `access_token` | string | JWT, ES256, expires in 15 minutes |
| `token_type` | string | Always `Bearer` |
| `expires_in` | integer | `900` |
| `refresh_token` | string | Opaque, 30 days |
| `user` | object | `{ id, display_name, roles }` |
| `is_new_user` | boolean | `true` when a phone OTP sign-in created the account |

## Business Logic

1. Normalise the e-mail (lower-case, trimmed) or phone (E.164).
2. Load the user via `IUserRepository.findByEmail` / `findByPhone` from table: users.
3. If the user has role `ops` → `403 sso_required`.
4. If `locked_until > now()` → `423 account_locked` with `Retry-After`.
5. Verify the password (Argon2id, m=64 MiB, t=3) or the OTP (constant-time compare, max 3 attempts per OTP).
6. On failure increment `failed_sign_ins`; at 10 set `locked_until = now() + 30 min`. Respond `401` with a generic message.
7. On phone OTP sign-in for an unknown phone, create the user with role `customer` and `status = active`, then publish
   `user.registered` to topic: `parcelly.identity-events` through the outbox (see `events/user-registered`).
8. Reset `failed_sign_ins`, set `last_sign_in_at`.
9. Create a refresh token family: insert into table: refresh_tokens via `IRefreshTokenRepository.insert` with the SHA-256
   of the token, `family_id` (UUID v7), `device_id`, `expires_at = now() + 30 days`. A user may hold at most 10 active
   families; the oldest is revoked when the 11th is created.
10. Sign the access token with the current KMS key; `jti` is a UUID v7.

## External Dependencies

- `IUserRepository`
- `IRefreshTokenRepository`
- table: users
- table: refresh_tokens
- topic: `parcelly.identity-events`
- AWS KMS — `Sign` with key alias `alias/identity-jwt-current`

## Error Handling

| HTTP code | Error | Condition |
|-----------|-------|-----------|
| `400` | `invalid_request` | Missing fields for the chosen method, malformed phone |
| `401` | `invalid_credentials` | Wrong password, wrong or expired OTP, unknown e-mail (same message for all) |
| `403` | `sso_required` | Ops account |
| `403` | `account_suspended` | `status = suspended` |
| `423` | `account_locked` | 10 consecutive failures, locked for 30 minutes |
| `429` | `rate_limited` | Gateway limit: 10/min per IP, 5 per 15 min per e-mail |
| `503` | `signing_unavailable` | KMS unreachable; no token issued |
