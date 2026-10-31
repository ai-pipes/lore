---
slug: payments/psp-webhook
domain: payments
entry_type: handler
handler_class: PaylaneWebhookHandler
http_method: POST
route: /webhooks/paylane
summary: Receives Paylane webhooks, verifies the HMAC signature, de-duplicates them and drives capture, failure and refund status
category: specification
links:
  - slug: payments/capture-payment
    type: calls
  - slug: refunds/issue-refund
    type: related_to
  - slug: schemas/payments
    type: references
  - slug: decisions/psp-choice
    type: references
  - slug: gateway/routing
    library: api-gateway
    type: references
---

# PaylaneWebhookHandler

Public endpoint called by service: paylane for every payment intent and refund state change. It is routed by
api-gateway without JWT verification (see `gateway/routing`); authenticity comes from the signature.

## Request

| Field | Location | Type | Required | Description |
|-------|----------|------|----------|-------------|
| `Paylane-Signature` | header | string | yes | `t=<unix>,v1=<hex HMAC-SHA256 of "t.body">` |
| `id` | body | string | yes | Paylane event id (`evt_...`) |
| `type` | body | string | yes | See the table below |
| `data.object` | body | object | yes | The intent or refund |
| `created` | body | integer | yes | Unix seconds |

Handled event types:

| `type` | Action |
|--------|--------|
| `payment_intent.authorized` | Call `payments/capture-payment` |
| `payment_intent.payment_failed` | `payments.status = failed`, publish `payment.failed` |
| `payment_intent.expired` | `payments.status = expired` (the order expires in orders-service anyway) |
| `refund.succeeded` | `refunds.status = succeeded`, publish `refund.issued` |
| `refund.failed` | `refunds.status = failed`, alert billing on-call |
| anything else | `200`, ignored |

## Response

`200 OK` with an empty body as soon as the event is stored. Paylane retries any non-2xx response for up to 3 days.

## Business Logic

1. Verify the signature with the webhook secret `PAYLANE_WEBHOOK_SECRET` (two secrets accepted during rotation). Reject if `t` is more than 5 minutes from now.
2. Insert the event id into table: psp_events (`ON CONFLICT DO NOTHING`). If it already existed, return `200` — duplicate delivery.
3. Load the payment by `data.object.metadata.order_id` from table: payments, locking the row (`SELECT ... FOR UPDATE`).
4. Ignore events that would move the payment backwards (e.g. `authorized` after `captured`); state order is `requires_authorization -> authorized -> captured -> refunded`.
5. Dispatch by `type` as in the table above. Capture runs in the same request but outside the row lock.
6. Return `200`.

## External Dependencies

- service: paylane
- table: psp_events
- table: payments
- table: refunds
- topic: `parcelly.payment-events`

## Error Handling

| HTTP code | Condition |
|-----------|-----------|
| `400` | Malformed JSON or missing `id` / `type` |
| `401` | Missing or invalid `Paylane-Signature`, or timestamp outside the 5-minute tolerance |
| `404` | No payment for `metadata.order_id` (Paylane retries; alert after 10 occurrences in 5 min) |
| `500` | Database unavailable — Paylane retries |
