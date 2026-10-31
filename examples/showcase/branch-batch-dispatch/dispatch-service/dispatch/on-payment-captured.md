---
slug: dispatch/on-payment-captured
domain: dispatch
entry_type: event_handler
handler_class: PaymentCapturedConsumer
summary: Consumes payment.captured and starts courier assignment for the paid order
category: specification
links:
  - slug: events/payment-captured
    library: billing-service
    type: depends_on
  - slug: payments/capture-payment
    library: billing-service
    type: related_to
  - slug: dispatch/assign-courier
    type: calls
  - slug: schemas/assignments
    type: references
  - slug: orders/get-order
    library: orders-service
    type: calls
---

# PaymentCapturedConsumer

Consumes `payment.captured` from topic: `parcelly.payment-events` (consumer group `dispatch-payment-events`) and kicks
off the courier search for the order.

## Input

Event payload as described in billing-service `events/payment-captured`: `event_id`, `order_id`, `customer_id`,
`amount`, `occurred_at`. The payload has no addresses, so dispatch loads them from orders-service.

## Business Logic

1. De-duplicate on `event_id` (table: processed_events, 7-day retention).
2. If an assignment for `order_id` already exists in table: assignments, stop — replay.
3. Load the order via service: orders-service `GET /internal/orders/{order_id}` (same data as `orders/get-order`): pickup and drop-off coordinates, parcel weight (max 20 kg), size, distance (max 25 km), status.
4. If the order is not `paid` or `created` (the `paid` update may lag), e.g. `cancelled`, stop: billing refunds it, nothing to dispatch.
5. Choose the vehicle class: parcels over 8 kg or size `L` need a car or cargo bike; otherwise any vehicle.
6. Insert an assignment with `status = searching`, `radius_m = 5000`, `search_started_at = now()`, `offer_count = 0`.
7. Call `dispatch/assign-courier` asynchronously (in-process work queue, partitioned by city).

## External Dependencies

- topic: `parcelly.payment-events`
- service: orders-service
- table: assignments
- table: processed_events

## Error Handling

| Condition | Behaviour |
|-----------|-----------|
| orders-service 5xx / timeout (2 s) | Retry 5 times with exponential backoff, then queue: `dispatch.dead-letter` and page dispatch on-call (a paid order without a courier) |
| Order not found | Dead letter immediately with reason `order_not_found` |
| Duplicate event | No-op |

Metric: `dispatch_payment_to_search_seconds` — p99 target 1 s.
