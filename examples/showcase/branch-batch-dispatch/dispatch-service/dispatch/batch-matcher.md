---
slug: dispatch/batch-matcher
domain: dispatch
entry_type: service
handler_class: BatchMatcher
summary: Pairs a searching order with another one whose pickup is within 600 m and direction compatible, forming a 2-order batch
category: implementation
links:
  - slug: dispatch/assign-courier
    type: related_to
  - slug: schemas/assignments
    type: references
  - slug: dispatch/overview
    type: references
  - slug: tracking/get-eta
    library: tracking-service
    type: calls
  - slug: events/courier-assigned
    type: references
---

# BatchMatcher

Internal service called by `dispatch/assign-courier` before it looks for couriers. It tries to pair the order with one
other order that is still searching, so a single courier picks both parcels up in one trip. Batching cuts courier
idle kilometres in dense districts and raises supply at peak times.

## Input

| Field | Type | Description |
|-------|------|-------------|
| `assignment_id` | uuid | Assignment in `searching`, not yet in a batch |
| `city_id` | string | Matching never crosses cities |

## Output

`batch_id` (uuid) and the partner `assignment_id`, or `null` when no partner fits.

## Parameters

| Parameter | Value | Config key |
|-----------|-------|------------|
| Max orders per batch | 2 | `DISPATCH_BATCH_MAX_ORDERS=2` |
| Max distance between pickups | 600 m (straight line) | `DISPATCH_BATCH_PICKUP_RADIUS_M=600` |
| Max direction difference | 45° between pickup->drop-off bearings | `DISPATCH_BATCH_MAX_BEARING_DEG=45` |
| Max detour per order | +25% road time vs. a direct delivery | `DISPATCH_BATCH_MAX_DETOUR=0.25` |
| Max combined weight | 20 kg | |
| Batch offer timeout | 60 s | `DISPATCH_BATCH_OFFER_TIMEOUT_S=60` |

## Business Logic

1. Skip when the feature flag `dispatch.batching` is off for the city, or the order already had a courier (reassignments are never batched).
2. Find candidates in table: assignments: `status = searching`, `batch_id IS NULL`, same city, `ST_DWithin(pickup, :pickup, 600)`, `search_started_at` within the last 2 minutes, at most 10 nearest.
3. Directions are **compatible** when the bearings pickup->drop-off of both orders differ by at most 45° and both drop-offs lie on the same side of the river ring (city zone table).
4. Combined weight must be <= 20 kg and both parcels must fit the courier's vehicle class (an `L` parcel forces `car_or_cargo` for the batch).
5. For each candidate, ask the routing engine of service: tracking-service (as used by `tracking/get-eta`) for the best route order (pickup A, pickup B, drop-off A/B). Reject if either order's delivery time grows by more than 25%, or if the batch could break the 2-hour delivery promise.
6. Pick the candidate with the smallest total route time; lock both rows (`FOR UPDATE SKIP LOCKED`) and set the same `batch_id` and `batch_seq` (1, 2 in route order).
7. Return the pair. `dispatch/assign-courier` offers it to one courier with a 60 s timeout; accepting yields one `courier.assigned` per order, each with `batch_id`.

## Data

The branch adds two columns to table: assignments (see `schemas/assignments`): `batch_id uuid NULL` and
`batch_seq smallint NULL`, plus index `assignments_batch_idx` on `batch_id`. The per-courier active-assignment
index allows two rows when they share a `batch_id`.

## External Dependencies

- table: assignments
- service: tracking-service — routing engine for detour checks

## Error Handling

| Condition | Behaviour |
|-----------|-----------|
| Routing engine unavailable or > 300 ms | Return `null`; the order is dispatched alone |
| Partner row locked by another worker | Try the next candidate |
| Partner cancelled after batching | `dispatch/assign-courier` dissolves the batch |

Metrics: `dispatch_batches_formed_total`, `dispatch_batch_acceptance_ratio`, `dispatch_batch_detour_ratio` (histogram).
