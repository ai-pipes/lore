---
slug: dispatch/reassign-courier
domain: dispatch
entry_type: handler
handler_class: ReassignCourierHandler
http_method: POST
route: /api/v1/dispatch/{order_id}/reassign
summary: Ops-only endpoint that takes an order away from its courier before pickup and restarts the courier search
category: specification
links:
  - slug: dispatch/assign-courier
    type: calls
  - slug: jobs/reassign-stale-assignments
    type: related_to
  - slug: events/courier-assigned
    type: references
  - slug: schemas/assignments
    type: references
  - slug: ops/no-couriers-available
    type: related_to
  - slug: tracking/on-courier-assigned
    library: tracking-service
    type: related_to
  - slug: gateway/routing
    library: api-gateway
    type: references
---

# ReassignCourierHandler

Lets an ops agent replace the courier of an order, e.g. after a breakdown or a phone call from the courier. Only
callers with role `ops` in the JWT may use it (api-gateway forwards the verified claims, see `gateway/routing`).
The same logic runs automatically from `jobs/reassign-stale-assignments`.

## Request

| Field | Location | Type | Required | Description |
|-------|----------|------|----------|-------------|
| `order_id` | path | uuid | yes | |
| `reason` | body | string | yes | `courier_unreachable`, `vehicle_breakdown`, `courier_request`, `stale`, `other` |
| `comment` | body | string | no | Up to 500 characters |
| `preferred_courier_id` | body | uuid | no | Offer to this courier first (must be free and within 8 km) |
| `Idempotency-Key` | header | string | yes | |

## Response

`202 Accepted`

| Field | Type | Description |
|-------|------|-------------|
| `assignment_id` | uuid | The new assignment |
| `previous_courier_id` | uuid | |
| `status` | string | `searching` |

## Business Logic

1. Lock the active assignment for `order_id` in table: assignments.
2. It must be `offered` or `accepted`. `picked_up` and later cannot be reassigned — the parcel is with the courier.
3. Mark it `reassigned` with `reassign_reason`, free the previous courier, withdraw any pending offer.
4. Create a new assignment: `status = searching`, `search_started_at = now()` (radius back to 5 km), `offer_count = 0`, `exclude_courier_ids = [previous courier]`, `reassignment_of = <old id>`.
5. Call `dispatch/assign-courier`. Its `courier.assigned` carries `reassigned: true` and `previous_courier_id`, so tracking-service restarts the ETA and notifications-service tells the customer about the new courier.
6. Record an audit entry (table: dispatch_audit) with the ops user id.

The customer pays nothing extra; a reassignment never triggers a cancellation fee.

## External Dependencies

- table: assignments
- table: dispatch_audit
- topic: `parcelly.dispatch-events`

## Error Handling

| HTTP code | Condition |
|-----------|-----------|
| `400` | Unknown `reason`, missing `Idempotency-Key` |
| `401` | No or invalid JWT |
| `403` | Caller lacks role `ops` |
| `404` | No assignment for `order_id` |
| `409` | Assignment is `searching`, `picked_up`, `delivered` or `cancelled` |
| `422` | `preferred_courier_id` is busy, offline or further than 8 km |
