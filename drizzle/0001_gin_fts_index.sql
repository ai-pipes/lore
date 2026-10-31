ALTER TABLE "documents" ADD COLUMN "search_vector" tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english',
      coalesce(slug, '') || ' ' ||
      coalesce(domain, '') || ' ' ||
      coalesce(entry_type, '') || ' ' ||
      coalesce(summary, '') || ' ' ||
      content
    )
  ) STORED;
--> statement-breakpoint
CREATE INDEX "idx_documents_search" ON "documents" USING gin("search_vector");
