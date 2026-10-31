---
slug: schemas/orders
domain: orders
entry_type: schema
summary: orders, quotes and orders_outbox tables — delivery orders with status, price, tip, cancellation fee and outbox events
category: specification
links:
  - slug: orders/create-order
    type: related_to
  - slug: orders/quote-delivery
    type: related_to
  - slug: orders/cancel-order
    type: related_to
  - slug: jobs/expire-unpaid-orders
    type: related_to
  - slug: schemas/payments
    library: billing-service
    type: related_to
  - slug: schemas/assignments
    library: dispatch-service
    type: related_to
---

# orders table

One row per delivery order. Owned by orders-service.

## Columns

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | uuid | no | Primary key, UUID v7 |
| `customer_id` | uuid | no | identity-service user id (no FK, other database) |
| `quote_id` | uuid | no | FK → quotes.id, unique |
| `status` | varchar(20) | no | `created`, `paid`, `courier_assigned`, `picked_up`, `delivered`, `cancelled`, `expired` |
| `delivery_price` | numeric(8,2) | no | EUR, from the quote |
| `tip` | numeric(5,2) | no | Default `0.00`, 0.00–20.00 |
| `total` | numeric(8,2) | no | `delivery_price + tip`, EUR |
| `pickup` | jsonb | no | Address + coordinates |
| `dropoff` | jsonb | no | |
| `sender` | jsonb | no | `{ name, phone }` |
| `recipient` | jsonb | no | `{ name, phone }` |
| `pickup_notes`, `dropoff_notes` | varchar(500) | yes | |
| `idempotency_key` | uuid | no | Unique per `customer_id` |
| `courier_id` | uuid | yes | Set on `courier.assigned` |
| `assigned_at` | timestamptz | yes | |
| `picked_up_at`, `delivered_at` | timestamptz | yes | |
| `expires_at` | timestamptz | no | `created_at + 10 minutes` |
| `cancelled_at` | timestamptz | yes | |
| `cancelled_by` | uuid | yes | User id of the customer or ops agent |
| `cancelled_reason` | varchar(20) | yes | `customer`, `ops`, `payment_timeout` |
| `cancellation_fee` | numeric(8,2) | no | Default `0.00`; `3.50` when cancelled more than 2 minutes after courier assignment |
| `created_at`, `updated_at` | timestamptz | no | |

Indexes: `orders_customer_created_idx (customer_id, created_at DESC)`, `orders_expiry_idx (expires_at) WHERE status = 'created'`,
`orders_idem_key (customer_id, idempotency_key)` unique, `orders_status_updated_idx (status, updated_at)`.

Check constraints: `cancellation_fee IN (0.00, 3.00, 3.50)` (3.00 kept for orders cancelled before this release),
`tip BETWEEN 0 AND 20`, `total = delivery_price + tip`, `delivery_price >= 4.90`.

# quotes table

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | uuid | no | Primary key |
| `customer_id` | uuid | yes | Null for anonymous quotes |
| `pickup`, `dropoff` | jsonb | no | |
| `parcel` | jsonb | no | `{ weight_kg, size }`, `weight_kg <= 20` |
| `distance_km` | numeric(4,1) | no | `<= 25.0` |
| `surge_multiplier` | numeric(2,1) | no | `1.0` or `1.5` |
| `total` | numeric(8,2) | no | |
| `valid_until` | timestamptz | no | `created_at + 10 minutes` |
| `used_at` | timestamptz | yes | Set when turned into an order |
| `created_at` | timestamptz | no | |

Quotes older than 7 days and never used are deleted nightly.

# orders_outbox table

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | bigserial | no | Publishing order |
| `topic` | text | no | `parcelly.order-events` |
| `key` | uuid | no | `order_id` |
| `payload` | jsonb | no | Event body |
| `published_at` | timestamptz | yes | Set by the relay |

## Notes

table: orders
table: quotes
table: orders_outbox
