---
slug: jobs/expire-unpaid-orders
domain: orders
entry_type: job
handler_class: ExpireUnpaidOrdersJob
summary: Every minute, expires orders still unpaid 15 minutes after creation and publishes order.cancelled
category: implementation
links:
  - slug: orders/create-order
    type: related_to
  - slug: events/order-cancelled
    type: references
  - slug: schemas/orders
    type: references
  - slug: ops/stuck-orders
    type: related_to
  - slug: payments/on-order-cancelled
    library: billing-service
    type: related_to
---

# ExpireUnpaidOrdersJob

Orders that have not been paid within **15 minutes** of creation are expired so that stale payment intents are cancelled
and the customer's unpaid-order slot (max 5) is freed.

## Schedule

| Setting | Value |
|---------|-------|
| Trigger | cron `* * * * *` (every minute) |
| Concurrency | one runner cluster-wide (Postgres advisory lock `orders.expire_unpaid`) |
| Batch size | 500 orders per run |
| Grace period | 30 s after `expires_at` (late `payment.captured` events) |

## Business Logic

1. Take the advisory lock; if another replica holds it, exit.
2. Select candidates:
   ```sql
   SELECT id FROM orders
   WHERE status = 'created' AND expires_at < now() - interval '30 seconds'
   ORDER BY expires_at
   LIMIT 500
   FOR UPDATE SKIP LOCKED
   ```
   `expires_at` is set to `created_at + 15 minutes` by `orders/create-order`.
3. For each order, before expiring, ask billing-service `GET /internal/payments/by-order/{order_id}`. If the payment is
   `captured` or `processing`, skip it and log `orders.expire.skipped_paid` (the `payment.captured` event is late; see
   `ops/stuck-orders`).
4. Set `status = expired`, `cancelled_reason = payment_timeout`, `cancelled_at = now()`.
5. Insert `order.cancelled` with `reason = payment_timeout`, `previous_status = created`, `cancellation_fee = 0.00`,
   `refund_amount = 0.00` into table: orders_outbox (same transaction).
6. billing-service (`payments/on-order-cancelled`) cancels the Paylane payment intent.
7. If the batch was full (500), run again immediately, up to 10 batches per minute.

## External Dependencies

- `IOrderRepository`
- table: orders
- table: orders_outbox
- topic: `parcelly.order-events`
- service: billing-service — payment status check

## Error Handling

- billing-service unreachable: the order is **not** expired in this run (we never expire an order whose payment state is
  unknown); retried next minute. After 3 consecutive failed runs alert `OrdersExpiryBillingUnreachable` fires.
- Any other error rolls back the current batch; already-committed batches stay.

## Metrics

| Metric | Meaning |
|--------|---------|
| `orders_expired_total` | Orders expired |
| `orders_expire_skipped_paid_total` | Late payments detected |
| `orders_expire_lag_seconds` | `now() − min(expires_at)` of pending candidates; alert above 300 s |
