---
slug: orders/place-order
domain: orders
entry_type: handler
handler_class: PlaceOrderHandler
http_method: POST
route: /api/v1/orders
summary: Places an adoption order for up to 3 available pets and reserves them for 30 minutes
category: specification
links:
  - slug: events/order-placed
    type: references
  - slug: schemas/orders
    type: references
  - slug: jobs/expire-unpaid-orders
    type: related_to
  - slug: notifications/on-order-placed
    library: notifications-service
    type: related_to
---

# PlaceOrderHandler

Creates an adoption order, reserves the pets and starts the payment. The customer must be signed in.

## Request

| Field | Location | Type | Required | Description |
|-------|----------|------|----------|-------------|
| `pet_ids` | body | uuid[] | yes | 1–3 pets |
| `delivery` | body | object | no | `{ "address": string, "date": date }`; pickup if omitted |
| `Idempotency-Key` | header | string | yes | Repeated requests with the same key return the same order |

## Response

`201 Created`

| Field | Type | Description |
|-------|------|-------------|
| `order_id` | uuid | |
| `status` | string | Always `placed` |
| `total` | decimal | Sum of adoption fees plus delivery fee |
| `payment_url` | string | Hosted payment page |
| `expires_at` | timestamp | `created_at + 30 minutes` |

## Business Logic

1. Reject more than 3 pets or duplicate ids.
2. In one transaction, lock the pets (`SELECT ... FOR UPDATE` on table: pets) and check each is `available`.
3. Set each pet to `reserved` with `reserved_until = now() + 30 min`.
4. Compute `total`: adoption fees + delivery fee (flat 15.00 for home delivery, free pickup). Orders of 3 pets get a 10% discount on adoption fees.
5. Insert the order via `IOrderRepository.insert` with `status = placed`.
6. Create a payment session via service: payments-gateway.
7. Publish `order.placed` to topic: `petstore.order-events` (see `events/order-placed`). The notifications service sends the confirmation e-mail.

## External Dependencies

- `IOrderRepository` — persists orders
- `IPetRepository` — reserves pets
- service: payments-gateway — creates the payment session
- topic: `petstore.order-events`
- table: orders
- table: pets

## Error Handling

| HTTP code | Condition |
|-----------|-----------|
| `400` | No pets, more than 3 pets, duplicate ids, missing `Idempotency-Key` |
| `401` | Not signed in |
| `409` | A pet is not `available` (response lists the conflicting `pet_ids`) |
| `502` | Payment gateway unavailable — reservation is rolled back |
