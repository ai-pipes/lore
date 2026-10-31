---
slug: events/order-created
domain: orders
entry_type: event
summary: order.created — published when a customer creates an order; triggers payment intent creation and confirmation messages
category: specification
links:
  - slug: orders/create-order
    type: references
  - slug: schemas/orders
    type: references
  - slug: payments/on-order-created
    library: billing-service
    type: related_to
  - slug: notifications/on-order-created
    library: notifications-service
    type: related_to
---

# OrderCreated

Published by `CreateOrderHandler` through the transactional outbox (table: orders_outbox) after the order row is
committed. Delivery is at-least-once; consumers deduplicate on `event_id` or `order_id`.

## Payload

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `event_id` | uuid | yes | UUID v7 |
| `event_type` | string | yes | Always `"order.created"` |
| `occurred_at` | timestamp | yes | UTC ISO-8601 |
| `order_id` | uuid | yes | |
| `customer_id` | uuid | yes | |
| `total` | decimal | yes | Amount to charge, EUR, 2 decimals |
| `currency` | string | yes | `EUR` |
| `distance_km` | decimal | yes | From the quote |
| `surge_multiplier` | decimal | yes | `1.0` or `1.5` |
| `pickup` | object | yes | `{ line1, postcode, city, lat, lon }` |
| `dropoff` | object | yes | Same shape |
| `parcel` | object | yes | `{ weight_kg, size }` |
| `payment_method_id` | string | no | Saved Paylane method, if chosen |
| `expires_at` | timestamp | yes | `occurred_at + 15 minutes`; the order expires if unpaid by then |

Example:

```json
{
  "event_id": "01929b10-2f4a-7c1e-a0d3-5e6f7a8b9c0d",
  "event_type": "order.created",
  "occurred_at": "2026-10-31T10:02:11Z",
  "order_id": "01929b10-2f40-7a55-b3c2-1d2e3f4a5b6c",
  "customer_id": "01929a4e-7c3a-7f00-8a1b-1c2d3e4f5a6b",
  "total": 9.86,
  "currency": "EUR",
  "distance_km": 6.2,
  "surge_multiplier": 1.0,
  "parcel": { "weight_kg": 2.5, "size": "M" },
  "expires_at": "2026-10-31T10:17:11Z"
}
```

## Published to

topic: `parcelly.order-events`, partition key `order_id` (keeps `order.created` and `order.cancelled` of one order in
order), retention 7 days.

## Known consumers

| Service | Handler | What it does |
|---------|---------|-------------|
| billing-service | `payments/on-order-created` | Creates a Paylane payment intent for `total`, valid until `expires_at` |
| notifications-service | `notifications/on-order-created` | Sends "order received, complete payment" push/e-mail |
| analytics | Snowplow sink | Conversion funnel |

dispatch-service does **not** consume this event; it waits for `payment.captured`.
