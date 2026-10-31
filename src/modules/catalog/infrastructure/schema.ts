/** Drizzle tables owned by the catalog module. Combined into the app schema by platform/db.ts. */
import {
  pgTable,
  text,
  boolean,
  timestamp,
  primaryKey,
  index,
  serial,
  integer,
  unique,
  customType,
  real,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/** A pgvector column without a fixed dimension: each row carries the vector of its own model. */
const vector = customType<{ data: number[]; driverData: string }>({
  dataType: () => 'vector',
  toDriver: (value) => `[${value.join(',')}]`,
  fromDriver: (value) => value.slice(1, -1).split(',').map(Number),
});

export const namespaces = pgTable('namespaces', {
  id: text('id').primaryKey(),
  display_name: text('display_name').notNull(),
  system: boolean('system').notNull().default(false),
  created_at: timestamp('created_at', { mode: 'string', withTimezone: true }).defaultNow().notNull(),
});

export const libraries = pgTable(
  'libraries',
  {
    id: text('id').primaryKey(),
    display_name: text('display_name').notNull(),
    namespace_id: text('namespace_id')
      .notNull()
      .default('default')
      .references(() => namespaces.id),
    created_at: timestamp('created_at', { mode: 'string', withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('idx_libraries_namespace').on(t.namespace_id)],
);

export const project_keys = pgTable(
  'project_keys',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    namespace_id: text('namespace_id')
      .notNull()
      .references(() => namespaces.id),
    library_id: text('library_id').references(() => libraries.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    prefix: text('prefix').notNull(),
    hash: text('hash').notNull().unique(),
    // FK to users(id) ON DELETE SET NULL exists in the SQL migration only (identity owns users).
    created_by: uuid('created_by'),
    created_at: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
    last_used_at: timestamp('last_used_at', { mode: 'date', withTimezone: true }),
    revoked_at: timestamp('revoked_at', { mode: 'date', withTimezone: true }),
  },
  (t) => [index('idx_project_keys_namespace').on(t.namespace_id)],
);

export const versions = pgTable(
  'versions',
  {
    id: text('id').notNull(),
    library_id: text('library_id')
      .notNull()
      .references(() => libraries.id),
    branch: text('branch'),
    is_current: boolean('is_current').notNull().default(false),
    pushed_at: timestamp('pushed_at', { mode: 'string', withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.library_id] }),
    index('idx_versions_branch').on(t.library_id, t.branch),
    index('idx_versions_branch_head').on(t.branch, t.library_id, t.pushed_at.desc(), t.id.desc()),
  ],
);

export const documents = pgTable(
  'documents',
  {
    id: text('id').primaryKey(),
    // FK to libraries(id) exists in the SQL migrations only.
    library_id: text('library_id').notNull(),
    version_id: text('version_id').notNull(),
    slug: text('slug').notNull(),
    domain: text('domain'),
    project_name: text('project_name'),
    entry_type: text('entry_type'),
    handler_class: text('handler_class'),
    http_method: text('http_method'),
    route: text('route'),
    summary: text('summary'),
    content: text('content').notNull(),
    generated_at: text('generated_at'),
    content_hash: text('content_hash'),
    category: text('category'),
    // Who wrote the document (insights only). FK to users(id) ON DELETE SET NULL (identity) exists
    // in the SQL migrations only; the name stays when the user is deleted.
    author_user_id: uuid('author_user_id'),
    author_name: text('author_name'),
  },
  (t) => [
    unique('uq_documents_lib_ver_slug').on(t.library_id, t.version_id, t.slug),
    index('idx_documents_library_version').on(t.library_id, t.version_id),
  ],
);

export const document_metadata = pgTable(
  'document_metadata',
  {
    id: serial('id').primaryKey(),
    document_id: text('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    value: text('value').notNull(),
  },
  (t) => [index('idx_metadata_key_value').on(t.key, t.value)],
);

export const document_vectors = pgTable(
  'document_vectors',
  {
    document_id: text('document_id')
      .primaryKey()
      .references(() => documents.id, { onDelete: 'cascade' }),
    library_id: text('library_id').notNull(),
    version_id: text('version_id').notNull(),
    embedding: vector('embedding'),
    model: text('model'),
  },
  (t) => [index('idx_vectors_lib_ver').on(t.library_id, t.version_id)],
);

export const document_images = pgTable(
  'document_images',
  {
    id: serial('id').primaryKey(),
    // FK to libraries(id) ON DELETE CASCADE exists in the SQL migrations only.
    library_id: text('library_id').notNull(),
    version_id: text('version_id').notNull(),
    slug: text('slug').notNull(),
    filename: text('filename').notNull(),
    file_size: integer('file_size'),
    image_hash: text('image_hash'),
    mime_type: text('mime_type').notNull().default('image/png'),
    created_at: timestamp('created_at', { mode: 'string', withTimezone: true }).defaultNow(),
  },
  (t) => [
    unique('uq_doc_images_lib_ver_slug_file').on(t.library_id, t.version_id, t.slug, t.filename),
    index('idx_doc_images_lib_ver_slug').on(t.library_id, t.version_id, t.slug),
  ],
);

export const document_links = pgTable(
  'document_links',
  {
    id: serial('id').primaryKey(),
    from_document_id: text('from_document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    to_slug: text('to_slug').notNull(),
    to_library_id: text('to_library_id'),
    link_type: text('link_type').notNull().default('references'),
    source: text('source').notNull().default('manual'), // 'manual' | 'auto'
    confidence: real('confidence'), // null for manual, 0.0–1.0 for auto
    created_at: timestamp('created_at', { mode: 'string', withTimezone: true }).defaultNow(),
  },
  (t) => [
    index('idx_doc_links_from').on(t.from_document_id),
    index('idx_doc_links_to_slug').on(t.to_slug),
  ],
);
