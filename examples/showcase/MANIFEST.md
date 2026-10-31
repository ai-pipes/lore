# Parcelly — showcase dataset manifest

Fictional company **Parcelly**: a last-mile parcel delivery platform (customers order a courier to pick up a parcel
and deliver it across the city within ~2 hours). Seven services, each one Lore library.

## End-to-end flow

1. Client -> `api-gateway` -> `orders-service` `POST /api/v1/orders` (after `orders/quote-delivery`).
2. orders publishes `order.created` to topic `parcelly.order-events`.
3. `billing-service` consumes it (`payments/on-order-created`) and creates a payment intent at the PSP (Stripe-like, "Paylane").
4. PSP webhook (`payments/psp-webhook`) -> `payments/capture-payment` -> publishes `payment.captured` to `parcelly.payment-events`.
5. `dispatch-service` consumes `payment.captured` (`dispatch/on-payment-captured`), calls `dispatch/assign-courier`, publishes `courier.assigned` to `parcelly.dispatch-events`.
6. `tracking-service` (`tracking/on-courier-assigned`) starts ETA tracking; couriers' app posts GPS to `tracking/ingest-courier-location`; customers watch `tracking/live-stream` and `tracking/get-eta`.
7. On delivery dispatch publishes `delivery.completed`.
8. `notifications-service` sends e-mail/push/SMS on order.created, courier.assigned, delivery.completed, refund.issued.
9. Cancellation: `orders/cancel-order` publishes `order.cancelled` -> billing `payments/on-order-cancelled` -> `refunds/issue-refund` -> `refund.issued`.
   Dispatch also consumes `order.cancelled` to release the courier.

Business rules to keep consistent everywhere (v1):
- Free cancellation until a courier is assigned; after assignment a cancellation fee of 3.00 EUR applies; after pickup cancellation is impossible (409).
- Unpaid orders expire after 15 minutes (`jobs/expire-unpaid-orders`).
- Delivery price: base 4.90 EUR + 0.80 EUR/km, x1.5 surge when fewer than 3 couriers are free within 3 km. Max distance 25 km. Max parcel weight 20 kg.
- Courier assignment: nearest free courier within 5 km radius, expanding to 8 km after 2 minutes; offer timeout 45 s; max 3 offers then `ops/no-couriers-available` alert.
- Stale assignment: courier hasn't moved toward pickup for 10 min -> reassign (`jobs/reassign-stale-assignments`).
- Refunds: full refund minus cancellation fee; refunds go back to the original payment method within 5–10 business days.
- Auth: JWT access tokens 15 min, refresh tokens 30 days, rotated on every refresh; gateway verifies JWT at the edge.
- Rate limits at gateway: 60 req/min per user, 600 req/min per IP for anonymous quote requests... keep numbers consistent with `gateway/rate-limits`.
- Currency EUR, timestamps UTC ISO-8601, ids UUID v7.

Topics: `parcelly.order-events`, `parcelly.payment-events`, `parcelly.dispatch-events`, `parcelly.identity-events`.
Dead letter queues: `<service>.dead-letter`.

## Libraries and slugs (use EXACTLY these slugs; cross-library links need `library:`)

### api-gateway
- `gateway/overview` (architecture, with a mermaid flowchart of all services)
- `gateway/routing` (route table: path prefix -> service)
- `gateway/rate-limits`
- `decisions/gateway-auth-at-edge` (ADR)

### identity-service
- `identity/overview`
- `auth/sign-in` (POST /api/v1/auth/sign-in)
- `auth/refresh-token` (POST /api/v1/auth/refresh)
- `users/get-profile` (GET /api/v1/users/me)
- `events/user-registered`
- `schemas/users`

### orders-service
- `orders/overview` (with mermaid stateDiagram of order lifecycle: created -> paid -> courier_assigned -> picked_up -> delivered; cancelled; expired)
- `orders/quote-delivery` (POST /api/v1/orders/quote)
- `orders/create-order` (POST /api/v1/orders)
- `orders/get-order` (GET /api/v1/orders/{order_id})
- `orders/cancel-order` (POST /api/v1/orders/{order_id}/cancel)
- `events/order-created`
- `events/order-cancelled`
- `jobs/expire-unpaid-orders`
- `schemas/orders`
- `ops/stuck-orders` (runbook)

### billing-service
- `billing/overview` (mermaid sequenceDiagram of payment flow)
- `payments/on-order-created`
- `payments/psp-webhook` (POST /webhooks/paylane)
- `payments/capture-payment` (service)
- `payments/on-order-cancelled`
- `refunds/issue-refund` (POST /api/v1/refunds, also called internally)
- `events/payment-captured`
- `events/refund-issued`
- `schemas/payments`
- `decisions/psp-choice` (ADR: why Paylane)

### dispatch-service
- `dispatch/overview` (mermaid flowchart of assignment algorithm)
- `dispatch/on-payment-captured`
- `dispatch/assign-courier` (service)
- `dispatch/reassign-courier` (POST /api/v1/dispatch/{order_id}/reassign, ops-only)
- `dispatch/on-order-cancelled`
- `jobs/reassign-stale-assignments`
- `events/courier-assigned`
- `events/delivery-completed`
- `schemas/assignments`
- `ops/no-couriers-available` (runbook)

### tracking-service
- `tracking/overview`
- `tracking/on-courier-assigned`
- `tracking/ingest-courier-location` (POST /api/v1/couriers/{courier_id}/location)
- `tracking/get-eta` (GET /api/v1/orders/{order_id}/eta)
- `tracking/live-stream` (GET /api/v1/orders/{order_id}/stream, WebSocket)

### notifications-service
- `notifications/overview`
- `notifications/send-notification` (internal service)
- `notifications/on-order-created`
- `notifications/on-courier-assigned`
- `notifications/on-delivery-completed`
- `notifications/on-refund-issued`
- `schemas/notification-log`
