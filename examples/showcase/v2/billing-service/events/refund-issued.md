---
slug: events/refund-issued
domain: refunds
entry_type: event
summary: refund.issued — published when Paylane confirms a full or partial refund; carries amount, withheld fee and refunded tip
category: specification
links:
  - slug: refunds/issue-refund
    type: references
  - slug: payments/psp-webhook
    type: references
  - slug: notifications/on-refund-issued
    library: notifications-service
    type: related_to
---

# refund.issued

Published to topic: `parcelly.payment-events` when the `refund.succeeded` webhook arrives (see `payments/psp-webhook`).
Partition key: `order_id`.

## Payload

| Field | Type | Description |
|-------|------|-------------|
| `event_id` | uuid (v7) | |
| `event_type` | string | `refund.issued` |
| `schema_version` | integer | `2` |
| `occurred_at` | timestamp (UTC) | When Paylane confirmed the refund |
| `order_id` | uuid | |
| `customer_id` | uuid | |
| `refund_id` | uuid | `refunds.id` |
| `amount` | decimal | Refunded EUR amount |
| `fee_withheld` | decimal | `3.50` after courier assignment, else `0.00` |
| `tip_refunded` | decimal | Tip part of `amount`; `0.00` after pickup |
| `partial` | boolean | `true` when money remains captured after this refund |
| `remaining_refundable` | decimal | |
| `currency` | string | `EUR` |
| `reason` | string | As given to `refunds/issue-refund` |
| `expected_by` | date | Latest date the customer should see the money (10 business days) |

```json
{
  "event_id": "01929b60-0c11-7e2f-a3b4-c5d6e7f80912",
  "event_type": "refund.issued",
  "schema_version": 2,
  "occurred_at": "2026-10-31T09:40:12Z",
  "order_id": "01929b4d-1f20-7c55-8e3a-5b2d9f0c4e11",
  "customer_id": "01928f00-aa10-7b3e-9c41-0d6e5f7a8b22",
  "refund_id": "01929b5f-ff01-7a2b-8c3d-4e5f60718293",
  "amount": "10.60",
  "fee_withheld": "3.50",
  "tip_refunded": "2.00",
  "partial": false,
  "remaining_refundable": "0.00",
  "currency": "EUR",
  "reason": "order_cancelled",
  "expected_by": "2026-11-14"
}
```

## Consumers

| Service | Handler | Effect |
|---------|---------|--------|
| notifications-service | `notifications/on-refund-issued` | E-mail and push: amount, withheld fee, expected date; "partial refund" wording when `partial` |
| orders-service | order status updater | Adds `refunded_at` to the cancelled order |
