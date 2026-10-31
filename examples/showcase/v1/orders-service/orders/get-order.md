---
slug: orders/get-order
domain: orders
entry_type: query_handler
handler_class: GetOrderQuery
http_method: GET
route: /api/v1/orders/{order_id}
summary: Returns an order with status, price, payment state, assigned courier and cancellation options
category: specification
links:
  - slug: schemas/orders
    type: references
  - slug: orders/cancel-order
    type: related_to
  - slug: payments/capture-payment
    library: billing-service
    type: calls
  - slug: tracking/get-eta
    library: tracking-service
    type: related_to
  - slug: events/courier-assigned
    library: dispatch-service
    type: related_to
---

# GetOrderQuery

Returns one order. The customer app polls it right after creation (until `payment.client_secret` appears) and shows
it on the order screen. Live position and ETA come from tracking-service (`tracking/get-eta`, `tracking/live-stream`),
not from here.

## Request

| Field | Location | Type | Required | Description |
|-------|----------|------|----------|-------------|
| `order_id` | path | uuid | yes | |
| `X-Parcelly-User-Id` | header | uuid | injected | From the gateway |
| `X-Parcelly-Roles` | header | string | injected | `customer` sees own orders; `ops` sees all |

## Response

`200 OK`

| Field | Type | Description |
|-------|------|-------------|
| `order_id` | uuid | |
| `status` | string | `created`, `paid`, `courier_assigned`, `picked_up`, `delivered`, `cancelled`, `expired` |
| `total` | decimal | EUR |
| `pickup`, `dropoff` | object | Addresses |
| `sender`, `recipient` | object | Names and phones (phones masked except last 3 digits for `courier`) |
| `payment` | object | `{ status, client_secret }`; `client_secret` only while `status = created` |
| `courier` | object \| null | `{ courier_id, first_name, vehicle, assigned_at }` once assigned |
| `cancellation` | object | `{ allowed: bool, fee: decimal }` — what `cancel-order` would charge now |
| `expires_at` | timestamp | Only while `status = created` |
| `created_at`, `updated_at` | timestamp | |
| `cancelled_reason` | string \| null | `customer`, `ops`, `payment_timeout` |

## Business Logic

1. Load the order via `IOrderRepository.findById` from table: orders.
2. Customers may read only orders where `customer_id` is their user id; otherwise `404` (not `403`, to avoid leaking ids).
3. While `status = created`, fetch the payment intent from billing-service `GET /internal/payments/by-order/{order_id}`
   (timeout 500 ms). If billing has not created it yet, return `payment.status = pending` and no secret; the app polls
   again after 1 s.
4. Compute `cancellation` with the same `CancellationPolicy` as `orders/cancel-order`:
   `created`/`paid` → `{allowed: true, fee: 0.00}`, `courier_assigned` → `{allowed: true, fee: 3.00}`,
   later states → `{allowed: false}`.
5. Response is not cached (`Cache-Control: no-store`).

## External Dependencies

- `IOrderRepository`
- table: orders
- service: billing-service — payment intent status and client secret

## Error Handling

| HTTP code | Error | Condition |
|-----------|-------|-----------|
| `400` | `invalid_order_id` | Not a UUID |
| `401` | `invalid_token` | Gateway |
| `404` | `order_not_found` | Unknown id or not the caller's order |
| `200` | — | billing-service down: returned with `payment.status = unknown` instead of failing |
