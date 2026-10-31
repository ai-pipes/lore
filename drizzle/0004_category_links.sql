-- Feature 1: Add category column
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "category" text;
--> statement-breakpoint

-- Rebuild search_vector to include category
-- GENERATED ALWAYS AS columns must be dropped and re-created to change expression
DROP INDEX IF EXISTS "idx_documents_search";
--> statement-breakpoint
ALTER TABLE "documents" DROP COLUMN IF EXISTS "search_vector";
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "search_vector" tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english',
      coalesce(slug, '') || ' ' ||
      coalesce(domain, '') || ' ' ||
      coalesce(entry_type, '') || ' ' ||
      coalesce(handler_class, '') || ' ' ||
      coalesce(category, '') || ' ' ||
      coalesce(summary, '') || ' ' ||
      content
    )
  ) STORED;
--> statement-breakpoint
CREATE INDEX "idx_documents_search" ON "documents" USING gin("search_vector");
--> statement-breakpoint

-- Feature 2: Cross-document links table
CREATE TABLE IF NOT EXISTS "document_links" (
  "id" serial PRIMARY KEY NOT NULL,
  "from_document_id" text NOT NULL
    REFERENCES "documents"("id") ON DELETE CASCADE,
  "to_slug" text NOT NULL,
  "to_library_id" text,
  "link_type" text NOT NULL DEFAULT 'references',
  "created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "idx_doc_links_from" ON "document_links" USING btree ("from_document_id");
--> statement-breakpoint
CREATE INDEX "idx_doc_links_to_slug" ON "document_links" USING btree ("to_slug");
