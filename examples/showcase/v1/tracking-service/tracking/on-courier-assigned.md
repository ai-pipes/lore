---
slug: tracking/on-courier-assigned
domain: tracking
entry_type: event_handler
handler_class: CourierAssignedConsumer
summary: Consumes courier.assigned and opens a tracking session with the first pickup ETA for the order
category: specification
links:
  - slug: events/courier-assigned
    library: dispatch-service
    type: depends_on
  - slug: events/delivery-completed
    library: dispatch-service
    type: depends_on
  - slug: events/order-cancelled
    library: orders-service
    type: depends_on
  - slug: dispatch/assign-courier
    library: dispatch-service
    type: related_to
  - slug: dispatch/reassign-courier
    library: dispatch-service
    type: related_to
  - slug: schemas/assignments
    library: dispatch-service
    type: references
  - slug: tracking/get-eta
    type: calls
  - slug: tracking/live-stream
    type: related_to
  - slug: tracking/ingest-courier-location
    type: related_to
  - slug: notifications/on-courier-assigned
    library: notifications-service
    type: related_to
---

# CourierAssignedConsumer

Consumes `courier.assigned` from topic: `parcelly.dispatch-events` and opens a tracking session for the order. The
same consumer group (`tracking-sessions`) also handles `delivery.completed` and, from topic: `parcelly.order-events`,
`order.cancelled`, which close the session.

## Input

`courier.assigned` payload (see `events/courier-assigned` in dispatch-service):

| Field | Type | Used for |
|-------|------|----------|
| `event_id` | uuid v7 | Idempotency |
| `order_id` | uuid v7 | Session key |
| `assignment_id` | uuid v7 | Distinguishes reassignments |
| `courier_id` | uuid v7 | Which pings belong to this session |
| `pickup` | `{lat, lng, address}` | Geofence and first ETA leg |
| `dropoff` | `{lat, lng, address}` | Second ETA leg |
| `assigned_at` | timestamp | Session start |
| `attempt` | int | 1–3, reassignment counter |

## Business Logic

1. Skip the event if `event_id` is already in `processed_events` (at-least-once delivery from Kafka).
2. If an open session exists for `order_id` with a different `assignment_id`, close it with `closed_reason = reassigned`
   and unsubscribe the old courier from `tracking:order:{order_id}`.
3. Insert a row into table: tracking_sessions with `state = to_pickup`, `courier_id`, `pickup`, `dropoff` and
   `assignment_id`. Unique index `(order_id) WHERE closed_at IS NULL` guarantees one open session per order.
4. Read the courier's last position from Redis key `courier:{courier_id}:pos`. If it is missing or older than 60 s,
   use the position recorded by dispatch in the assignment (`schemas/assignments`).
5. Compute the first pickup ETA through `EtaCalculator` (the same code path as `tracking/get-eta`) and store it as
   `eta_pickup_at`; drop-off ETA = pickup ETA + 3 min handover + routing time pickup → drop-off.
6. Register the session in the 15-second ETA scheduler (sharded by `hash(order_id) % 32`).
7. Publish the first `eta.updated` frame to Redis channel `tracking:order:{order_id}` so already-connected
   `tracking/live-stream` clients see the courier immediately.
8. Commit the Kafka offset only after the DB transaction commits.

### Closing events

| Event | Action | `closed_reason` |
|-------|--------|-----------------|
| `delivery.completed` | Close session, send final frame `delivered`, keep the route polyline for 30 days | `delivered` |
| `order.cancelled` | Close session if `state` is `to_pickup` or `at_pickup`; the cancel is rejected upstream after pickup | `cancelled` |
| `courier.assigned` with new `assignment_id` | See step 2 | `reassigned` |

## External Dependencies

- topic: `parcelly.dispatch-events`
- topic: `parcelly.order-events`
- service: routing-engine
- table: tracking_sessions
- table: processed_events
- Redis: `courier:{courier_id}:pos`, channel `tracking:order:{order_id}`

## Error Handling

| Condition | Behaviour |
|-----------|-----------|
| routing-engine timeout (800 ms) | Session is opened with `eta_pickup_at = null`; the scheduler fills it on the next 15 s tick |
| DB unavailable | Retried 5 times with backoff 1 s, 2 s, 4 s, 8 s, 16 s, then queue: `tracking.dead-letter` |
| Unknown `order_id` in `delivery.completed` | Logged as warning, offset committed |
| Payload fails schema validation | Sent straight to queue: `tracking.dead-letter`, alert `TrackingPoisonMessage` |
