---
slug: users/get-profile
domain: users
entry_type: query_handler
handler_class: GetMyProfileQuery
http_method: GET
route: /api/v1/users/me
summary: Returns the signed-in user's profile, roles, verified contact data and notification preferences
category: specification
links:
  - slug: schemas/users
    type: references
  - slug: gateway/routing
    library: api-gateway
    type: references
  - slug: notifications/send-notification
    library: notifications-service
    type: related_to
  - slug: orders/create-order
    library: orders-service
    type: related_to
---

# GetMyProfileQuery

Returns the profile of the caller identified by the gateway header `X-Parcelly-User-Id`. There is no way to read
another user's profile through this route; ops use the internal `GET /internal/users/{user_id}`.

## Request

| Field | Location | Type | Required | Description |
|-------|----------|------|----------|-------------|
| `Authorization` | header | string | yes | `Bearer <access token>`, verified by the gateway |
| `X-Parcelly-User-Id` | header | uuid | injected | Set by the gateway; client values are stripped |

## Response

`200 OK`

| Field | Type | Description |
|-------|------|-------------|
| `id` | uuid | UUID v7 |
| `display_name` | string | 1–60 characters |
| `email` | string \| null | |
| `email_verified` | boolean | |
| `phone` | string | E.164 |
| `phone_verified` | boolean | Always `true` for customers (sign-up is via phone OTP) |
| `roles` | string[] | `customer`, `courier`, `ops` |
| `locale` | string | `de-DE`, `en-GB`, `pl-PL`; used by notifications-service for templates |
| `notification_preferences` | object | `{ email: bool, push: bool, sms: bool }` |
| `default_pickup_address` | object \| null | `{ line1, postcode, city, lat, lon }` |
| `created_at` | timestamp | UTC ISO-8601 |

## Business Logic

1. Read `X-Parcelly-User-Id`; absent → `401` (should never happen behind the gateway).
2. Load the user via `IUserRepository.findById` from table: users (read replica, max lag 1 s).
3. `status = deleted` → `404`; `status = suspended` → `403`.
4. Map to the response; never return `password_hash`, `failed_sign_ins` or `locked_until`.
5. Response is cacheable by the app for 60 s (`Cache-Control: private, max-age=60`).

orders-service reads `default_pickup_address` from the app, not from this endpoint; notifications-service reads
`locale` and `notification_preferences` through the internal variant of this query.

## External Dependencies

- `IUserRepository`
- table: users

## Error Handling

| HTTP code | Error | Condition |
|-----------|-------|-----------|
| `401` | `invalid_token` | Missing or invalid JWT (raised by the gateway) |
| `403` | `account_suspended` | User suspended after the token was issued |
| `404` | `user_not_found` | User deleted (GDPR erasure) |
