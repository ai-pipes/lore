---
slug: pets/get-pet
domain: pets
entry_type: query_handler
handler_class: GetPetHandler
http_method: GET
route: /api/v1/pets/{petId}
summary: Returns one pet with its availability, adoption fee, photos and health notes
category: specification
---

# GetPetHandler

Returns the full profile of a pet, including health notes that are not part of the list view.

## Request

| Parameter | Location | Type | Required | Description |
|-----------|----------|------|----------|-------------|
| `petId` | path | uuid | yes | Pet id |

## Response

`200 OK` — pet object: `id`, `name`, `species`, `breed`, `birth_date`, `status`, `adoption_fee`, `health_notes`, `photo_urls`, `reserved_until` (only when `status = reserved`).

## Business Logic

1. Load the pet via `IPetRepository.getById`.
2. If the pet is `reserved` and the reservation has expired but the cleanup job has not run yet, it is reported as `available`.

## External Dependencies

- `IPetRepository` — reads pets
- table: pets

## Error Handling

| HTTP code | Condition |
|-----------|-----------|
| `404` | Pet not found or soft-deleted |
