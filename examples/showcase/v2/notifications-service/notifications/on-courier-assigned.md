---
slug: notifications/on-courier-assigned
domain: notifications
entry_type: event_handler
handler_class: CourierAssignedNotifier
summary: Consumes courier.assigned and sends an urgent push with courier name and pickup ETA, falling back to SMS
category: specification
links:
  - slug: events/courier-assigned
    library: dispatch-service
    type: depends_on
  - slug: dispatch/assign-courier
    library: dispatch-service
    type: related_to
  - slug: dispatch/reassign-courier
    library: dispatch-service
    type: related_to
  - slug: tracking/get-eta
    library: tracking-service
    type: calls
  - slug: tracking/on-courier-assigned
    library: tracking-service
    type: related_to
  - slug: orders/cancel-order
    library: orders-service
    type: references
  - slug: users/get-profile
    library: identity-service
    type: calls
  - slug: notifications/send-notification
    type: calls
---

# CourierAssignedNotifier

Consumes `courier.assigned` from topic: `parcelly.dispatch-events` (consumer group `notifications-dispatch`) and tells
the customer who is coming and when. This is the only **urgent** notification: it ignores quiet hours and falls back
from push to SMS.

## Input

| Field | Type | Used for |
|-------|------|----------|
| `order_id` | uuid v7 | Dedup key, deep link |
| `assignment_id` | uuid v7 | Dedup key (reassignments notify again) |
| `customer_id` | uuid v7 | Recipient |
| `courier.first_name`, `courier.vehicle` | string | Template |
| `attempt` | int | 1 = first assignment, 2–3 = reassignment |
| `occurred_at` | timestamp | Staleness check |

## Business Logic

1. Ignore events older than 15 minutes — a late "courier assigned" is misleading once the courier may already be at
   the pickup.
2. Wait up to 5 s for the tracking session, then read the pickup ETA from tracking-service (`tracking/get-eta`, service
   token). If it is still unknown, render "in a few minutes" instead of a time.
3. Choose the template: `courier_assigned` for `attempt = 1`, `courier_reassigned` for `attempt ≥ 2`
   ("Your new courier is …").
4. Call `notifications/send-notification`:

   | Parameter | Value |
   |-----------|-------|
   | `channels` | `["push", "sms"]`, `mode = fallback` |
   | `urgency` | `urgent` (sent during quiet hours) |
   | `dedup_key` | `courier.assigned:{order_id}:{assignment_id}` |

5. The push opens the live tracking screen (`parcelly://orders/{order_id}/track`). If no device receipt arrives within
   60 s, the SMS is sent with a short link to the web tracking page.
6. The message reminds the customer that cancelling from now on costs a **3.00 EUR** cancellation fee
   (`orders/cancel-order`); it is shown only for `attempt = 1`.

Example (`en`, push): title "Anna is on the way", body "Pickup around 14:32. Track your parcel live."

## External Dependencies

- topic: `parcelly.dispatch-events`
- service: tracking-service
- service: identity-service
- table: notification_log

## Error Handling

Retries 3 times with backoff 1 s, 2 s, 4 s (kept short because the message is time-sensitive), then queue:
`notifications.dead-letter` with alert `CourierAssignedNotificationFailed` if more than 20 events per 5 minutes fail.
