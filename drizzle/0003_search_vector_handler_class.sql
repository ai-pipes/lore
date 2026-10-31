-- Add handler_class to search_vector so handler names (e.g. WidgetGetHandler) are searchable
DROP INDEX IF EXISTS "idx_documents_search";
ALTER TABLE "documents" DROP COLUMN IF EXISTS "search_vector";
ALTER TABLE "documents" ADD COLUMN "search_vector" tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english',
      coalesce(slug, '') || ' ' ||
      coalesce(domain, '') || ' ' ||
      coalesce(entry_type, '') || ' ' ||
      coalesce(handler_class, '') || ' ' ||
      coalesce(summary, '') || ' ' ||
      content
    )
  ) STORED;
CREATE INDEX "idx_documents_search" ON "documents" USING gin("search_vector");
