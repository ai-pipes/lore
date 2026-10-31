---
slug: orders/overview
domain: orders
entry_type: overview
summary: Orders service overview — delivery quotes, order lifecycle, cancellation rules and unpaid order expiry
category: architecture
links:
  - slug: orders/quote-delivery
    type: references
  - slug: orders/create-order
    type: references
  - slug: orders/get-order
    type: references
  - slug: orders/cancel-order
    type: references
  - slug: events/order-created
    type: references
  - slug: events/order-cancelled
    type: references
  - slug: jobs/expire-unpaid-orders
    type: references
  - slug: schemas/orders
    type: references
  - slug: ops/stuck-orders
    type: references
  - slug: gateway/routing
    library: api-gateway
    type: related_to
  - slug: billing/overview
    library: billing-service
    type: related_to
  - slug: dispatch/overview
    library: dispatch-service
    type: related_to
  - slug: tracking/overview
    library: tracking-service
    type: related_to
  - slug: notifications/overview
    library: notifications-service
    type: related_to
---

# Orders service

orders-service owns the customer's delivery order from the price quote to delivery or cancellation. It is the start of
the Parcelly flow: an order created here triggers payment (billing-service), courier assignment (dispatch-service),
live tracking (tracking-service) and customer messages (notifications-service). Node.js/TypeScript, Postgres database
`orders`, 4 replicas behind the api-gateway.

## Domains

| Domain | What it owns |
|--------|--------------|
| `orders` | Quotes, orders, status transitions, cancellation and cancellation fees |
| `events` | `order.created`, `order.cancelled` published to topic: `parcelly.order-events` |
| `jobs` | Expiry of unpaid orders |

## Order lifecycle

```mermaid
stateDiagram-v2
  [*] --> created: POST /api/v1/orders
  created --> paid: payment.captured
  created --> expired: unpaid for 10 min
  created --> cancelled: customer cancels (free)
  paid --> courier_assigned: courier.assigned
  paid --> cancelled: customer cancels (free, full refund)
  courier_assigned --> picked_up: courier.picked_up
  courier_assigned --> cancelled: customer cancels (free within 2 min, then 3.50 EUR fee)
  picked_up --> delivered: delivery.completed
  delivered --> [*]
  cancelled --> [*]
  expired --> [*]
```

Status changes after `created` are driven by events the service consumes:

| Event | Topic | Producer | Transition |
|-------|-------|----------|------------|
| `payment.captured` | `parcelly.payment-events` | billing-service | `created → paid` |
| `courier.assigned` | `parcelly.dispatch-events` | dispatch-service | `paid → courier_assigned` (also on reassignment, keeps status) |
| `courier.picked_up` | `parcelly.dispatch-events` | dispatch-service | `courier_assigned → picked_up` |
| `delivery.completed` | `parcelly.dispatch-events` | dispatch-service | `picked_up → delivered` |

## Key business rules

- **Price**: base 4.90 EUR + 0.80 EUR/km of route distance; x1.5 surge when fewer than 3 couriers are free within 3 km
  of the pickup. Maximum distance 25 km, maximum parcel weight 20 kg (`orders/quote-delivery`).
- A quote is valid for **10 minutes**; an order must reference a valid quote.
- An optional **tip** of 0–20 EUR can be added at order creation; it is added to the total and passed through to
  billing-service, which pays it out to the courier in full.
- **Unpaid orders expire after 10 minutes** (`jobs/expire-unpaid-orders`).
- **Cancellation** is free until a courier is assigned and within **2 minutes** after assignment. After that a
  cancellation fee of **3.50 EUR** applies.
  After pickup cancellation is impossible (`409`). See `orders/cancel-order`.
- Refunds are issued by billing-service: full amount minus the cancellation fee, back to the original payment method
  within 5–10 business days.
- All amounts in EUR with 2 decimals, timestamps UTC ISO-8601, ids UUID v7.

## End-to-end flow

```mermaid
sequenceDiagram
  participant App
  participant OR as orders-service
  participant BI as billing-service
  participant DI as dispatch-service
  participant NO as notifications-service
  App->>OR: POST /api/v1/orders/quote
  App->>OR: POST /api/v1/orders
  OR-->>BI: order.created
  OR-->>NO: order.created
  BI-->>OR: payment.captured
  BI-->>DI: payment.captured
  DI-->>OR: courier.assigned
  DI-->>OR: delivery.completed
```

## External Dependencies

- table: orders
- table: quotes
- table: orders_outbox
- topic: `parcelly.order-events` (publishes)
- topic: `parcelly.payment-events`, topic: `parcelly.dispatch-events` (consumes)
- service: dispatch-service — free courier count for surge pricing
- service: billing-service — payment client secret for the app
- Google Routes API — route distance for quotes
- queue: `orders.dead-letter`
