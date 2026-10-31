---
slug: orders/quote-delivery
domain: orders
entry_type: handler
handler_class: QuoteDeliveryHandler
http_method: POST
route: /api/v1/orders/quote
summary: Prices a delivery between two addresses — 4.90 EUR base plus 0.80 EUR/km, 1.5x surge; quote valid 10 minutes
category: specification
links:
  - slug: orders/create-order
    type: related_to
  - slug: schemas/orders
    type: references
  - slug: dispatch/overview
    library: dispatch-service
    type: calls
  - slug: gateway/rate-limits
    library: api-gateway
    type: related_to
---

# QuoteDeliveryHandler

Calculates the price of a delivery and stores it as a quote. Anonymous users may request quotes (the landing page
price calculator); signed-in customers get the same price. A quote is the only way to obtain a price: `create-order`
never recalculates it.

## Request

| Field | Location | Type | Required | Description |
|-------|----------|------|----------|-------------|
| `pickup` | body | object | yes | `{ line1, postcode, city, lat, lon }` |
| `dropoff` | body | object | yes | Same shape as `pickup` |
| `parcel` | body | object | yes | `{ weight_kg: number, size: "S" \| "M" \| "L" }` |
| `Authorization` | header | string | no | If present, the quote is bound to the customer |

## Response

`200 OK`

| Field | Type | Description |
|-------|------|-------------|
| `quote_id` | uuid | Pass to `POST /api/v1/orders` |
| `distance_km` | decimal | Route distance, 1 decimal |
| `base_price` | decimal | Always `4.90` |
| `distance_price` | decimal | `0.80 × distance_km` |
| `surge_multiplier` | decimal | `1.0` or `1.5` |
| `total` | decimal | `(base_price + distance_price) × surge_multiplier`, rounded half-up to 0.01 |
| `currency` | string | Always `EUR` |
| `estimated_delivery_minutes` | integer | Typical value 60–120 |
| `valid_until` | timestamp | `now() + 10 minutes` |

Example: 6.2 km, no surge → 4.90 + 4.96 = **9.86 EUR**; with surge → **14.79 EUR**.

## Business Logic

1. Validate `parcel.weight_kg` ≤ 20 and size `S`/`M`/`L` (L = max 60×40×40 cm).
2. Check both addresses are inside a served city polygon (Berlin, Hamburg, Munich, Warsaw).
3. Get the route distance from the Google Routes API (bicycle profile, cached 24 h per rounded coordinate pair).
   Distance over 25 km → `422 distance_exceeded`.
4. Ask dispatch-service `GET /internal/couriers/free-count?lat=&lon=&radius_km=3` (timeout 300 ms).
   Fewer than 3 free couriers → `surge_multiplier = 1.5`. If dispatch-service times out, use `1.0` (never surge on
   missing data).
5. Compute the price as above. Insert into table: quotes via `IQuoteRepository.insert` with `valid_until = now() + 10 min`
   and the optional `customer_id`.
6. Return the quote. Quotes are never updated; a new request creates a new quote.

## External Dependencies

- `IQuoteRepository`
- table: quotes
- service: dispatch-service — free courier count
- Google Routes API — `https://routes.googleapis.com/directions/v2:computeRoutes`

## Error Handling

| HTTP code | Error | Condition |
|-----------|-------|-----------|
| `400` | `invalid_request` | Missing addresses, coordinates out of range |
| `422` | `weight_exceeded` | `weight_kg` > 20 |
| `422` | `distance_exceeded` | Route longer than 25 km |
| `422` | `area_not_served` | Pickup or dropoff outside the served cities |
| `429` | `rate_limited` | 600 req/min per IP anonymous, 60 req/min per user (gateway) |
| `503` | `routing_unavailable` | Routes API failed twice (no cached distance) |
