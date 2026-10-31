---
slug: notifications/overview
domain: notifications
entry_type: overview
summary: Notifications service overview — e-mail and push delivery, templates, user preferences
category: architecture
---

# Notifications service

Sends e-mails and push notifications on behalf of other services. Other services either publish domain events that this service consumes, or call `POST /api/v1/notifications` directly.

## Business rules

- Transactional messages (order confirmation, refunds) are always sent by e-mail; marketing messages respect user preferences.
- Push notifications are sent only between 08:00 and 21:00 in the user's time zone; others are delayed.
- Each message is sent at most once per `dedup_key` within 24 hours.

## External Dependencies

- service: email-provider
- service: push-provider
- topic: `petstore.order-events`
- table: notification_log
- table: notification_preferences
