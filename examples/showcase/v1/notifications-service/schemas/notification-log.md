---
slug: schemas/notification-log
domain: notifications
entry_type: schema
summary: notification_log table — one row per notification with dedup key, channel, status, attempts and masked recipient
category: specification
links:
  - slug: notifications/send-notification
    type: references
  - slug: notifications/overview
    type: references
  - slug: schemas/users
    library: identity-service
    type: references
  - slug: schemas/orders
    library: orders-service
    type: references
---

# notification_log

Postgres table owned by the notifications service. Written by `notifications/send-notification`, updated by provider
delivery webhooks. Partitioned by month on `created_at`; partitions older than 13 months are dropped (GDPR retention).

## Columns

| Column | Type | Null | Description |
|--------|------|------|-------------|
| `id` | uuid | no | UUID v7, primary key |
| `dedup_key` | text | no | E.g. `courier.assigned:{order_id}:{assignment_id}` |
| `user_id` | uuid | no | Recipient (identity-service user; no FK across services) |
| `order_id` | uuid | yes | Related order, if any |
| `template` | text | no | `order_created`, `courier_assigned`, `courier_reassigned`, `delivery_completed`, `delivery_receipt`, `refund_issued`, `welcome` |
| `locale` | text | no | `en`, `de` or `fr` (after fallback) |
| `urgency` | text | no | `urgent`, `normal`, `low` |
| `channel` | text | yes | Channel that was finally used: `email`, `push`, `sms`; null if skipped |
| `channels_tried` | text[] | no | E.g. `{push,sms}` |
| `status` | text | no | `pending`, `sent`, `delivered`, `failed`, `bounced`, `deferred`, `skipped_duplicate`, `skipped_opt_out`, `skipped_rate_limited` |
| `recipient_masked` | text | yes | `j***@example.com`, `+49 *** ** 12`; never the full address |
| `provider` | text | yes | `mailwave`, `fcm`, `apns`, `textora` |
| `provider_message_id` | text | yes | For webhook correlation |
| `attempts` | smallint | no | Default 0 |
| `deferred_until` | timestamptz | yes | Quiet-hours deferral target (08:00 local) |
| `error_code` | text | yes | Last provider error |
| `created_at` | timestamptz | no | |
| `sent_at` | timestamptz | yes | |
| `delivered_at` | timestamptz | yes | From the provider receipt |

## Indexes and constraints

| Name | Definition | Purpose |
|------|------------|---------|
| `notification_log_pkey` | `(id, created_at)` | Primary key per partition |
| `notification_log_dedup_uq` | unique `(dedup_key, created_at)` + lookup table `notification_dedup(dedup_key)` with 7-day TTL | Deduplication across partitions |
| `notification_log_user_idx` | `(user_id, created_at DESC)` | Support view "messages sent to a customer" |
| `notification_log_deferred_idx` | `(deferred_until) WHERE status = 'deferred'` | Deferred worker, every minute |
| `notification_log_provider_idx` | `(provider, provider_message_id)` | Delivery webhooks |

## Notes

- Message bodies are not stored; they can be re-rendered from `template`, `locale` and the event.
- The SMS rate limit (1 per order per 10 min, 5 per user per day) is enforced in Redis, but support reports count
  `channel = 'sms'` rows here.
- A user deletion (`user.deleted` on topic: `parcelly.identity-events`) nulls `recipient_masked` for that user.
