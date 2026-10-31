---
slug: payments/capture-payment
domain: payments
entry_type: service
handler_class: CapturePaymentService
summary: Captures an authorised Paylane intent including the courier tip and publishes payment.captured, which starts courier dispatch
category: implementation
links:
  - slug: payments/psp-webhook
    type: related_to
  - slug: events/payment-captured
    type: references
  - slug: schemas/payments
    type: references
  - slug: dispatch/on-payment-captured
    library: dispatch-service
    type: related_to
  - slug: orders/get-order
    library: orders-service
    type: related_to
  - slug: ops/stuck-orders
    library: orders-service
    type: related_to
---

# CapturePaymentService

Internal service called by `payments/psp-webhook` when Paylane reports `payment_intent.authorized`. Parcelly captures
immediately: the courier is only searched for once the money is captured.

## Input

| Field | Type | Description |
|-------|------|-------------|
| `order_id` | uuid | Order to capture |
| `psp_intent_id` | string | Paylane intent id |
| `authorized_amount_cents` | integer | Amount Paylane authorised |

## Business Logic

1. Load the payment from table: payments; it must be `authorized` (set by the webhook). `captured` -> return the existing result (idempotent).
2. Check `authorized_amount_cents == payments.amount_cents + payments.tip_cents`. A mismatch is never captured: set `status = amount_mismatch` and alert.
3. Check the order is still open via service: orders-service `GET /internal/orders/{order_id}/status`. If it is `expired` or `cancelled`, void the intent (`POST /v2/payment_intents/{id}/cancel`) instead of capturing and stop.
4. Capture: `POST /v2/payment_intents/{id}/capture` with `Idempotency-Key = capture:{order_id}`. Timeout 5 s.
5. In one transaction: set `payments.status = captured`, `captured_at`, `captured_amount_cents` (delivery price plus tip), and write the `payment.captured` event to the outbox table: billing_outbox.
6. From now on billing's `GET /internal/payments/by-order/{order_id}` reports `captured` to orders-service, even before the event arrives.
7. The outbox relay publishes `payment.captured` to topic: `parcelly.payment-events` with key `order_id` (see `events/payment-captured`). Consumers: dispatch-service and orders-service.

## Tips

The tip is captured in the same Paylane capture as the delivery price; there is no separate charge. Paylane splits
it at payout time: the tip goes in full to the courier who delivers the order (marketplace transfer in the weekly
courier payout), the delivery price to Parcelly. If the order is reassigned, the tip goes to the courier who
completes the delivery.

## External Dependencies

- service: paylane — capture and cancel
- service: orders-service — order status check
- table: payments
- table: billing_outbox
- topic: `parcelly.payment-events`

## Error Handling

| Condition | Behaviour |
|-----------|-----------|
| Paylane capture timeout | Retry up to 3 times with the same idempotency key; then leave `authorized` and let `ops/stuck-orders` (orders-service) pick it up |
| Paylane `intent_expired` | `status = expired`, publish `payment.failed` with reason `expired` |
| Order already cancelled | Void intent, no event |
| Amount mismatch | `status = amount_mismatch`, page billing on-call, no capture |

Metric: `billing_capture_seconds`, alert when p99 > 3 s for 10 min.
