CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE "document_metadata" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_vectors" (
	"document_id" text PRIMARY KEY NOT NULL,
	"library_id" text NOT NULL,
	"version_id" text NOT NULL,
	"embedding" vector(1536)
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" text PRIMARY KEY NOT NULL,
	"library_id" text NOT NULL,
	"version_id" text NOT NULL,
	"slug" text NOT NULL,
	"domain" text,
	"project_name" text,
	"entry_type" text,
	"handler_class" text,
	"http_method" text,
	"route" text,
	"summary" text,
	"content" text NOT NULL,
	"generated_at" text,
	"content_hash" text,
	CONSTRAINT "uq_documents_lib_ver_slug" UNIQUE("library_id","version_id","slug")
);
--> statement-breakpoint
CREATE TABLE "libraries" (
	"id" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "versions" (
	"id" text NOT NULL,
	"library_id" text NOT NULL,
	"branch" text,
	"is_current" boolean DEFAULT false NOT NULL,
	"pushed_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "versions_id_library_id_pk" PRIMARY KEY("id","library_id")
);
--> statement-breakpoint
ALTER TABLE "document_metadata" ADD CONSTRAINT "document_metadata_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_vectors" ADD CONSTRAINT "document_vectors_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_library_id_libraries_id_fk" FOREIGN KEY ("library_id") REFERENCES "public"."libraries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "versions" ADD CONSTRAINT "versions_library_id_libraries_id_fk" FOREIGN KEY ("library_id") REFERENCES "public"."libraries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_metadata_key_value" ON "document_metadata" USING btree ("key","value");--> statement-breakpoint
CREATE INDEX "idx_vectors_lib_ver" ON "document_vectors" USING btree ("library_id","version_id");--> statement-breakpoint
CREATE INDEX "idx_documents_library_version" ON "documents" USING btree ("library_id","version_id");--> statement-breakpoint
CREATE INDEX "idx_versions_branch" ON "versions" USING btree ("library_id","branch");