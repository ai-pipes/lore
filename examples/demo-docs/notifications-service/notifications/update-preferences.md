---
slug: notifications/update-preferences
domain: notifications
entry_type: handler
handler_class: UpdatePreferencesHandler
http_method: PUT
route: /api/v1/users/{userId}/notification-preferences
summary: Updates which marketing channels a user accepts; transactional messages cannot be disabled
category: specification
---

# UpdatePreferencesHandler

Lets a user opt in or out of marketing e-mails and push notifications.

## Request

| Field | Location | Type | Required | Description |
|-------|----------|------|----------|-------------|
| `userId` | path | uuid | yes | Must be the caller |
| `marketing_email` | body | boolean | no | |
| `marketing_push` | body | boolean | no | |
| `quiet_hours` | body | object | no | `{ "from": "21:00", "to": "08:00" }` |

## Response

`200 OK` — the stored preferences.

## Business Logic

1. Callers can only change their own preferences.
2. Transactional notifications (orders, refunds) cannot be disabled; attempts to set `transactional: false` are rejected.
3. Upsert into table: notification_preferences.

## External Dependencies

- table: notification_preferences

## Error Handling

| HTTP code | Condition |
|-----------|-----------|
| `400` | Invalid quiet hours or `transactional: false` |
| `403` | Changing another user's preferences |
