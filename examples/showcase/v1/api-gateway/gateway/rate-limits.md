---
slug: gateway/rate-limits
domain: gateway
entry_type: config
summary: Gateway rate limits per user, per IP and per courier, with burst sizes, headers and Redis synchronisation
category: specification
links:
  - slug: gateway/overview
    type: references
  - slug: gateway/routing
    type: references
  - slug: orders/quote-delivery
    library: orders-service
    type: related_to
  - slug: auth/sign-in
    library: identity-service
    type: related_to
  - slug: tracking/ingest-courier-location
    library: tracking-service
    type: related_to
---

# Gateway rate limits

Rate limits protect the backends from abusive clients and runaway retries. They are token buckets evaluated locally on
each gateway replica and reconciled through Redis every second, so the effective limit across 6 replicas can overshoot
by at most one second of traffic.

## Limits

| Bucket | Key | Limit | Burst | Applies to |
|--------|-----|-------|-------|------------|
| `user` | JWT `sub` | 60 req/min | 20 | Every JWT-authenticated route except courier location |
| `anon-ip` | client IP | 600 req/min | 100 | Anonymous `POST /api/v1/orders/quote` |
| `sign-in-ip` | client IP | 10 req/min | 5 | `POST /api/v1/auth/sign-in` |
| `sign-in-account` | lower-cased e-mail | 5 req / 15 min | 5 | `POST /api/v1/auth/sign-in` |
| `refresh` | refresh token family | 10 req/min | 3 | `POST /api/v1/auth/refresh` |
| `courier-location` | courier id | 1 req / 2 s | 3 | `POST /api/v1/couriers/{courier_id}/location` |
| `ws-connect` | JWT `sub` | 5 connections open | — | `/api/v1/orders/{order_id}/stream` |
| `ops` | JWT `sub` | 300 req/min | 50 | Routes with role `ops` |
| `webhook` | none | unlimited | — | `/webhooks/paylane` (never limited, PSP retries are costly) |

The client IP is the left-most address of `X-Forwarded-For` as set by the load balancer; client-supplied values are
discarded.

## Business Logic

1. Resolve the bucket from the route (a route can hit two buckets, e.g. sign-in checks `sign-in-ip` **and** `sign-in-account`).
2. Take one token from the local bucket. If empty, respond `429`.
3. Every 1 s each replica pushes its consumed counts to Redis (`INCRBY` on `rl:{bucket}:{key}:{minute}`) and pulls
   the global totals; if the global total is above the limit, the local bucket is drained until the next minute.
4. If Redis is unreachable for more than 5 s the replica falls back to local-only limits divided by the replica count
   (fail-open with reduced limits, never fail-closed).
5. Ops staff can add a temporary override per user with `gatewayctl ratelimit override --sub <id> --limit 600 --ttl 1h`.

## Response headers

| Header | Example | Description |
|--------|---------|-------------|
| `RateLimit-Limit` | `60` | Limit of the most restrictive bucket hit |
| `RateLimit-Remaining` | `12` | Tokens left |
| `RateLimit-Reset` | `37` | Seconds until the bucket refills |
| `Retry-After` | `37` | Only on `429` |

## Error Handling

| HTTP code | Body | Condition |
|-----------|------|-----------|
| `429` | `{"error":"rate_limited","bucket":"user"}` | Any bucket exhausted |
| `429` | `{"error":"rate_limited","bucket":"sign-in-account"}` | 5 failed or successful sign-ins in 15 min for one e-mail |

## Notes

- Quote requests from signed-in customers count against the `user` bucket, not `anon-ip`.
- The customer app polls `GET /api/v1/orders/{order_id}/eta` at most every 15 s, i.e. 4 req/min of the 60 req/min budget.
  Live tracking should use the WebSocket stream instead of polling.
- Dashboards: "Gateway / Rate limiting" in Grafana; alert `GatewayRateLimit429Spike` fires when 429s exceed 2% of traffic for 10 minutes.
