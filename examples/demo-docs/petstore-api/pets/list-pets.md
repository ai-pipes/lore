---
slug: pets/list-pets
domain: pets
entry_type: query_handler
handler_class: ListPetsHandler
http_method: GET
route: /api/v1/pets
summary: Lists pets in the catalogue with filters by species, status and price, paginated
category: specification
---

# ListPetsHandler

Returns a paginated list of pets. Public endpoint, no authentication required. Reserved and adopted pets are hidden unless `status` is given explicitly.

## Request

| Parameter | Location | Type | Required | Description |
|-----------|----------|------|----------|-------------|
| `species` | query | string | no | `dog`, `cat`, `bird`, `fish`, `reptile` |
| `status` | query | string | no | `available` (default), `reserved`, `adopted` |
| `max_price` | query | decimal | no | Upper bound for the adoption fee |
| `page` | query | int | no | Page number, starts at 1 |
| `page_size` | query | int | no | 1–100, default 20 |

## Response

`200 OK`

| Field | Type | Description |
|-------|------|-------------|
| `items[]` | Pet | See `schemas/pets` fields: `id`, `name`, `species`, `status`, `adoption_fee`, `photo_urls` |
| `total` | int | Total number of matching pets |

## Business Logic

1. Validate filters; `page_size` above 100 is clamped to 100.
2. Query `IPetRepository.search` with the filters. Results are ordered by `listed_at` descending.
3. Photo URLs are signed CDN URLs valid for 1 hour.

## External Dependencies

- `IPetRepository` — reads pets
- table: pets

## Error Handling

| HTTP code | Condition |
|-----------|-----------|
| `400` | Unknown `species` or `status`, negative `max_price` |
