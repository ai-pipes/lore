---
slug: notifications/send-notification
domain: notifications
entry_type: service
handler_class: NotificationSender
summary: Internal sender — applies preferences, quiet hours, dedup, locale templates and channel fallbacks, logs every attempt
category: implementation
links:
  - slug: schemas/notification-log
    type: depends_on
  - slug: users/get-profile
    library: identity-service
    type: calls
  - slug: schemas/users
    library: identity-service
    type: references
  - slug: notifications/overview
    type: references
---

# NotificationSender

The single internal entry point used by every consumer. It never throws for a business reason (opt-out, quiet hours,
duplicate); it returns a result and records it in table: notification_log.

## Input

```ts
send({
  user_id: string,            // uuid v7
  template: string,           // e.g. "courier_assigned"
  channels: Channel[],        // ordered: ["push", "sms"]
  urgency: "urgent" | "normal" | "low",
  dedup_key: string,          // e.g. "courier.assigned:{order_id}:{assignment_id}"
  variables: Record<string, unknown>,
  order_id?: string,
  mode?: "fallback" | "all",  // fallback = stop at first delivered channel (default)
})
```

## Business Logic

1. **Dedup**: insert a `pending` row with `dedup_key`; the unique index on `(dedup_key)` (7-day window, older rows
   are archived) makes a duplicate return `skipped_duplicate` without sending.
2. **Recipient**: load e-mail, phone, push tokens, locale, time zone and preferences from identity-service
   (internal variant of `users/get-profile`: `GET /internal/users/{user_id}` with a service token); cache 10 min in
   Redis. The profile locale (`de-DE`, `en-GB`, …) is reduced to its language; `notification_preferences` is
   `{ email, push, sms }`.
3. **Preferences**: drop channels the user opted out of. Transactional e-mail (`order_created`, `refund_issued`)
   cannot be opted out of. If no channel remains: `skipped_opt_out`.
4. **Quiet hours** (22:00–08:00 local time):

   | Urgency | During quiet hours |
   |---------|--------------------|
   | `urgent` | Sent as usual |
   | `normal` | Push and SMS removed, e-mail sent |
   | `low` | Whole message deferred to 08:00 local (`status = deferred`, picked up by the deferred worker every minute) |

5. **Template**: render `templates/{template}/{locale}.{channel}` with locale in `en`, `de`, `fr`; unknown locale or
   missing file falls back to `en`. SMS bodies are cut at 160 GSM-7 characters; push titles at 50.
6. **Send** through the channel providers in order:

   | Channel | Provider | Timeout | Delivered when |
   |---------|----------|---------|----------------|
   | `email` | service: mailwave | 5 s | Provider accepted (bounce webhook may later mark `bounced`) |
   | `push` | service: fcm / service: apns | 3 s | Device receipt within 60 s |
   | `sms` | service: textora | 5 s | DLR `delivered` |

   In `fallback` mode the next channel is tried when the previous one fails or, for push, when no receipt arrives
   within 60 s. In `all` mode every channel is sent.
7. **Limits**: SMS is skipped (`skipped_rate_limited`) after 1 SMS per order per 10 min or 5 per user per day.
8. Update the log row with `status`, `channel`, `provider_message_id`, `attempts` and a masked recipient
   (`j***@example.com`, `+49 *** ** 12`).

## Result statuses

`sent`, `delivered`, `failed`, `bounced`, `deferred`, `skipped_duplicate`, `skipped_opt_out`, `skipped_rate_limited`.

## External Dependencies

- service: identity-service
- service: mailwave, service: fcm, service: apns, service: textora
- table: notification_log
- Redis: `notif:recipient:{user_id}` (10 min), `notif:sms-limit:{user_id}`

## Error Handling

Provider 5xx and timeouts are retried 3 times (200 ms, 1 s, 5 s) per channel before falling back. Invalid push tokens
(`UNREGISTERED`) are reported to identity-service for removal. If identity-service is down and no cached recipient
exists, the call fails with `RecipientUnavailable`, and the consumer retries the event.
