---
slug: payments/on-order-created
domain: payments
entry_type: event_handler
handler_class: OrderCreatedConsumer
summary: Consumes order.created and creates a manual-capture Paylane payment intent that expires with the order after 15 minutes
category: specification
links:
  - slug: events/order-created
    library: orders-service
    type: depends_on
  - slug: orders/create-order
    library: orders-service
    type: related_to
  - slug: jobs/expire-unpaid-orders
    library: orders-service
    type: related_to
  - slug: schemas/payments
    type: references
  - slug: payments/psp-webhook
    type: related_to
  - slug: decisions/psp-choice
    type: references
---

# OrderCreatedConsumer

Consumes `order.created` from topic: `parcelly.order-events` (consumer group `billing-order-events`) and opens a payment
intent at service: paylane so the customer can pay on the checkout screen.

## Input

Event payload as described in orders-service `events/order-created`:

| Field | Type | Used for |
|-------|------|----------|
| `order_id` | uuid (v7) | Idempotency and `payments.order_id` |
| `customer_id` | uuid (v7) | Paylane customer lookup |
| `total` | decimal (EUR) | Intent amount |
| `price.currency` | string | Must be `EUR` |
| `created_at` | timestamp | Intent expiry = `created_at + 15 min` |
| `payment_method_id` | string, optional | Saved Paylane payment method |

## Business Logic

1. Skip events whose `created_at` is more than 15 minutes old: the order is already expired by `jobs/expire-unpaid-orders`.
2. Look up table: payments by `order_id`. If a row exists, the event is a replay — re-send the existing `client_secret` (step 6) and stop.
3. Validate the amount: currency `EUR`, total between 4.90 and 37.35 EUR. Out-of-range totals go to queue: `billing.dead-letter` with reason `price_out_of_range` and page the billing on-call.
4. Convert to integer cents and create the intent: `POST /v2/payment_intents` with `amount`, `currency=eur`, `capture_method=manual`, `metadata.order_id`, `expires_at = created_at + 15 min`. The Paylane `Idempotency-Key` is `intent:{order_id}`.
5. Insert a `payments` row with `status = requires_authorization`, `psp_intent_id`, `amount_cents`, `expires_at`.
6. Hand the `client_secret` to orders-service (`PUT /internal/orders/{order_id}/payment`), which returns it in `orders/get-order` to the checkout screen.

## External Dependencies

- topic: `parcelly.order-events`
- service: paylane — `POST /v2/payment_intents`
- service: orders-service — `PUT /internal/orders/{order_id}/payment`
- table: payments

## Error Handling

| Condition | Behaviour |
|-----------|-----------|
| Paylane 5xx or timeout (3 s) | Retry 5 times with exponential backoff (0.5, 1, 2, 4, 8 s), then queue: `billing.dead-letter` |
| Paylane 4xx `amount_invalid` | No retry; dead letter with reason `psp_rejected` |
| orders-service unavailable | Retry step 6 only; the intent is not recreated thanks to the idempotency key |
| Duplicate event | No-op (step 2) |

Metrics: `billing_intents_created_total`, `billing_intent_create_seconds` (histogram).
