---
slug: notifications/on-refund-issued
domain: notifications
entry_type: event_handler
handler_class: RefundIssuedNotifier
summary: Consumes refund.issued and e-mails the refund amount, any 3.50 EUR cancellation fee and the 5–10 day timeline
category: specification
links:
  - slug: events/refund-issued
    library: billing-service
    type: depends_on
  - slug: refunds/issue-refund
    library: billing-service
    type: related_to
  - slug: payments/on-order-cancelled
    library: billing-service
    type: related_to
  - slug: orders/cancel-order
    library: orders-service
    type: related_to
  - slug: events/order-cancelled
    library: orders-service
    type: references
  - slug: users/get-profile
    library: identity-service
    type: calls
  - slug: notifications/send-notification
    type: calls
---

# RefundIssuedNotifier

Consumes `refund.issued` from topic: `parcelly.payment-events` (consumer group `notifications-payments`) and tells the
customer how much is coming back and when. Refunds follow a cancellation (`orders/cancel-order` → billing
`payments/on-order-cancelled` → `refunds/issue-refund`) or a manual refund by support.

## Input

| Field | Type | Used for |
|-------|------|----------|
| `refund_id` | uuid v7 | Dedup key |
| `order_id` | uuid v7 | Template |
| `customer_id` | uuid v7 | Recipient |
| `amount` | decimal | Refunded amount, EUR |
| `fee_retained` | decimal | `0.00` or `3.50` (cancellation after courier assignment) |
| `original_amount` | decimal | Captured amount |
| `payment_method` | object | `{ brand, last4 }` |
| `reason` | string | `cancelled_by_customer`, `cancelled_by_ops`, `support_goodwill` |

## Business Logic

1. Call `notifications/send-notification` with template `refund_issued`, channels `["email"]`, urgency `low`,
   `dedup_key = refund.issued:{refund_id}` (a partial refund followed by another produces two e-mails).
2. Because urgency is `low`, a refund issued at 23:10 local time is deferred and e-mailed at 08:00.
3. The e-mail shows:
   - refunded amount and the original amount;
   - when `fee_retained = 3.50`, the line "Cancellation fee (courier already assigned): 3.50 EUR";
   - the card (`brand •••• last4`) and the timeline "5–10 business days, depending on your bank".
4. Locales `en`, `de`, `fr`; for example the `de` subject is "Deine Erstattung über {amount} € ist unterwegs".

## External Dependencies

- topic: `parcelly.payment-events`
- service: identity-service
- table: notification_log

## Error Handling

Retried 5 times with exponential backoff (2 s → 32 s), then queue: `notifications.dead-letter`. Messages in the
dead-letter queue are replayed by on-call after the cause is fixed; the dedup key prevents double e-mails.
