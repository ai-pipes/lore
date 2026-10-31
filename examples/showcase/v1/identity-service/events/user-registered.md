---
slug: events/user-registered
domain: users
entry_type: event
summary: user.registered — published once when a new Parcelly account is created, used for welcome messages and analytics
category: specification
links:
  - slug: auth/sign-in
    type: references
  - slug: schemas/users
    type: references
  - slug: notifications/send-notification
    library: notifications-service
    type: related_to
  - slug: notifications/overview
    library: notifications-service
    type: related_to
---

# UserRegistered

Published by `SignInHandler` when a phone OTP sign-in creates a new customer, and by the ops courier-onboarding tool
when a courier account is created. Delivery is at-least-once through the transactional outbox (table: identity_outbox).

## Payload

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `event_id` | uuid | yes | UUID v7, deduplication key for consumers |
| `event_type` | string | yes | Always `"user.registered"` |
| `occurred_at` | timestamp | yes | UTC ISO-8601 |
| `user_id` | uuid | yes | |
| `role` | string | yes | `customer` or `courier` |
| `phone` | string | yes | E.164 |
| `email` | string | no | Only if given at registration |
| `locale` | string | yes | From the app's `Accept-Language`, default `en-GB` |
| `signup_channel` | string | yes | `ios`, `android`, `web`, `ops_console` |
| `marketing_opt_in` | boolean | yes | |

Example:

```json
{
  "event_id": "01929a4e-7c3f-7b52-9d1e-3f0a2b6c8d11",
  "event_type": "user.registered",
  "occurred_at": "2026-10-31T09:14:02Z",
  "user_id": "01929a4e-7c3a-7f00-8a1b-1c2d3e4f5a6b",
  "role": "customer",
  "phone": "+4915112345678",
  "locale": "de-DE",
  "signup_channel": "ios",
  "marketing_opt_in": false
}
```

## Published to

topic: `parcelly.identity-events`, partition key `user_id`, retention 7 days.

## Known consumers

| Service | What it does |
|---------|-------------|
| notifications-service | Sends the welcome push/e-mail (customers) or onboarding SMS (couriers) |
| dispatch-service | Creates the courier record in its roster when `role = courier` |
| analytics (Snowplow sink) | Funnel metrics |

## Notes

- The event never contains the password hash or OTP.
- PII fields (`phone`, `email`) are removed from the topic by compaction after GDPR erasure; consumers must not store them
  longer than needed.
