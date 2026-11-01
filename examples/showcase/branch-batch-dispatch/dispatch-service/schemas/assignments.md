---
slug: schemas/assignments
domain: dispatch
entry_type: schema
summary: assignments and courier_offers tables — one assignment per courier search, with offers, radius, progress and status
category: specification
links:
  - slug: dispatch/assign-courier
    type: related_to
  - slug: jobs/reassign-stale-assignments
    type: related_to
  - slug: dispatch/reassign-courier
    type: related_to
  - slug: schemas/orders
    library: orders-service
    type: references
---

# assignments, courier_offers

Dispatch's Postgres tables (PostGIS enabled). UUID v7 ids, `timestamptz` in UTC.

## table: assignments

| Column | Type | Null | Description |
|--------|------|------|-------------|
| `id` | uuid | no | Primary key |
| `order_id` | uuid | no | Order in orders-service (`schemas/orders`), no FK across databases |
| `courier_id` | uuid | yes | Set on acceptance |
| `status` | text | no | See below |
| `pickup` | geography(Point) | no | |
| `dropoff` | geography(Point) | no | |
| `vehicle_class` | text | no | `any` or `car_or_cargo` |
| `radius_m` | integer | no | `5000` or `8000` |
| `offer_count` | smallint | no | 0–3 within one search |
| `exclude_courier_ids` | uuid[] | no | Default `{}` |
| `search_started_at` | timestamptz | no | |
| `accepted_at` | timestamptz | yes | |
| `last_progress_at` | timestamptz | yes | Advanced when the courier gets ≥ 100 m closer to the pickup |
| `picked_up_at` | timestamptz | yes | |
| `delivered_at` | timestamptz | yes | |
| `reassignment_of` | uuid | yes | Previous assignment |
| `reassign_reason` | text | yes | |
| `auto_reassign_count` | smallint | no | Max 2 |
| `cancellation_fee_cents` | integer | no | The `cancellation_fee` of order.cancelled in cents (set by orders-service, see `orders/cancel-order`) when cancelled after acceptance, else `0` |
| `created_at`, `updated_at` | timestamptz | no | |

Statuses: `searching -> offered -> accepted -> picked_up -> delivered`; side exits `cancelled`, `reassigned`.

Indexes:
- `assignments_one_active_per_order` — unique on `order_id` where status not in (`cancelled`, `reassigned`, `delivered`)
- `assignments_one_active_per_courier` — unique on `courier_id` where status in (`accepted`, `picked_up`)
- `assignments_stale_idx` on `(status, last_progress_at)` for `jobs/reassign-stale-assignments`
- GiST on `pickup`

## table: courier_offers

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `assignment_id` | uuid | FK -> `assignments.id` |
| `courier_id` | uuid | |
| `sent_at` | timestamptz | |
| `expires_at` | timestamptz | `sent_at + 45 s` |
| `result` | text | `pending`, `accepted`, `declined`, `timeout`, `withdrawn` |
| `responded_at` | timestamptz | |
| `distance_m` | integer | Road distance to pickup when offered |

## Other tables

- table: dispatch_outbox — transactional outbox for topic: `parcelly.dispatch-events`
- table: dispatch_audit — ops actions (reassignments), kept 2 years
- table: processed_events — consumed event ids, kept 7 days

## Retention

Assignments and offers are kept 13 months, then aggregated into the courier performance warehouse.
