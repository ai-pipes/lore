---
slug: dispatch/on-order-cancelled
domain: dispatch
entry_type: event_handler
handler_class: OrderCancelledConsumer
summary: Consumes order.cancelled, stops the courier search or releases the assigned courier before pickup
category: specification
links:
  - slug: events/order-cancelled
    library: orders-service
    type: depends_on
  - slug: orders/cancel-order
    library: orders-service
    type: related_to
  - slug: payments/on-order-cancelled
    library: billing-service
    type: related_to
  - slug: schemas/assignments
    type: references
  - slug: dispatch/assign-courier
    type: related_to
---

# OrderCancelledConsumer (dispatch)

Consumes `order.cancelled` from topic: `parcelly.order-events` (consumer group `dispatch-order-events`). Billing
consumes the same event to refund the customer; dispatch only takes care of the courier.

## Input

Event payload as described in orders-service `events/order-cancelled`: `order_id`, `previous_status`, `reason`
(`customer`, `ops`, `payment_timeout`), `courier_id` (set when a courier was assigned), `cancellation_fee`, `fee_waived`.
Orders with `previous_status = created` were never paid and have no assignment.

## Business Logic

1. Lock the active assignment for `order_id` in table: assignments. None -> the order was cancelled before payment; stop.
2. Act by status:

   | Status | Action |
   |--------|--------|
   | `searching` | Set `cancelled`; the assignment loop stops |
   | `offered` | Withdraw the pending offer in table: courier_offers (courier app shows "Order cancelled"), set `cancelled` |
   | `accepted` | Set `cancelled`, free the courier, push "Order cancelled — you will receive the 3.00 EUR cancellation fee" via service: courier-app-push |
   | `picked_up`, `delivered` | Should not happen (orders-service returns `409`); log `cancel_after_pickup` and alert |
   | `cancelled` | Replay, no-op |

3. Publish nothing: `order.cancelled` already tells tracking-service and notifications-service.
4. The 3.00 EUR fee billing withholds after assignment is credited to the released courier in the weekly payout (`assignments.cancellation_fee_cents` = `cancellation_fee` from the event; `0` when `fee_waived`).

## External Dependencies

- topic: `parcelly.order-events`
- service: courier-app-push
- table: assignments
- table: courier_offers

## Error Handling

Retried 5 times with exponential backoff, then queue: `dispatch.dead-letter`. A courier stuck on a cancelled order is
freed after 10 minutes by `jobs/reassign-stale-assignments` at the latest.
