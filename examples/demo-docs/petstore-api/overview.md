---
slug: petstore/overview
domain: petstore
entry_type: overview
summary: Petstore API overview — pet catalogue, adoption orders, payments and the order lifecycle
category: architecture
links:
  - slug: orders/place-order
    type: references
  - slug: notifications/on-order-placed
    library: notifications-service
    type: related_to
---

# Petstore API

The Petstore API is the backend of a fictional pet adoption shop. Customers browse the pet catalogue, place adoption orders, pay for them and can cancel or get a refund.

## Domains

| Domain | What it owns |
|--------|--------------|
| `pets` | Pet catalogue, availability, photos |
| `orders` | Adoption orders, reservations, cancellations, refunds |

## Order lifecycle

```mermaid
stateDiagram-v2
  [*] --> placed: POST /orders
  placed --> paid: payment captured
  placed --> cancelled: customer cancels / unpaid for 30 min
  paid --> delivered: pet handed over
  paid --> refunded: refund requested
  delivered --> refunded: refund within 14 days
```

## Key business rules

- A pet can be in at most one open order. Placing an order **reserves** the pet (`status = reserved`).
- An order may contain at most **3 pets**.
- Unpaid orders expire after **30 minutes**; the reservation is released (see `jobs/expire-unpaid-orders`).
- Refunds are possible up to **14 days** after delivery; the adoption fee is refunded in full, the delivery fee is not.

## External Dependencies

- service: payments-gateway — card authorisation and capture
- service: notifications-service — customer e-mails and push notifications
- topic: `petstore.order-events` — order lifecycle events
- table: pets
- table: orders
