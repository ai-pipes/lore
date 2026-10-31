---
slug: schemas/orders
domain: orders
entry_type: schema
summary: orders table — adoption orders with status, totals, payment and delivery data
category: specification
---

# orders table

One row per adoption order.

## Columns

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | uuid | no | Primary key |
| `customer_id` | uuid | no | |
| `status` | varchar(16) | no | `placed`, `paid`, `delivered`, `cancelled`, `refunded` |
| `total` | numeric(10,2) | no | Adoption fees + delivery fee − discount |
| `delivery_fee` | numeric(10,2) | no | 0 for pickup, 15.00 for home delivery |
| `payment_id` | text | yes | Id at the payment gateway |
| `cancel_reason` | text | yes | e.g. `payment_timeout`, `customer_request` |
| `created_at` | timestamptz | no | |
| `delivered_at` | timestamptz | yes | Start of the 14-day refund window |
| `idempotency_key` | text | no | Unique per customer |

## Notes

table: orders. Pets of an order are stored in table: order_pets (`order_id`, `pet_id`, `adoption_fee`).
