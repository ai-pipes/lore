---
slug: refunds/issue-refund
domain: refunds
entry_type: handler
handler_class: IssueRefundHandler
http_method: POST
route: /api/v1/refunds
summary: Refunds a captured order payment in full minus the cancellation fee, back to the original payment method
category: specification
links:
  - slug: payments/on-order-cancelled
    type: related_to
  - slug: events/refund-issued
    type: references
  - slug: schemas/payments
    type: references
  - slug: payments/psp-webhook
    type: related_to
  - slug: notifications/on-refund-issued
    library: notifications-service
    type: related_to
  - slug: gateway/routing
    library: api-gateway
    type: references
---

# IssueRefundHandler

Issues a refund for an order. Called internally by `payments/on-order-cancelled`, and over HTTP by support agents and
ops (role `support` or `ops` in the JWT; routed by api-gateway, see `gateway/routing`). Customers cannot call it.

## Request

| Field | Location | Type | Required | Description |
|-------|----------|------|----------|-------------|
| `order_id` | body | uuid | yes | Order whose payment is refunded |
| `reason` | body | string | yes | `order_cancelled`, `delivery_failed`, `parcel_damaged`, `goodwill` |
| `withhold_fee` | body | boolean | no | Default `true` for `order_cancelled` after assignment, `false` otherwise |
| `comment` | body | string | no | Up to 500 characters, stored for audit |
| `Idempotency-Key` | header | string | yes | Same key returns the same refund |

The HTTP API supports full refunds only; there is no `amount` field. The internal call from `payments/on-order-cancelled` passes the `refund_amount` decided by orders-service.

## Response

`202 Accepted` — the refund is created at Paylane; completion arrives by webhook.

| Field | Type | Description |
|-------|------|-------------|
| `refund_id` | uuid | |
| `order_id` | uuid | |
| `amount` | decimal | Refunded EUR amount |
| `fee_withheld` | decimal | `3.00` or `0.00` |
| `status` | string | `pending` |
| `expected_by` | date | Today + 10 business days |

## Business Logic

1. Load the payment from table: payments with `SELECT ... FOR UPDATE`. It must be `captured`.
2. Reject if a refund for the order already exists in table: refunds with status `pending` or `succeeded`.
3. Amount = `captured_amount_cents`, minus `300` if `withhold_fee` is true and the courier was assigned before cancellation.
4. Insert a `refunds` row (`status = pending`), then call service: paylane `POST /v2/refunds` with `payment_intent`, `amount`, `Idempotency-Key = refund:{order_id}`.
5. Set `payments.status = refund_pending`. When the `refund.succeeded` webhook arrives (`payments/psp-webhook`), set `refunds.status = succeeded`, `payments.status = refunded` and publish `refund.issued` to topic: `parcelly.payment-events` (see `events/refund-issued`).
6. Money goes back to the original payment method; banks credit it within 5–10 business days. notifications-service tells the customer.

## External Dependencies

- service: paylane — `POST /v2/refunds`
- table: payments
- table: refunds
- topic: `parcelly.payment-events`

## Error Handling

| HTTP code | Condition |
|-----------|-----------|
| `400` | Unknown `reason`, missing `Idempotency-Key`, `comment` too long |
| `401` | No or invalid JWT |
| `403` | Caller lacks role `support` or `ops` |
| `404` | No payment for `order_id` |
| `409` | Payment not captured, or a refund already exists |
| `502` | Paylane unavailable — the `refunds` row is marked `failed`; retry with the same key |
