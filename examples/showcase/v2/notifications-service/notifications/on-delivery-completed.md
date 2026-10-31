---
slug: notifications/on-delivery-completed
domain: notifications
entry_type: event_handler
handler_class: DeliveryCompletedNotifier
summary: Consumes delivery.completed and sends a delivery push plus an e-mail receipt with proof of delivery and rating link
category: specification
links:
  - slug: events/delivery-completed
    library: dispatch-service
    type: depends_on
  - slug: tracking/live-stream
    library: tracking-service
    type: related_to
  - slug: orders/get-order
    library: orders-service
    type: calls
  - slug: events/payment-captured
    library: billing-service
    type: references
  - slug: users/get-profile
    library: identity-service
    type: calls
  - slug: notifications/send-notification
    type: calls
---

# DeliveryCompletedNotifier

Consumes `delivery.completed` from topic: `parcelly.dispatch-events` and confirms the delivery to the customer: a push
right away and an e-mail receipt with the proof of delivery.

## Input

| Field | Type | Used for |
|-------|------|----------|
| `order_id` | uuid v7 | Dedup key, receipt |
| `customer_id` | uuid v7 | Recipient |
| `courier_id` | uuid v7 | Rating link |
| `delivered_at` | timestamp | Template |
| `proof` | object | `{ type: photo\|pin\|signature, photo_url? }` — photo URL is signed, valid 7 days |
| `recipient_name` | string | Who accepted the parcel, if not the customer |
| `occurred_at` | timestamp | Staleness check |

## Business Logic

1. Ignore events older than 24 hours.
2. Load the order from orders-service (`orders/get-order`) for the final price, distance and addresses; the amount is
   the one captured by billing (`payment.captured`), including any surge.
3. Send two messages through `notifications/send-notification`:

   | Message | Template | Channels | Urgency | `dedup_key` |
   |---------|----------|----------|---------|-------------|
   | Delivered push | `delivery_completed` | `["push"]` | `normal` | `delivery.completed:{order_id}:push` |
   | Receipt e-mail | `delivery_receipt` | `["email"]` | `normal` | `delivery.completed:{order_id}:receipt` |

4. During quiet hours the push is dropped by the sender (normal urgency), the receipt e-mail is still sent.
5. The receipt contains the price breakdown, `delivered_at` in the user's time zone, the proof photo (if any) and a
   rating link valid for 7 days. VAT is shown as included (19 %).
6. If `recipient_name` differs from the customer's name, the push says "Delivered — accepted by {recipient_name}".

## External Dependencies

- topic: `parcelly.dispatch-events`
- service: orders-service
- service: identity-service
- table: notification_log

## Error Handling

Retried 5 times with exponential backoff (2 s → 32 s), then queue: `notifications.dead-letter`. If orders-service is
unavailable the push is still sent (it needs no price) and the receipt is retried separately.
