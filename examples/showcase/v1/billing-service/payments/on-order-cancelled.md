---
slug: payments/on-order-cancelled
domain: payments
entry_type: event_handler
handler_class: OrderCancelledConsumer
summary: Consumes order.cancelled, cancels an unpaid intent or refunds a captured payment minus the 3.00 EUR fee after assignment
category: specification
links:
  - slug: events/order-cancelled
    library: orders-service
    type: depends_on
  - slug: orders/cancel-order
    library: orders-service
    type: related_to
  - slug: jobs/expire-unpaid-orders
    library: orders-service
    type: related_to
  - slug: refunds/issue-refund
    type: calls
  - slug: schemas/payments
    type: references
  - slug: dispatch/on-order-cancelled
    library: dispatch-service
    type: related_to
---

# OrderCancelledConsumer

Consumes `order.cancelled` from topic: `parcelly.order-events` (consumer group `billing-order-events`) and settles the
money for a cancelled order. Dispatch consumes the same event in parallel to release the courier.

## Input

Event payload as described in orders-service `events/order-cancelled`:

| Field | Type | Description |
|-------|------|-------------|
| `order_id` | uuid | |
| `previous_status` | string | `created`, `paid` or `courier_assigned` |
| `reason` | string | `customer`, `ops` or `payment_timeout` |
| `cancellation_fee` | decimal | Fee decided by orders-service: `3.00` or `0.00` |
| `refund_amount` | decimal | Amount to give back, computed by orders-service |
| `courier_id` | uuid, nullable | Set when a courier had been assigned |
| `fee_waived` | boolean | `true` for ops cancellations |
| `cancelled_at` | timestamp | |

Cancellations after pickup never reach billing: orders-service rejects them with `409`.

## Business Logic

1. Load the payment from table: payments by `order_id`. No row -> the order was cancelled before the intent existed; nothing to do.
2. `previous_status = created` (unpaid order: customer gave up or `reason = payment_timeout` from `jobs/expire-unpaid-orders`): cancel the payment intent at Paylane (`POST /v2/payment_intents/{id}/cancel`), set `status = voided`. No fee is ever charged on an uncaptured payment. If the payment turns out to be `captured` (webhook raced the expiry), refund the full captured amount instead.
3. Otherwise the payment must be `captured`. `refunded`, `refund_pending`, `voided`, `expired`, `failed` -> no-op (replay).
4. Cross-check: `refund_amount` must equal `captured_amount - cancellation_fee` (to the cent). A mismatch goes to queue: `billing.dead-letter` with reason `refund_mismatch` and pages billing on-call — billing never invents its own amount.
5. Call `refunds/issue-refund` internally with `amount = refund_amount`, `reason = order_cancelled`, `Idempotency-Key = cancel:{order_id}`.
6. Record `cancellation_fee` in `payments.fee_cents`; the fee stays with Parcelly and is paid out to the courier `courier_id` in the weekly payout. Ops cancellations carry `fee_waived = true` and a fee of `0.00`.

Example: an order of 12.10 EUR (4.90 + 9 km x 0.80) cancelled by the customer after assignment arrives with `cancellation_fee = 3.00`, `refund_amount = 9.10`.

## External Dependencies

- topic: `parcelly.order-events`
- service: paylane — cancel intent
- table: payments
- queue: `billing.dead-letter`

## Error Handling

Failures are retried 5 times with exponential backoff (1 s to 16 s), then the event goes to queue: `billing.dead-letter`
and billing on-call is paged: a customer is waiting for money.
