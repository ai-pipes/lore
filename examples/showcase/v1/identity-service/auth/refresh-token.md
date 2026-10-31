---
slug: auth/refresh-token
domain: auth
entry_type: handler
handler_class: RefreshTokenHandler
http_method: POST
route: /api/v1/auth/refresh
summary: Exchanges a refresh token for a new access token and a rotated refresh token; reuse revokes the whole family
category: specification
links:
  - slug: auth/sign-in
    type: related_to
  - slug: schemas/users
    type: references
  - slug: decisions/gateway-auth-at-edge
    library: api-gateway
    type: references
  - slug: gateway/rate-limits
    library: api-gateway
    type: related_to
---

# RefreshTokenHandler

Rotates a refresh token. Every successful refresh invalidates the presented token and returns a new one in the same
family. Presenting an already-rotated token is treated as theft: the whole family is revoked.

## Request

| Field | Location | Type | Required | Description |
|-------|----------|------|----------|-------------|
| `refresh_token` | body | string | yes | Opaque token from sign-in or the previous refresh |
| `device_id` | body | string | yes | Must match the device the family was created on |

## Response

`200 OK`

| Field | Type | Description |
|-------|------|-------------|
| `access_token` | string | New JWT, 15 minutes |
| `expires_in` | integer | `900` |
| `refresh_token` | string | New opaque token; the old one is now invalid |
| `refresh_expires_at` | timestamp | Family expiry; **not** extended by refreshing (30 days from sign-in) |

## Business Logic

1. Hash the token (SHA-256) and load the row from table: refresh_tokens via `IRefreshTokenRepository.findByHash`
   with `SELECT ... FOR UPDATE`.
2. Unknown hash → `401 invalid_refresh_token`.
3. If the row is `rotated_at IS NOT NULL` (already used) and the reuse is more than 10 seconds after rotation →
   revoke every token of `family_id`, log `security.refresh_reuse` and respond `401 refresh_token_reused`.
   Reuse within 10 seconds (two parallel app requests) returns the token pair already issued for it.
4. If `revoked_at` is set or `expires_at < now()` → `401 invalid_refresh_token`.
5. If `device_id` differs → revoke the family, `401 device_mismatch`.
6. Load the user from table: users; `status = suspended` → revoke family, `403 account_suspended`. Roles are re-read so
   role changes take effect within one refresh.
7. Mark the row `rotated_at = now()`, insert the successor with the same `family_id` and `expires_at`, and sign a new
   access token. All in one transaction.

## External Dependencies

- `IRefreshTokenRepository`
- `IUserRepository`
- table: refresh_tokens
- table: users
- AWS KMS

## Error Handling

| HTTP code | Error | Condition |
|-----------|-------|-----------|
| `400` | `invalid_request` | Missing token or device id |
| `401` | `invalid_refresh_token` | Unknown, revoked or expired token |
| `401` | `refresh_token_reused` | Rotated token presented again after the 10 s grace period; family revoked |
| `401` | `device_mismatch` | Token used from another device; family revoked |
| `403` | `account_suspended` | User suspended |
| `429` | `rate_limited` | More than 10 refreshes per minute per family (gateway) |
| `503` | `signing_unavailable` | KMS unreachable |

## Notes

The apps refresh proactively 60 seconds before the access token expires, and once on any `401 invalid_token` from the
gateway. After 30 days the user must sign in again.
