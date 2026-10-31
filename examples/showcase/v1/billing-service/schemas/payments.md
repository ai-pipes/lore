---
slug: schemas/payments
domain: payments
entry_type: schema
summary: payments, refunds and psp_events tables — payment intents per order, refund attempts and processed Paylane webhooks
category: specification
links:
  - slug: payments/on-order-created
    type: related_to
  - slug: payments/capture-payment
    type: related_to
  - slug: refunds/issue-refund
    type: related_to
  - slug: schemas/orders
    library: orders-service
    type: references
---

# payments, refunds, psp_events

Billing's Postgres tables. All ids are UUID v7, all timestamps `timestamptz` in UTC, all amounts integer cents in EUR.
`order_id` refers to table: orders in orders-service (`schemas/orders`) but there is no cross-database foreign key.

## table: payments

| Column | Type | Null | Description |
|--------|------|------|-------------|
| `id` | uuid | no | Primary key |
| `order_id` | uuid | no | Unique — one payment per order |
| `customer_id` | uuid | no | |
| `psp` | text | no | `paylane` |
| `psp_intent_id` | text | no | Unique, `pi_...` |
| `amount_cents` | integer | no | Order total, 490–3735 |
| `captured_amount_cents` | integer | yes | Set on capture |
| `fee_cents` | integer | no | Withheld cancellation fee, `0` or `300`; default `0` |
| `currency` | char(3) | no | `EUR` |
| `status` | text | no | See below |
| `expires_at` | timestamptz | no | `order.created_at + 15 min` |
| `authorized_at` | timestamptz | yes | |
| `captured_at` | timestamptz | yes | |
| `created_at` | timestamptz | no | |
| `updated_at` | timestamptz | no | |

Statuses: `requires_authorization`, `authorized`, `captured`, `refund_pending`, `refunded`, `voided`, `expired`,
`failed`, `amount_mismatch`.

Indexes: `payments_order_id_key` (unique), `payments_psp_intent_id_key` (unique),
`payments_status_expires_at_idx` on `(status, expires_at)` for the reconciliation report.

Check constraints: `amount_cents BETWEEN 490 AND 3735`, `fee_cents IN (0, 300)`, `currency = 'EUR'`.

## table: refunds

| Column | Type | Null | Description |
|--------|------|------|-------------|
| `id` | uuid | no | Primary key |
| `payment_id` | uuid | no | FK -> `payments.id` |
| `order_id` | uuid | no | |
| `psp_refund_id` | text | yes | `re_...`, set after the Paylane call |
| `amount_cents` | integer | no | `captured_amount_cents - fee_cents` |
| `reason` | text | no | `order_cancelled`, `delivery_failed`, `parcel_damaged`, `goodwill` |
| `status` | text | no | `pending`, `succeeded`, `failed` |
| `requested_by` | text | no | `system` or the user id of a support agent |
| `idempotency_key` | text | no | Unique |
| `created_at` | timestamptz | no | |
| `succeeded_at` | timestamptz | yes | |

Partial unique index `refunds_one_active_per_order` on `order_id WHERE status IN ('pending', 'succeeded')` — v1 allows
exactly one refund per order.

## table: psp_events

| Column | Type | Description |
|--------|------|-------------|
| `event_id` | text | Primary key, Paylane `evt_...` |
| `type` | text | Webhook type |
| `received_at` | timestamptz | |

Rows older than 30 days are deleted nightly (Paylane retries for 3 days at most).

## table: billing_outbox

Transactional outbox for `payment.captured`, `payment.failed` and `refund.issued`; rows are deleted after the relay
publishes them to topic: `parcelly.payment-events`.

## Retention

Payments and refunds are kept 10 years (accounting law); `customer_id` is pseudonymised 30 days after account deletion.
