-- Provenance of document links: 'manual' (declared in frontmatter) or 'auto' (LLM enrichment)
ALTER TABLE "document_links" ADD COLUMN IF NOT EXISTS "source" text NOT NULL DEFAULT 'manual';
--> statement-breakpoint
-- Confidence score for auto links (0.0–1.0); NULL for manual links
ALTER TABLE "document_links" ADD COLUMN IF NOT EXISTS "confidence" real;
