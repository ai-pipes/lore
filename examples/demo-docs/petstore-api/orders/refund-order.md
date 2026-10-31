---
slug: orders/refund-order
domain: orders
entry_type: handler
handler_class: RefundOrderHandler
http_method: POST
route: /api/v1/orders/{orderId}/refund
summary: Refunds the adoption fees of a delivered order within 14 days; the delivery fee is kept
category: specification
links:
  - slug: notifications/send-notification
    library: notifications-service
    type: calls
---

# RefundOrderHandler

Refunds a delivered order, for example when the adoption does not work out. Refunds are asynchronous: the endpoint accepts the request and the money arrives when the payment gateway confirms.

## Request

| Field | Location | Type | Required | Description |
|-------|----------|------|----------|-------------|
| `orderId` | path | uuid | yes | |
| `reason` | body | string | yes | `pet_returned`, `health_issue`, `other` |
| `comment` | body | string | no | Max 1000 characters |

## Response

`202 Accepted` — `{ "order_id": ..., "refund_amount": ..., "status": "refund_pending" }`.

## Business Logic

1. Only the owner may request a refund; staff may refund on behalf of a customer.
2. The order must be `delivered`, and `now() - delivered_at` must be at most **14 days**.
3. Refund amount = sum of adoption fees. The delivery fee (15.00) is **not** refunded. For `reason = health_issue` the delivery fee is refunded too.
4. Request the refund from service: payments-gateway with the order's payment id. The gateway calls back `POST /internal/payments/refund-confirmed`, which sets the order to `refunded`.
5. Returned pets are set to `status = available` after a staff health check (manual, outside this endpoint).
6. Ask service: notifications-service to send the "refund requested" e-mail (`POST /api/v1/notifications`, template `refund_requested`).

## External Dependencies

- `IOrderRepository` — reads and updates orders
- service: payments-gateway — issues the refund
- service: notifications-service — customer e-mail
- table: orders

## Error Handling

| HTTP code | Condition |
|-----------|-----------|
| `404` | Order not found |
| `409` | Order not delivered, already refunded, or older than 14 days |
| `502` | Payment gateway rejected the refund; nothing changed |
