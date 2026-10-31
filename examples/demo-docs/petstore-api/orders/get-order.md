---
slug: orders/get-order
domain: orders
entry_type: query_handler
handler_class: GetOrderHandler
http_method: GET
route: /api/v1/orders/{orderId}
summary: Returns an order with its pets, status history, totals and refund information
category: specification
---

# GetOrderHandler

Returns one order. Customers can only read their own orders; staff can read any.

## Request

| Parameter | Location | Type | Required | Description |
|-----------|----------|------|----------|-------------|
| `orderId` | path | uuid | yes | |

## Response

`200 OK` — `order_id`, `status` (`placed`, `paid`, `delivered`, `cancelled`, `refunded`), `pets[]`, `total`, `delivery`, `status_history[]` (`status`, `at`), `refund` (`amount`, `refunded_at`) when refunded.

## Business Logic

1. Load via `IOrderRepository.getById`.
2. If the caller is not the owner and not staff, respond `404` (not `403`) to avoid leaking order ids.

## External Dependencies

- `IOrderRepository` — reads orders
- table: orders

## Error Handling

| HTTP code | Condition |
|-----------|-----------|
| `404` | Order not found or not visible to the caller |
