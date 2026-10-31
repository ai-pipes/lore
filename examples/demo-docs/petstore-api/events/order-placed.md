---
slug: events/order-placed
domain: orders
entry_type: event
summary: order.placed event published when a customer places an adoption order
category: specification
links:
  - slug: notifications/on-order-placed
    library: notifications-service
    type: related_to
---

# order.placed

Published by `PlaceOrderHandler` after the order is committed.

## Payload

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `event_type` | string | yes | Always `order.placed` |
| `order_id` | uuid | yes | |
| `customer_id` | uuid | yes | |
| `pet_ids` | uuid[] | yes | |
| `total` | decimal | yes | |
| `expires_at` | timestamp | yes | Payment deadline |
| `occurred_at` | timestamp | yes | |

## Published to

topic: `petstore.order-events` (key = `order_id`)

## Known consumers

| Service | What it does |
|---------|-------------|
| `notifications-service` | Sends the order confirmation e-mail with the payment link |
