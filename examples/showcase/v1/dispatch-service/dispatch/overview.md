---
slug: dispatch/overview
domain: dispatch
entry_type: overview
summary: Dispatch service overview — assigns the nearest free courier to paid orders, reassigns stale ones, publishes dispatch events
category: architecture
links:
  - slug: dispatch/on-payment-captured
    type: references
  - slug: dispatch/assign-courier
    type: references
  - slug: dispatch/reassign-courier
    type: references
  - slug: dispatch/on-order-cancelled
    type: references
  - slug: jobs/reassign-stale-assignments
    type: references
  - slug: events/courier-assigned
    type: references
  - slug: events/delivery-completed
    type: references
  - slug: schemas/assignments
    type: references
  - slug: ops/no-couriers-available
    type: references
  - slug: events/payment-captured
    library: billing-service
    type: depends_on
  - slug: events/order-cancelled
    library: orders-service
    type: depends_on
  - slug: tracking/overview
    library: tracking-service
    type: related_to
  - slug: notifications/overview
    library: notifications-service
    type: related_to
  - slug: gateway/overview
    library: api-gateway
    type: related_to
  - slug: orders/quote-delivery
    library: orders-service
    type: related_to
---

# Dispatch service

Dispatch decides which courier delivers which order. It starts when billing has captured the payment, offers the order
to the nearest free courier, watches the assignment until delivery and publishes the dispatch events the rest of
Parcelly reacts to.

## Responsibilities

| Area | Document |
|------|----------|
| Start dispatch for paid orders | `dispatch/on-payment-captured` |
| Courier matching and offers | `dispatch/assign-courier` |
| Manual reassignment by ops | `dispatch/reassign-courier` |
| Release the courier when an order is cancelled | `dispatch/on-order-cancelled` |
| Detect couriers that don't move toward the pickup | `jobs/reassign-stale-assignments` |
| Events | `events/courier-assigned`, `events/delivery-completed` |

## Assignment algorithm

```mermaid
flowchart TD
  A[payment.captured] --> B[Create assignment, status searching]
  B --> C{Free couriers within radius?<br/>5 km, 8 km after 2 min}
  C -- no --> W[Wait 15 s] --> C
  C -- yes --> D[Pick nearest by road ETA,<br/>not yet offered this order]
  D --> E[Send offer to courier app<br/>timeout 45 s]
  E --> F{Accepted?}
  F -- yes --> G[status accepted<br/>publish courier.assigned]
  F -- declined / timeout --> H{offer_count < 3?}
  H -- yes --> C
  H -- no --> I[Alert ops/no-couriers-available<br/>keep searching at 8 km every 60 s]
  G --> J[Courier picks up -> picked_up]
  J --> K[Handover confirmed -> delivered<br/>publish delivery.completed]
  G -. no progress 10 min .-> L[jobs/reassign-stale-assignments]
  L --> C
```

## Key business rules

- Dispatch starts only after `payment.captured`; unpaid orders never reach dispatch.
- Search radius **5 km** around the pickup, widened to **8 km** two minutes after the search started.
- An offer is valid for **45 s**. At most **3 offers** per search; after the third rejection or timeout ops is alerted (`ops/no-couriers-available`).
- A courier holds at most one active assignment.
- A courier that has not moved toward the pickup for **10 minutes** is replaced automatically.
- After pickup, the order can no longer be cancelled (orders-service answers `409`) or reassigned.
- Couriers count as free when they are online, have no active assignment and sent a location in the last 60 s.
- Fewer than 3 free couriers within 3 km of a pickup triggers the x1.5 surge in orders-service pricing; dispatch exposes that count as `GET /internal/couriers/free-count?lat=&lng=&radius_m=3000`, called by orders-service `orders/quote-delivery`.

## External Dependencies

- topic: `parcelly.payment-events` — consumed (`payment.captured`)
- topic: `parcelly.order-events` — consumed (`order.cancelled`)
- topic: `parcelly.dispatch-events` — produced (`courier.assigned`, `courier.picked_up`, `delivery.completed`)
- service: tracking-service — courier positions and ETAs (`GET /internal/couriers/nearby`)
- service: courier-app-push — offers to courier phones
- table: assignments
- table: courier_offers
- queue: `dispatch.dead-letter`
