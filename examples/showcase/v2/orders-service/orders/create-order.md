---
slug: orders/create-order
domain: orders
entry_type: handler
handler_class: CreateOrderHandler
http_method: POST
route: /api/v1/orders
summary: Creates a delivery order from a valid quote with an optional tip, publishes order.created, waits 10 minutes for payment
category: specification
links:
  - slug: orders/quote-delivery
    type: depends_on
  - slug: events/order-created
    type: references
  - slug: schemas/orders
    type: references
  - slug: jobs/expire-unpaid-orders
    type: related_to
  - slug: payments/on-order-created
    library: billing-service
    type: related_to
  - slug: notifications/on-order-created
    library: notifications-service
    type: related_to
  - slug: gateway/routing
    library: api-gateway
    type: references
---

# CreateOrderHandler

Turns a quote into an order. The order starts in status `created`; payment happens asynchronously in billing-service,
which consumes `order.created` and creates a Paylane payment intent. The app polls `GET /api/v1/orders/{order_id}`
until `payment.client_secret` is available and confirms the payment in the Paylane SDK.

## Request

| Field | Location | Type | Required | Description |
|-------|----------|------|----------|-------------|
| `quote_id` | body | uuid | yes | From `POST /api/v1/orders/quote`, not older than 10 minutes |
| `sender` | body | object | yes | `{ name, phone }` — person handing over the parcel |
| `recipient` | body | object | yes | `{ name, phone }` — person receiving it |
| `pickup_notes` | body | string | no | Max 500 chars, e.g. "3rd floor, ring twice" |
| `dropoff_notes` | body | string | no | Max 500 chars |
| `payment_method_id` | body | string | no | Saved Paylane method; otherwise the app collects one |
| `tip` | body | decimal | no | Courier tip in EUR, 0.00–20.00, max 2 decimals; default `0.00` |
| `Idempotency-Key` | header | string | yes | UUID; same key within 24 h returns the same order |

## Response

`201 Created`

| Field | Type | Description |
|-------|------|-------------|
| `order_id` | uuid | UUID v7 |
| `status` | string | Always `created` |
| `delivery_price` | decimal | The quote's `total` |
| `tip` | decimal | Tip as sent, `0.00` if omitted |
| `total` | decimal | `delivery_price + tip` — the amount charged |
| `currency` | string | `EUR` |
| `expires_at` | timestamp | `created_at + 10 minutes`; unpaid orders expire then |
| `pickup`, `dropoff` | object | Copied from the quote |

## Business Logic

1. Read the customer id from `X-Parcelly-User-Id` (set by the gateway); require role `customer`.
2. Look up `Idempotency-Key` in table: orders (`idempotency_key`, `customer_id`); if found return the stored order with
   `201` (same body). Same key with a different body → `422 idempotency_key_reused`.
3. Load the quote via `IQuoteRepository.findById`. It must exist, belong to this customer or be anonymous, and
   `valid_until > now()`; otherwise `410 quote_expired`.
4. A customer may have at most 5 orders in `created` status at once → else `429 too_many_unpaid_orders`.
5. Validate phones (E.164) and that sender and recipient are not both empty names.
   Validate `tip`: 0.00 ≤ tip ≤ 20.00 with at most 2 decimals, else `422 tip_out_of_range`.
6. In one transaction:
   - insert the order via `IOrderRepository.insert` with `status = created`, `delivery_price = quote.total`,
     `tip`, `total = quote.total + tip`, `expires_at = now() + 10 min`;
   - mark the quote `used_at = now()` (a quote can be used once; reuse → `409 quote_already_used`);
   - insert `order.created` into table: orders_outbox.
7. The outbox relay publishes `order.created` to topic: `parcelly.order-events` within ~200 ms (see `events/order-created`).
   billing-service (`payments/on-order-created`) creates the payment intent for `total` and books `tip` as a courier
   payout; notifications-service
   (`notifications/on-order-created`) sends the confirmation.
8. `jobs/expire-unpaid-orders` expires the order if `payment.captured` has not arrived by `expires_at`.

## External Dependencies

- `IOrderRepository`
- `IQuoteRepository`
- table: orders
- table: quotes
- table: orders_outbox
- topic: `parcelly.order-events`

## Error Handling

| HTTP code | Error | Condition |
|-----------|-------|-----------|
| `400` | `invalid_request` | Missing fields, malformed phone, missing `Idempotency-Key` |
| `401` | `invalid_token` | Not signed in (gateway) |
| `403` | `forbidden_role` | Caller is not a `customer` |
| `404` | `quote_not_found` | Unknown `quote_id` or quote of another customer |
| `409` | `quote_already_used` | Quote already turned into an order |
| `410` | `quote_expired` | Quote older than 10 minutes — request a new quote |
| `422` | `idempotency_key_reused` | Same key, different request body |
| `422` | `tip_out_of_range` | `tip` below 0.00, above 20.00 or with more than 2 decimals |
| `429` | `too_many_unpaid_orders` | 5 orders already waiting for payment |
| `503` | `db_unavailable` | Postgres primary unavailable; nothing was written |
