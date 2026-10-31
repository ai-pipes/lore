---
slug: pets/upload-pet-photo
domain: pets
entry_type: handler
handler_class: UploadPetPhotoHandler
http_method: POST
route: /api/v1/pets/{petId}/photos
summary: Uploads a JPEG or PNG photo for a pet, up to 8 photos per pet
category: specification
---

# UploadPetPhotoHandler

Stores a photo of a pet in object storage and appends it to the pet's gallery.

## Request

`multipart/form-data` with a single `file` part (JPEG or PNG, max 5 MB). Path parameter `petId` (uuid).

## Response

`201 Created` — `{ "photo_url": "..." }`.

## Business Logic

1. Require role `staff`.
2. Reject if the pet already has 8 photos.
3. Detect the image type from its content (the client content type is ignored), strip EXIF metadata.
4. Upload to service: object-storage under `pets/{petId}/{uuid}.jpg`.
5. Append the URL via `IPetRepository.addPhoto`.

## External Dependencies

- service: object-storage
- `IPetRepository` — updates pet photos
- table: pet_photos

## Error Handling

| HTTP code | Condition |
|-----------|-----------|
| `404` | Pet not found |
| `409` | Pet already has 8 photos |
| `413` | File larger than 5 MB |
| `415` | Not a JPEG or PNG |
