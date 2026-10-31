---
slug: gateway/routing
domain: gateway
entry_type: config
summary: Gateway route table — maps public path prefixes to backend services, auth requirements and timeouts
category: specification
links:
  - slug: gateway/overview
    type: references
  - slug: gateway/rate-limits
    type: related_to
  - slug: auth/sign-in
    library: identity-service
    type: references
  - slug: auth/refresh-token
    library: identity-service
    type: references
  - slug: users/get-profile
    library: identity-service
    type: references
  - slug: orders/quote-delivery
    library: orders-service
    type: references
  - slug: orders/create-order
    library: orders-service
    type: references
  - slug: orders/get-order
    library: orders-service
    type: references
  - slug: orders/cancel-order
    library: orders-service
    type: references
  - slug: payments/psp-webhook
    library: billing-service
    type: references
  - slug: refunds/issue-refund
    library: billing-service
    type: references
  - slug: dispatch/reassign-courier
    library: dispatch-service
    type: references
  - slug: tracking/ingest-courier-location
    library: tracking-service
    type: references
  - slug: tracking/get-eta
    library: tracking-service
    type: references
  - slug: tracking/live-stream
    library: tracking-service
    type: references
---

# Gateway routing

The route table lives in `gatewayd/routes.yaml` and is reloaded without restart on every deploy. Routes are matched
by **longest prefix first**, then by method. A path that matches no route returns `404 route_not_found`.

## Route table

| Method | Path | Upstream | Auth | Role | Timeout |
|--------|------|----------|------|------|---------|
| POST | `/api/v1/auth/sign-in` | service: identity-service | none | — | 5 s |
| POST | `/api/v1/auth/refresh` | service: identity-service | none (refresh token in body) | — | 5 s |
| GET | `/api/v1/users/me` | service: identity-service | JWT | any | 5 s |
| POST | `/api/v1/orders/quote` | service: orders-service | optional JWT | any | 5 s |
| POST | `/api/v1/orders` | service: orders-service | JWT | `customer` | 30 s |
| GET | `/api/v1/orders/{order_id}` | service: orders-service | JWT | `customer`, `ops` | 10 s |
| POST | `/api/v1/orders/{order_id}/cancel` | service: orders-service | JWT | `customer`, `ops` | 10 s |
| GET | `/api/v1/orders/{order_id}/eta` | service: tracking-service | JWT | `customer`, `ops` | 5 s |
| GET (WS) | `/api/v1/orders/{order_id}/stream` | service: tracking-service | JWT (query `access_token`) | `customer`, `ops` | idle 120 s |
| POST | `/api/v1/couriers/{courier_id}/location` | service: tracking-service | JWT | `courier` | 3 s |
| POST | `/api/v1/dispatch/{order_id}/reassign` | service: dispatch-service | JWT + VPN source | `ops` | 10 s |
| POST | `/api/v1/refunds` | service: billing-service | JWT | `ops` | 10 s |
| POST | `/webhooks/paylane` | service: billing-service | HMAC (checked upstream) + IP allowlist | — | 10 s |

The order-scoped `eta` and `stream` routes are more specific than `/api/v1/orders/{order_id}` and therefore win over the
orders-service prefix even though they share it.

## Rules

1. **Role check at the edge.** The `roles` claim of the JWT must intersect the route's role list, else `403 forbidden_role`.
   Ownership (is this *my* order?) is checked by the backend, never by the gateway.
2. **Ops routes** additionally require the source IP to be in the office/VPN CIDR list `10.40.0.0/16`.
3. **Webhooks** bypass JWT verification; the source must be in the Paylane IP allowlist (refreshed daily from Paylane's
   published list). Signature verification is done by billing-service (`payments/psp-webhook`).
4. **Body limits**: 64 KiB for all JSON routes, 4 KiB for courier location pings.
5. **Retries**: the gateway retries idempotent `GET` requests once on connect failure. `POST` is never retried by the
   gateway; clients send `Idempotency-Key` on `POST /api/v1/orders` instead.
6. **Versioning**: only `/api/v1` exists. A future `/api/v2` will be added as a parallel prefix, not a rewrite.

## Error Handling

| HTTP code | Body `error` | Condition |
|-----------|--------------|-----------|
| `401` | `invalid_token` | Missing, expired or badly signed JWT on a JWT route |
| `403` | `forbidden_role` | Role not allowed for the route |
| `403` | `forbidden_source` | Ops route from outside the VPN, webhook from outside the Paylane range |
| `404` | `route_not_found` | No route matches |
| `413` | `body_too_large` | Body over the route limit |
| `429` | `rate_limited` | See `gateway/rate-limits` |
| `502` | `upstream_unavailable` | Upstream refused the connection or all endpoints unhealthy |
| `504` | `upstream_timeout` | Upstream did not answer within the route timeout |
