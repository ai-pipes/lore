---
slug: tracking/get-eta
domain: tracking
entry_type: query_handler
handler_class: GetEtaQueryHandler
http_method: GET
route: /api/v1/orders/{order_id}/eta
summary: Returns the courier's position and the pickup and drop-off ETA of an order, recalculated every 15 s
category: specification
links:
  - slug: tracking/on-courier-assigned
    type: depends_on
  - slug: tracking/ingest-courier-location
    type: depends_on
  - slug: tracking/live-stream
    type: related_to
  - slug: orders/get-order
    library: orders-service
    type: calls
  - slug: orders/overview
    library: orders-service
    type: references
  - slug: gateway/routing
    library: api-gateway
    type: references
---

# GetEtaQueryHandler

Returns the current courier position and ETA for an order. Clients that need continuous updates should use
`tracking/live-stream` instead of polling; polling clients must not call this more often than every 15 s, because the
ETA only changes on the recalculation tick.

## Request

| Field | Location | Type | Required | Description |
|-------|----------|------|----------|-------------|
| `order_id` | path | uuid | yes | |
| `Authorization` | header | JWT | yes | Customer who owns the order, or role `ops` |

## Response

`200 OK`

| Field | Type | Description |
|-------|------|-------------|
| `order_id` | uuid | |
| `state` | string | `to_pickup`, `at_pickup`, `to_dropoff`, `at_dropoff`, `delivered` |
| `courier` | object | `{ first_name, vehicle: bike\|scooter\|car, rating }` — no phone number |
| `position` | object | `{ lat, lng, heading, recorded_at }`, rounded to 5 decimals (~1 m) |
| `eta_pickup_at` | timestamp | Null after pickup |
| `eta_dropoff_at` | timestamp | |
| `eta_confidence` | string | `high` (fresh ping < 30 s), `medium` (< 2 min), `low` |
| `calculated_at` | timestamp | Last recalculation tick |

`Cache-Control: max-age=5`. Before a courier is assigned the response is `200` with `state = awaiting_courier` and
no position.

## Business Logic

1. Check ownership: the handler calls `orders/get-order` in orders-service (cached 60 s per order) and compares
   `customer_id` with the caller; ops users skip the check.
2. Load the open session from table: tracking_sessions. If none and the order is `delivered`, return the closed
   session with `state = delivered`.
3. Return the values written by the `EtaCalculator` tick; the handler never calls the routing engine itself.

### ETA calculation (every 15 s per session)

1. Take the last position from Redis `courier:{courier_id}:pos`.
2. Ask service: routing-engine for travel time to the next target by the courier's vehicle profile.
3. Apply the traffic factor for the hour of the day and city zone (table: eta_traffic_factors, 1.00–1.60).
4. Add fixed handling times: 3 min at pickup, 2 min at drop-off.
5. Smooth the result: new ETA = 0.7 × computed + 0.3 × previous, so the displayed time does not jump on GPS noise;
   changes above 5 minutes bypass the smoothing.
6. Store `eta_pickup_at`, `eta_dropoff_at`, `calculated_at`; publish `eta.updated` on `tracking:order:{order_id}`.
7. If the drop-off ETA exceeds the promised delivery window (created_at + 2 h) by 10 min, set `late = true`; the
   notifications service is not involved — the customer app shows the banner.

## External Dependencies

- service: orders-service — ownership check
- service: routing-engine
- table: tracking_sessions
- table: eta_traffic_factors
- Redis: `courier:{courier_id}:pos`

## Error Handling

| HTTP code | Condition |
|-----------|-----------|
| `401` | Missing or expired JWT |
| `403` | Order belongs to another customer |
| `404` | Unknown order |
| `410` | Order cancelled or expired |
| `503` | orders-service unavailable and no cached ownership |
