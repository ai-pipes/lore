---
slug: events/payment-captured
domain: payments
entry_type: event
summary: payment.captured — published when an order's payment is captured; triggers courier dispatch and marks the order paid
category: specification
links:
  - slug: payments/capture-payment
    type: references
  - slug: dispatch/on-payment-captured
    library: dispatch-service
    type: related_to
  - slug: orders/overview
    library: orders-service
    type: related_to
---

# payment.captured

Published by `payments/capture-payment` to topic: `parcelly.payment-events` through the outbox (table: billing_outbox).
Partition key: `order_id`. Delivery is at-least-once; consumers must be idempotent on `event_id`.

## Payload

| Field | Type | Description |
|-------|------|-------------|
| `event_id` | uuid (v7) | Unique per event |
| `event_type` | string | `payment.captured` |
| `schema_version` | integer | `2` |
| `occurred_at` | timestamp (UTC) | Capture time |
| `order_id` | uuid | |
| `customer_id` | uuid | |
| `payment_id` | uuid | `payments.id` |
| `amount` | decimal | Captured EUR amount including the tip, e.g. `14.10` |
| `tip` | decimal | Courier tip included in `amount`, `0.00` if none |
| `currency` | string | `EUR` |
| `psp` | string | `paylane` |

```json
{
  "event_id": "01929b4e-7c3a-7d10-9a51-3f1e2c8b6a01",
  "event_type": "payment.captured",
  "schema_version": 2,
  "occurred_at": "2026-10-31T09:14:05Z",
  "order_id": "01929b4d-1f20-7c55-8e3a-5b2d9f0c4e11",
  "customer_id": "01928f00-aa10-7b3e-9c41-0d6e5f7a8b22",
  "payment_id": "01929b4d-2a77-70f1-b6c9-9e8d7c6b5a33",
  "amount": "14.10",
  "tip": "2.00",
  "currency": "EUR",
  "psp": "paylane"
}
```

## Consumers

| Service | Handler | Effect |
|---------|---------|--------|
| dispatch-service | `dispatch/on-payment-captured` | Starts courier assignment; shows the tip in the courier offer |
| orders-service | order status updater | `created -> paid` |

## Guarantees

- Exactly one `payment.captured` per order in normal operation; replays carry the same `event_id`.
- Never published for an order that is already `cancelled` or `expired`.
