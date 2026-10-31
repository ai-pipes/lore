---
slug: events/delivery-completed
domain: dispatch
entry_type: event
summary: delivery.completed — published when the courier confirms handover of the parcel; closes the order and stops tracking
category: specification
links:
  - slug: schemas/assignments
    type: references
  - slug: notifications/on-delivery-completed
    library: notifications-service
    type: related_to
  - slug: tracking/live-stream
    library: tracking-service
    type: related_to
  - slug: orders/overview
    library: orders-service
    type: related_to
---

# delivery.completed

Published to topic: `parcelly.dispatch-events` when the courier confirms handover in the courier app
(`POST /api/v1/couriers/{courier_id}/deliveries/{order_id}/complete`). Dispatch checks that the courier is within
200 m of the drop-off and that a proof of delivery is attached, then sets `assignments.status = delivered` and frees
the courier. Partition key: `order_id`.

## Payload

| Field | Type | Description |
|-------|------|-------------|
| `event_id` | uuid (v7) | |
| `event_type` | string | `delivery.completed` |
| `schema_version` | integer | `1` |
| `occurred_at` | timestamp (UTC) | Handover time |
| `order_id` | uuid | |
| `assignment_id` | uuid | |
| `courier_id` | uuid | |
| `picked_up_at` | timestamp | |
| `delivered_at` | timestamp | Same as `occurred_at` |
| `proof.type` | string | `signature`, `photo` or `pin` |
| `proof.url` | string, nullable | Signed URL of the photo or signature, valid 7 days |
| `distance_km` | decimal | Actual driven distance |
| `on_time` | boolean | Delivered within 2 hours of payment |

## Consumers

| Service | Handler | Effect |
|---------|---------|--------|
| notifications-service | `notifications/on-delivery-completed` | E-mail with proof of delivery, rating request |
| tracking-service | tracking session closer | Ends `tracking/live-stream` with a final `delivered` frame |
| orders-service | order status updater | `picked_up -> delivered` |

## Notes

- The intermediate `courier.picked_up` event (same topic, published when the courier confirms pickup in the app) moves the order to `picked_up`; from then on cancellation is impossible.
- `delivery.completed` is final: no refund flows are triggered by it; support refunds go through billing `refunds/issue-refund`.
