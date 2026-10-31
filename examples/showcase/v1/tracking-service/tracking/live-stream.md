---
slug: tracking/live-stream
domain: tracking
entry_type: handler
handler_class: LiveStreamGateway
http_method: GET
route: /api/v1/orders/{order_id}/stream
summary: WebSocket stream of courier position and ETA updates for one order, with 20 s heartbeat
category: specification
links:
  - slug: tracking/get-eta
    type: depends_on
  - slug: tracking/ingest-courier-location
    type: depends_on
  - slug: tracking/on-courier-assigned
    type: related_to
  - slug: orders/get-order
    library: orders-service
    type: calls
  - slug: gateway/routing
    library: api-gateway
    type: references
  - slug: gateway/rate-limits
    library: api-gateway
    type: references
  - slug: events/delivery-completed
    library: dispatch-service
    type: related_to
---

# LiveStreamGateway

Upgrades the request to a WebSocket and pushes the courier's position and ETA to the customer's app until the parcel
is delivered. The gateway terminates TLS and verifies the JWT at the edge, then proxies the upgrade to the tracking
service (sticky by `order_id`).

## Request

| Field | Location | Type | Required | Description |
|-------|----------|------|----------|-------------|
| `order_id` | path | uuid | yes | |
| `access_token` | query | JWT | yes | Browsers cannot set headers on WebSocket upgrades; the gateway strips it before logging |
| `Sec-WebSocket-Protocol` | header | string | yes | `parcelly.tracking.v1` |
| `since` | query | timestamp | no | Resume: frames after this time are replayed from a 2-minute buffer |

## Frames (server → client)

| `type` | When | Payload |
|--------|------|---------|
| `snapshot` | Right after connect | Same body as `tracking/get-eta` |
| `position` | At most every 3 s | `{ lat, lng, heading, recorded_at }` |
| `eta.updated` | Every 15 s tick, if ETA changed by ≥ 30 s | `{ eta_pickup_at, eta_dropoff_at, eta_confidence }` |
| `state.changed` | Geofence or pickup confirmation | `{ state }` |
| `courier.changed` | Reassignment | `{ courier: {...} }` |
| `delivered` | `delivery.completed` consumed | `{ delivered_at, proof: photo\|pin }` — then the server closes with code 1000 |
| `ping` | Every 20 s | `{}` — client answers with `pong` |

## Business Logic

1. Authorise like `tracking/get-eta`: customer owns the order (via `orders/get-order` in orders-service) or role `ops`.
2. Reject a 6th concurrent connection for the same order (close code 4429); the oldest connection is kept.
3. Send `snapshot`, then subscribe to Redis channel `tracking:order:{order_id}` and forward frames.
4. Heartbeat: the server sends `ping` every 20 s and closes the socket (code 4408) after 2 missed `pong`s (40 s).
5. A connection lives at most 3 h; the client reconnects with `since` set to the last frame time.
6. If the order has no session yet, the socket stays open with `snapshot.state = awaiting_courier` and receives the
   first frames as soon as `tracking/on-courier-assigned` opens the session.
7. On `order.cancelled` the server sends `state.changed` with `state = cancelled` and closes with code 1000.

## External Dependencies

- Redis: channel `tracking:order:{order_id}`, replay buffer `tracking:replay:{order_id}` (2 min)
- service: orders-service
- table: tracking_sessions

## Error Handling

| Code | Condition |
|------|-----------|
| HTTP `401` | Missing or invalid `access_token` (before upgrade) |
| HTTP `403` | Not the order owner |
| HTTP `404` | Unknown order |
| WS `4408` | Heartbeat timeout |
| WS `4429` | More than 5 connections for the order |
| WS `1012` | Service restart — clients reconnect with jittered backoff 1–10 s |

## Capacity

One pod holds up to 20 000 sockets; at 18 000 it fails readiness so the gateway routes new connections elsewhere.
