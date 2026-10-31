---
slug: notifications/send-notification
domain: notifications
entry_type: handler
handler_class: SendNotificationHandler
http_method: POST
route: /api/v1/notifications
summary: Sends an e-mail or push notification from a template, deduplicated by dedup_key
category: specification
---

# SendNotificationHandler

Internal endpoint other services call to send a message to a user. Requires a service token.

## Request

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `user_id` | uuid | yes | Recipient |
| `channel` | string | yes | `email` or `push` |
| `template` | string | yes | e.g. `order_confirmation`, `refund_requested`, `refund_completed` |
| `data` | object | no | Template variables |
| `dedup_key` | string | no | Messages with the same key within 24 h are dropped |
| `category` | string | no | `transactional` (default) or `marketing` |

## Response

`202 Accepted` — `{ "notification_id": ..., "status": "queued" | "duplicate" | "suppressed" }`.

## Business Logic

1. Look up `dedup_key` in table: notification_log; return `duplicate` if seen in the last 24 h.
2. For `category = marketing`, check table: notification_preferences; return `suppressed` if the user opted out.
3. For `push`, delay delivery to 08:00 local time when outside 08:00–21:00.
4. Render the template and hand off to service: email-provider or service: push-provider.

## External Dependencies

- service: email-provider
- service: push-provider
- table: notification_log
- table: notification_preferences

## Error Handling

| HTTP code | Condition |
|-----------|-----------|
| `400` | Unknown template or channel |
| `401` | Missing or invalid service token |
| `404` | Unknown user |
