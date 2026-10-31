---
slug: notifications/on-order-created
domain: notifications
entry_type: event_handler
handler_class: OrderCreatedConsumer
summary: Consumes order.created and e-mails the order confirmation with price breakdown and the 10-minute payment deadline
category: specification
links:
  - slug: events/order-created
    library: orders-service
    type: depends_on
  - slug: orders/create-order
    library: orders-service
    type: related_to
  - slug: orders/quote-delivery
    library: orders-service
    type: references
  - slug: jobs/expire-unpaid-orders
    library: orders-service
    type: related_to
  - slug: payments/on-order-created
    library: billing-service
    type: related_to
  - slug: users/get-profile
    library: identity-service
    type: calls
  - slug: notifications/send-notification
    type: calls
---

# OrderCreatedConsumer

Consumes `order.created` from topic: `parcelly.order-events` (consumer group `notifications-orders`) and sends the
order confirmation e-mail. Billing consumes the same event in parallel to create the payment intent.

## Input

| Field | Type | Used for |
|-------|------|----------|
| `event_id` | uuid v7 | Logged |
| `order_id` | uuid v7 | Dedup key, links |
| `customer_id` | uuid v7 | Recipient |
| `pickup.address`, `dropoff.address` | string | Template |
| `distance_km` | decimal | Template |
| `price` | object | `{ base: 4.90, per_km: 0.80, surge_multiplier, total }`, EUR |
| `payment_expires_at` | timestamp | `created_at + 10 min` |
| `occurred_at` | timestamp | Staleness check |

## Business Logic

1. Ignore events whose `occurred_at` is older than 1 hour (replays after an outage).
2. Call `notifications/send-notification` with:

   | Parameter | Value |
   |-----------|-------|
   | `template` | `order_created` |
   | `channels` | `["email"]` |
   | `urgency` | `normal` (transactional, cannot be opted out of) |
   | `dedup_key` | `order.created:{order_id}` |

3. The template shows the price breakdown (base 4.90 EUR + 0.80 EUR/km × distance, and a "busy-time surcharge ×1.5"
   line when `surge_multiplier = 1.5`), the addresses, and states that unpaid orders are cancelled after 10 minutes.
4. Locale and e-mail come from identity-service (`users/get-profile`); subject lines:
   - `en`: "Your Parcelly order is booked"
   - `de`: "Deine Parcelly-Bestellung ist gebucht"
   - `fr`: "Votre commande Parcelly est enregistrée"
5. Push is **not** sent here — the customer is in the app at checkout. No reminder is sent before expiry; the
   `order.cancelled` with reason `expired` produces no notification either (customer never paid).

## External Dependencies

- topic: `parcelly.order-events`
- service: identity-service
- table: notification_log

## Error Handling

`RecipientUnavailable` and provider failures are retried 5 times with exponential backoff (2 s → 32 s), then the
event goes to queue: `notifications.dead-letter`. A duplicate `dedup_key` is a success (offset committed).
