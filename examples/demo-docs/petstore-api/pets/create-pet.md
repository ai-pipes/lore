---
slug: pets/create-pet
domain: pets
entry_type: handler
handler_class: CreatePetHandler
http_method: POST
route: /api/v1/pets
summary: Staff endpoint that adds a pet to the catalogue with species, fee and health notes
category: specification
---

# CreatePetHandler

Adds a new pet to the catalogue. Only users with the `staff` role may call it.

## Request

Body (JSON):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | 1–60 characters |
| `species` | string | yes | `dog`, `cat`, `bird`, `fish`, `reptile` |
| `breed` | string | no | |
| `birth_date` | date | no | Must not be in the future |
| `adoption_fee` | decimal | yes | 0–5000, two decimals |
| `health_notes` | string | no | Max 2000 characters |

## Response

`201 Created` — the created pet with `status = available`.

## Business Logic

1. Require role `staff`.
2. Validate the body. `adoption_fee` for `fish` must be at most 200.
3. Insert via `IPetRepository.insert` with `status = available` and `listed_at = now()`.
4. Publish `pet.listed` to topic: `petstore.pet-events`.

## External Dependencies

- `IPetRepository` — inserts pets
- topic: `petstore.pet-events`
- table: pets

## Error Handling

| HTTP code | Condition |
|-----------|-----------|
| `400` | Validation failed |
| `403` | Caller is not staff |
