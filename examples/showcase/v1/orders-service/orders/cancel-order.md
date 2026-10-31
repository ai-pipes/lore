---
slug: orders/cancel-order
domain: orders
entry_type: handler
handler_class: CancelOrderHandler
http_method: POST
route: /api/v1/orders/{order_id}/cancel
summary: Cancels an order — free before courier assignment, 3.00 EUR fee after, impossible after pickup
category: specification
links:
  - slug: events/order-cancelled
    type: references
  - slug: schemas/orders
    type: references
  - slug: orders/get-order
    type: related_to
  - slug: payments/on-order-cancelled
    library: billing-service
    type: related_to
  - slug: refunds/issue-refund
    library: billing-service
    type: related_to
  - slug: dispatch/on-order-cancelled
    library: dispatch-service
    type: related_to
  - slug: notifications/on-refund-issued
    library: notifications-service
    type: related_to
---

# CancelOrderHandler

Cancels an order on behalf of the customer or ops. The handler only changes the order and publishes
`order.cancelled`; the refund (billing-service) and releasing the courier (dispatch-service) happen asynchronously.

## Request

| Field | Location | Type | Required | Description |
|-------|----------|------|----------|-------------|
| `order_id` | path | uuid | yes | |
| `reason` | body | string | no | Free text, max 300 chars, stored for analytics |
| `waive_fee` | body | boolean | no | `ops` only: cancel without the fee (courier no-show, our fault) |

## Response

`200 OK`

| Field | Type | Description |
|-------|------|-------------|
| `order_id` | uuid | |
| `status` | string | Always `cancelled` |
| `cancellation_fee` | decimal | `0.00` or `3.00` |
| `refund_amount` | decimal | `total − cancellation_fee`; `0.00` for unpaid orders |
| `refund_eta` | string | `"5-10 business days"` when `refund_amount > 0` |

## Cancellation policy

| Status at cancellation | Allowed | Fee | Refund |
|------------------------|---------|-----|--------|
| `created` (unpaid) | yes | 0.00 | none — payment intent is cancelled |
| `paid` | yes | 0.00 | full `total` |
| `courier_assigned` | yes | **3.00 EUR** | `total − 3.00` |
| `picked_up` | **no** (`409`) | — | — |
| `delivered`, `cancelled`, `expired` | **no** (`409`) | — | — |

## Business Logic

1. Load the order with `SELECT ... FOR UPDATE` from table: orders via `IOrderRepository.findByIdForUpdate`.
2. Customers may cancel only their own orders (`404` otherwise); `ops` may cancel any.
3. Apply `CancellationPolicy.evaluate(order)` per the table above. `picked_up` or later → `409 cancellation_not_allowed`.
4. Fee: `3.00` if `status = courier_assigned`, else `0.00`. `waive_fee = true` from an `ops` caller sets it to `0.00`;
   from a customer → `403`.
5. The fee never exceeds the order total: `fee = min(3.00, total)` (all real totals are ≥ 4.90).
6. In one transaction: set `status = cancelled`, `cancelled_at = now()`, `cancelled_by`, `cancellation_fee`,
   `cancelled_reason = customer | ops`; insert `order.cancelled` into table: orders_outbox.
7. The relay publishes to topic: `parcelly.order-events` (see `events/order-cancelled`). Consumers:
   billing-service `payments/on-order-cancelled` → `refunds/issue-refund` (refund minus fee, 5–10 business days,
   then `refund.issued`), dispatch-service `dispatch/on-order-cancelled` releases the courier.
8. A repeated cancel of an already `cancelled` order by the same caller returns `200` with the stored values
   (idempotent), not `409`.

## External Dependencies

- `IOrderRepository`
- table: orders
- table: orders_outbox
- topic: `parcelly.order-events`

## Error Handling

| HTTP code | Error | Condition |
|-----------|-------|-----------|
| `400` | `invalid_request` | Reason too long |
| `401` | `invalid_token` | Gateway |
| `403` | `fee_waiver_not_allowed` | `waive_fee` sent by a customer |
| `404` | `order_not_found` | Unknown order or another customer's order |
| `409` | `cancellation_not_allowed` | Parcel already picked up, delivered, or order expired |
| `409` | `concurrent_update` | Lock timeout (2 s) — another transition in progress; retry |
