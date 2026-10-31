-- Vectors of any dimension, each tagged with the embedding model that produced it.
-- Rows from before this migration have no model and are ignored by vector search until reindexed.
ALTER TABLE "document_vectors" ALTER COLUMN "embedding" TYPE vector;--> statement-breakpoint
ALTER TABLE "document_vectors" ADD COLUMN "model" text;
