---
slug: events/courier-assigned
domain: dispatch
entry_type: event
summary: courier.assigned — published when a courier accepts an order offer or replaces another courier; starts ETA tracking
category: specification
links:
  - slug: dispatch/assign-courier
    type: references
  - slug: dispatch/reassign-courier
    type: references
  - slug: tracking/on-courier-assigned
    library: tracking-service
    type: related_to
  - slug: notifications/on-courier-assigned
    library: notifications-service
    type: related_to
  - slug: orders/cancel-order
    library: orders-service
    type: related_to
---

# courier.assigned

Published by `dispatch/assign-courier` to topic: `parcelly.dispatch-events` through the outbox (table: dispatch_outbox).
Partition key: `order_id`, so a reassignment is always ordered after the original assignment.

## Payload

| Field | Type | Description |
|-------|------|-------------|
| `event_id` | uuid (v7) | |
| `event_type` | string | `courier.assigned` |
| `schema_version` | integer | `1` |
| `occurred_at` | timestamp (UTC) | Offer acceptance time |
| `order_id` | uuid | |
| `assignment_id` | uuid | |
| `courier_id` | uuid | |
| `courier.first_name` | string | Shown to the customer |
| `courier.vehicle` | string | `bike`, `cargo_bike`, `scooter`, `car` |
| `courier.photo_url` | string | Signed URL, valid 24 h |
| `pickup_eta` | timestamp | Estimate at acceptance time |
| `reassigned` | boolean | `true` when it replaces another courier |
| `previous_courier_id` | uuid, nullable | Set when `reassigned` |

```json
{
  "event_id": "01929b4f-0a1b-7c2d-8e3f-405162738495",
  "event_type": "courier.assigned",
  "schema_version": 1,
  "occurred_at": "2026-10-31T09:15:02Z",
  "order_id": "01929b4d-1f20-7c55-8e3a-5b2d9f0c4e11",
  "assignment_id": "01929b4e-9d88-7f01-a2b3-c4d5e6f70812",
  "courier_id": "01927a11-3c4d-7e5f-8a9b-0c1d2e3f4a5b",
  "courier": { "first_name": "Marta", "vehicle": "cargo_bike", "photo_url": "https://cdn.parcelly.example/c/…" },
  "pickup_eta": "2026-10-31T09:24:00Z",
  "reassigned": false,
  "previous_courier_id": null
}
```

## Consumers

| Service | Handler | Effect |
|---------|---------|--------|
| tracking-service | `tracking/on-courier-assigned` | Starts ETA tracking and the live stream |
| notifications-service | `notifications/on-courier-assigned` | Push "Marta is on her way" with ETA |
| orders-service | order status updater | `paid -> courier_assigned`; from now on cancellation costs 3.00 EUR |

## Guarantees

- At-least-once; de-duplicate on `event_id`.
- After a reassignment consumers see a second `courier.assigned` for the same order with `reassigned = true`; the latest one wins.
