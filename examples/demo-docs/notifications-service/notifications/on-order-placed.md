---
slug: notifications/on-order-placed
domain: notifications
entry_type: event_handler
handler_class: OrderPlacedConsumer
summary: Consumes order.placed and e-mails the customer an order confirmation with the payment link
category: specification
links:
  - slug: events/order-placed
    library: petstore-api
    type: depends_on
  - slug: notifications/send-notification
    type: calls
---

# OrderPlacedConsumer

Consumes `order.placed` events from topic: `petstore.order-events` and sends the order confirmation.

## Input

Event payload as described in the Petstore `events/order-placed` document: `order_id`, `customer_id`, `pet_ids`, `total`, `expires_at`.

## Business Logic

1. Ignore events older than 1 hour (replays after an outage).
2. Load the customer's e-mail and locale from service: accounts-service.
3. Render template `order_confirmation` with the pets, total and payment link; the e-mail states that the reservation expires at `expires_at` (30 minutes after placing the order).
4. Send through `notifications/send-notification` with `dedup_key = order.placed:{order_id}`.
5. If the order has home delivery, also schedule a push reminder 10 minutes before `expires_at` if still unpaid.

## External Dependencies

- topic: `petstore.order-events`
- service: accounts-service
- table: notification_log

## Error Handling

Failures are retried 5 times with exponential backoff, then the event goes to queue: `notifications.dead-letter`.
