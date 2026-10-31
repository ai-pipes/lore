---
slug: dispatch/assign-courier
domain: dispatch
entry_type: service
handler_class: CourierAssignmentService
summary: Finds the nearest free courier within 5 km (8 km after 2 min), sends 45-second offers, at most 3, and publishes courier.assigned
category: implementation
links:
  - slug: dispatch/on-payment-captured
    type: related_to
  - slug: events/courier-assigned
    type: references
  - slug: schemas/assignments
    type: references
  - slug: ops/no-couriers-available
    type: related_to
  - slug: tracking/ingest-courier-location
    library: tracking-service
    type: depends_on
  - slug: tracking/get-eta
    library: tracking-service
    type: calls
  - slug: orders/quote-delivery
    library: orders-service
    type: related_to
---

# CourierAssignmentService

Matches a paid order with a courier. Runs for each assignment in status `searching`, either right after
`dispatch/on-payment-captured`, after a declined or expired offer, or after a reassignment.

## Input

| Field | Type | Description |
|-------|------|-------------|
| `assignment_id` | uuid | Row in table: assignments |
| `exclude_courier_ids` | uuid[] | Couriers that already declined, timed out or were replaced |

## Parameters

| Parameter | Value | Config key |
|-----------|-------|------------|
| Initial radius | 5 km | `DISPATCH_RADIUS_M=5000` |
| Expanded radius | 8 km, 2 min after `search_started_at` | `DISPATCH_RADIUS_EXPANDED_M=8000`, `DISPATCH_EXPAND_AFTER_S=120` |
| Offer timeout | 45 s | `DISPATCH_OFFER_TIMEOUT_S=45` |
| Max offers per search | 3 | `DISPATCH_MAX_OFFERS=3` |
| Location freshness | 60 s | `DISPATCH_LOCATION_MAX_AGE_S=60` |
| Empty-radius poll | 15 s | |

## Business Logic

1. Lock the assignment (`SELECT ... FOR UPDATE SKIP LOCKED`); it must be `searching`.
2. Radius = 8000 m if `now() - search_started_at >= 120 s`, else 5000 m; store it in `radius_m`.
3. Ask service: tracking-service `GET /internal/couriers/nearby?lat=&lng=&radius_m=` for couriers with a location fresher than 60 s (positions come from `tracking/ingest-courier-location`).
4. Filter: online, no active assignment, vehicle class fits the parcel, not in `exclude_courier_ids`.
5. If nobody is left, re-run in 15 s (the radius may have expanded by then).
6. Rank by road ETA to the pickup (`tracking/get-eta` routing engine, straight-line fallback at 18 km/h); ties broken by the longest idle time.
7. Insert a row in table: courier_offers (`expires_at = now() + 45 s`), increment `offer_count`, set the assignment to `offered`, and push the offer via service: courier-app-push (pickup address, drop-off district, distance, courier earnings).
8. **Accept** within 45 s: in one transaction set `status = accepted`, `courier_id`, `accepted_at`, mark the courier busy, write `courier.assigned` to the outbox (table: dispatch_outbox). The relay publishes it to topic: `parcelly.dispatch-events` (see `events/courier-assigned`).
9. **Decline** or **timeout**: add the courier to `exclude_courier_ids`, set back to `searching`. If `offer_count < 3`, go to step 2; otherwise raise the `DispatchNoCourier` alert (`ops/no-couriers-available`) and keep polling every 60 s at 8 km without new alerts.

An offer accepted after its 45 s expired is rejected in the courier app with "Offer expired".

## External Dependencies

- service: tracking-service — nearby couriers and ETAs
- service: courier-app-push — offers to courier phones
- table: assignments
- table: courier_offers
- table: dispatch_outbox
- topic: `parcelly.dispatch-events`

## Error Handling

| Condition | Behaviour |
|-----------|-----------|
| tracking-service unavailable | Retry after 5 s; after 1 min alert dispatch on-call, the assignment stays `searching` |
| Push delivery fails | Count as timeout, offer the next courier |
| Two couriers accept the same order (race) | Row lock ensures one wins; the other gets "Order already taken" |
| Order cancelled during search | `dispatch/on-order-cancelled` sets `cancelled`; pending offers are withdrawn |

Metrics: `dispatch_time_to_assign_seconds` (p50 target 60 s, p95 180 s), `dispatch_offers_total{result}`.
