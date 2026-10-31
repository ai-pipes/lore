---
slug: schemas/users
domain: users
entry_type: schema
summary: users and refresh_tokens tables — Parcelly accounts with roles, lockout state and rotated refresh token families
category: specification
links:
  - slug: auth/sign-in
    type: related_to
  - slug: auth/refresh-token
    type: related_to
  - slug: users/get-profile
    type: related_to
  - slug: events/user-registered
    type: related_to
---

# users table

One row per account. Owned by identity-service; no other service reads it directly.

## Columns

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | uuid | no | Primary key, UUID v7 |
| `phone` | varchar(16) | no | E.164, unique |
| `email` | citext | yes | Unique when not null |
| `email_verified` | boolean | no | Default `false` |
| `password_hash` | text | yes | Argon2id; null for phone-only accounts |
| `display_name` | varchar(60) | no | |
| `roles` | text[] | no | Subset of `customer`, `courier`, `ops` |
| `status` | varchar(16) | no | `active`, `suspended`, `deleted` |
| `locale` | varchar(5) | no | Default `en-GB` |
| `notification_preferences` | jsonb | no | `{"email":true,"push":true,"sms":false}` |
| `default_pickup_address` | jsonb | yes | |
| `failed_sign_ins` | smallint | no | Reset on success; at 10 the account is locked |
| `locked_until` | timestamptz | yes | `now() + 30 min` after 10 failures |
| `last_sign_in_at` | timestamptz | yes | |
| `created_at` | timestamptz | no | |
| `deleted_at` | timestamptz | yes | GDPR erasure; PII columns are nulled/hashed |

Indexes: `users_phone_key` (unique), `users_email_key` (unique, partial `WHERE email IS NOT NULL`),
`users_status_idx`.

# refresh_tokens table

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | uuid | no | Primary key |
| `user_id` | uuid | no | FK → users.id |
| `family_id` | uuid | no | Created at sign-in, shared by all rotations |
| `token_hash` | char(64) | no | SHA-256 hex of the token, unique |
| `device_id` | varchar(64) | no | |
| `expires_at` | timestamptz | no | Sign-in + 30 days, same for the whole family |
| `rotated_at` | timestamptz | yes | Set when exchanged |
| `revoked_at` | timestamptz | yes | Set on sign-out, reuse detection, suspension |
| `created_at` | timestamptz | no | |

Indexes: `refresh_tokens_hash_key` (unique), `refresh_tokens_family_idx`, `refresh_tokens_user_active_idx`
(`WHERE revoked_at IS NULL AND rotated_at IS NULL`).

## Notes

table: users
table: refresh_tokens

- A nightly job deletes refresh tokens 7 days after `expires_at`.
- `SELECT count(*) FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL AND rotated_at IS NULL` is capped at 10
  active families per user (enforced in `auth/sign-in`).
