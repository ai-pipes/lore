CREATE TABLE document_images (
  id          serial      PRIMARY KEY,
  library_id  text        NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
  version_id  text        NOT NULL,
  slug        text        NOT NULL,
  filename    text        NOT NULL,
  file_size   integer,
  image_hash  text,
  mime_type   text        NOT NULL DEFAULT 'image/png',
  created_at  timestamp   DEFAULT now(),
  UNIQUE(library_id, version_id, slug, filename)
);

CREATE INDEX idx_doc_images_lib_ver_slug ON document_images(library_id, version_id, slug);
