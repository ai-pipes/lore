---
slug: jobs/expire-unpaid-orders
domain: orders
entry_type: job
handler_class: ExpireUnpaidOrdersJob
summary: Every minute cancels orders unpaid for 30 minutes and releases their reserved pets
category: implementation
links:
  - slug: orders/place-order
    type: related_to
---

# ExpireUnpaidOrdersJob

Scheduled job (every minute) that cancels orders whose payment was not completed within 30 minutes.

## Business Logic

1. Select up to 500 orders with `status = placed` and `created_at < now() - interval '30 minutes'` from table: orders.
2. For each order, in its own transaction: set `status = cancelled`, `cancel_reason = payment_timeout`; set its pets back to `available`.
3. Expire the payment session via service: payments-gateway (best effort).
4. Publish `order.cancelled` with `reason = payment_timeout` to topic: `petstore.order-events`.

## External Dependencies

- `IOrderRepository`, `IPetRepository`
- service: payments-gateway
- topic: `petstore.order-events`

## Notes

The job is idempotent; running two instances at once is safe because rows are locked with `FOR UPDATE SKIP LOCKED`.
