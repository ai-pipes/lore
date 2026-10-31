---
slug: tracking/ingest-courier-location
domain: tracking
entry_type: handler
handler_class: IngestCourierLocationHandler
http_method: POST
route: /api/v1/couriers/{courier_id}/location
summary: Accepts batched GPS pings from the courier app every 5 s, filters noise and updates the live position
category: specification
links:
  - slug: tracking/on-courier-assigned
    type: related_to
  - slug: tracking/get-eta
    type: related_to
  - slug: tracking/live-stream
    type: related_to
  - slug: jobs/reassign-stale-assignments
    library: dispatch-service
    type: related_to
  - slug: dispatch/assign-courier
    library: dispatch-service
    type: related_to
  - slug: gateway/rate-limits
    library: api-gateway
    type: references
  - slug: decisions/gateway-auth-at-edge
    library: api-gateway
    type: references
---

# IngestCourierLocationHandler

Receives GPS pings from the courier app. The app sends one request every **5 s** while moving (every 30 s when
stationary for more than 60 s), each carrying 1–10 pings buffered since the last successful request. The latest
position is also what `dispatch/assign-courier` uses to find the nearest free courier.

## Request

| Field | Location | Type | Required | Description |
|-------|----------|------|----------|-------------|
| `courier_id` | path | uuid | yes | Must equal the `sub` of the courier's JWT |
| `pings` | body | array | yes | 1–10 items, ordered by `recorded_at` |
| `pings[].lat` / `lng` | body | number | yes | WGS-84, 6 decimals |
| `pings[].accuracy_m` | body | number | yes | Reported horizontal accuracy |
| `pings[].speed_mps` | body | number | no | Device speed |
| `pings[].heading` | body | number | no | 0–359 |
| `pings[].recorded_at` | body | timestamp | yes | Device time, UTC ISO-8601 |
| `battery_pct` | body | int | no | Used to suggest the low-power mode |

The gateway authenticates the JWT at the edge (role `courier`) and forwards `X-User-Id`; courier location requests are
exempt from the 60 req/min per-user limit and have their own limit of 30 req/min per courier.

## Response

`202 Accepted`

| Field | Type | Description |
|-------|------|-------------|
| `accepted` | int | Pings stored |
| `dropped` | int | Pings rejected by the filters below |
| `next_interval_s` | int | 5, 30 or 60 — server-suggested send interval |

## Business Logic

1. Reject if `courier_id` differs from the authenticated user (`403`).
2. Drop pings with `accuracy_m > 75`, with `recorded_at` more than 2 minutes in the past or 10 s in the future, and
   duplicates of an already stored `(courier_id, recorded_at)`.
3. Drop "teleports": a ping implying a speed above 120 km/h from the previous accepted ping.
4. Bulk-insert accepted pings into table: courier_locations (partitioned by day, retained 30 days).
5. Write the newest ping to Redis `courier:{courier_id}:pos` with TTL 120 s and to the geo index `couriers:geo`.
   Dispatch finds candidates through `GET /internal/couriers/nearby?lat=&lng=&radius_m=`, which returns only
   couriers whose position is fresher than 60 s.
6. If the courier has an open session in table: tracking_sessions, update `last_ping_at`, `distance_to_target_m`
   and `progress_toward_pickup_m`; enter `at_pickup` / `at_dropoff` within 50 m of the target.
7. Publish a lightweight `position` frame on Redis channel `tracking:order:{order_id}`, throttled to one frame per 3 s.
8. Suggest `next_interval_s = 30` if speed < 0.5 m/s for 60 s, `60` if `battery_pct < 15` and the courier is free.

## External Dependencies

- table: courier_locations
- table: tracking_sessions
- Redis: `courier:{courier_id}:pos`, channel `tracking:order:{order_id}`
- service: dispatch-service — reads positions through `GET /internal/couriers/nearby`

## Error Handling

| HTTP code | Condition |
|-----------|-----------|
| `400` | Empty or more than 10 pings, coordinates out of range |
| `401` | Missing or expired JWT (rejected at the gateway) |
| `403` | Token is not a courier or `courier_id` mismatch |
| `429` | More than 30 requests per minute for the courier |
| `503` | Redis unavailable — the app keeps buffering (up to 500 pings) and retries |
