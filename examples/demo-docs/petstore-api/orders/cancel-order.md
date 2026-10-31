---
slug: orders/cancel-order
domain: orders
entry_type: handler
handler_class: CancelOrderHandler
http_method: POST
route: /api/v1/orders/{orderId}/cancel
summary: Cancels an unpaid or paid-but-undelivered order and releases the reserved pets
category: specification
links:
  - slug: orders/refund-order
    type: related_to
---

# CancelOrderHandler

Cancels an order before delivery. Unpaid orders are simply cancelled; paid orders are cancelled and refunded in full, including the delivery fee.

## Request

| Field | Location | Type | Required | Description |
|-------|----------|------|----------|-------------|
| `orderId` | path | uuid | yes | |
| `reason` | body | string | no | Free text, max 500 characters |

## Response

`200 OK` — the order with `status = cancelled` (or `refunded` if a payment was captured).

## Business Logic

1. Only the owner or staff may cancel.
2. Allowed only in `placed` or `paid`. Delivered orders must use `orders/refund-order`.
3. Set pets back to `available`, clear `reserved_until`.
4. If paid, call service: payments-gateway to refund the full `total`.
5. Publish `order.cancelled` to topic: `petstore.order-events`.

## External Dependencies

- `IOrderRepository`, `IPetRepository`
- service: payments-gateway
- topic: `petstore.order-events`
- table: orders

## Error Handling

| HTTP code | Condition |
|-----------|-----------|
| `404` | Order not found |
| `409` | Order already delivered, cancelled or refunded |
