---
slug: events/order-cancelled
domain: orders
entry_type: event
summary: order.cancelled — published when an order is cancelled or expires; drives refunds and releasing the courier
category: specification
links:
  - slug: orders/cancel-order
    type: references
  - slug: jobs/expire-unpaid-orders
    type: references
  - slug: schemas/orders
    type: references
  - slug: payments/on-order-cancelled
    library: billing-service
    type: related_to
  - slug: refunds/issue-refund
    library: billing-service
    type: related_to
  - slug: dispatch/on-order-cancelled
    library: dispatch-service
    type: related_to
---

# OrderCancelled

Published by `CancelOrderHandler` (customer or ops cancellation) and by `ExpireUnpaidOrdersJob` (unpaid for 15 minutes)
through the transactional outbox (table: orders_outbox).

## Payload

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `event_id` | uuid | yes | UUID v7 |
| `event_type` | string | yes | Always `"order.cancelled"` |
| `occurred_at` | timestamp | yes | |
| `order_id` | uuid | yes | |
| `customer_id` | uuid | yes | |
| `previous_status` | string | yes | `created`, `paid` or `courier_assigned` |
| `reason` | string | yes | `customer`, `ops`, `payment_timeout` |
| `total` | decimal | yes | Order total, EUR |
| `cancellation_fee` | decimal | yes | `0.00` or `3.00` (only when `previous_status = courier_assigned` and not waived) |
| `refund_amount` | decimal | yes | `total − cancellation_fee` if paid, else `0.00` |
| `courier_id` | uuid | no | Present when `previous_status = courier_assigned` |
| `fee_waived` | boolean | yes | `true` if ops waived the fee |

## Published to

topic: `parcelly.order-events`, partition key `order_id`.

## Known consumers

| Service | Handler | What it does |
|---------|---------|-------------|
| billing-service | `payments/on-order-cancelled` | `previous_status = created`: cancels the payment intent. Otherwise calls `refunds/issue-refund` for `refund_amount` and keeps the fee; publishes `refund.issued` |
| dispatch-service | `dispatch/on-order-cancelled` | Releases the courier (`courier_id`) and stops the assignment search |
| tracking-service | — | Closes open live-stream connections for the order |
| notifications-service | — | No direct consumer; the customer is notified via `refund.issued` (`notifications/on-refund-issued`) |

## Notes

- Expired orders publish this event with `reason = payment_timeout`, `previous_status = created` and zero amounts;
  the order's own status is `expired`, not `cancelled`.
- Consumers must not recompute the fee: `cancellation_fee` in the event is authoritative.
