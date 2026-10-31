import { notInArray } from 'drizzle-orm';
import { getDb } from '../platform/db.js';
import * as catalogSchema from '../modules/catalog/infrastructure/schema.js';
import { upsertLibrary } from '../modules/catalog/infrastructure/pg-libraries.js';
import { createVersion, promoteVersion } from '../modules/catalog/infrastructure/pg-versions.js';
import { insertDocument } from '../modules/catalog/infrastructure/pg-documents.js';
import type { LinkInput } from '../modules/catalog/infrastructure/pg-documents.js';
import * as chatSchema from '../modules/chat/infrastructure/schema.js';
import * as identitySchema from '../modules/identity/infrastructure/schema.js';
import { createPgIdentity } from '../modules/identity/infrastructure/compose.js';
import { sessionExpiry } from '../modules/identity/domain/session-policy.js';
import type { Role } from '../modules/identity/domain/user.js';

const schema = { ...catalogSchema, ...chatSchema, ...identitySchema };

export const TEST_API_KEY = process.env.LORE_API_KEY ?? 'changeme';

export async function cleanDb(): Promise<void> {
  const db = getDb();
  // Delete in FK-safe order
  await db.delete(schema.project_keys);
  await db.delete(schema.chat_messages);
  await db.delete(schema.chat_sessions);
  await db.delete(schema.cli_logins);
  await db.delete(schema.oidc_pending);
  await db.delete(schema.api_tokens);
  await db.delete(schema.web_sessions);
  await db.delete(schema.users);
  await db.delete(schema.document_images);
  await db.delete(schema.document_links);
  await db.delete(schema.document_vectors);
  await db.delete(schema.document_metadata);
  await db.delete(schema.documents);
  await db.delete(schema.versions);
  await db.delete(schema.libraries);
  await db.delete(schema.namespaces).where(notInArray(schema.namespaces.id, ['default', 'insights']));
}

let testUserSeq = 0;

export interface TestUser {
  id: string;
  login: string;
  password: string;
  /** A personal `sk_` token of the user. */
  token: string;
  /** `lore_session=<id>` of a fresh web session. */
  cookie: string;
  bearer: { authorization: string };
}

/** Creates a user (scrypt password), an `sk_` token and a web session through the Postgres adapters. */
export async function createTestUser(
  opts: { login?: string; role?: Role; password?: string; displayName?: string } = {},
): Promise<TestUser> {
  const d = createPgIdentity({});
  const login = (opts.login ?? `user-${process.pid}-${++testUserSeq}`).trim().toLowerCase();
  const password = opts.password ?? 'test-password-123';
  const user = await d.users.insert({
    login,
    displayName: opts.displayName ?? login,
    role: opts.role ?? 'member',
    passwordHash: await d.hasher.hash(password),
  });
  if (!user) throw new Error(`createTestUser: login ${login} is taken`);
  const token = d.secrets.random('sk_');
  await d.tokens.insert({ userId: user.id, name: 'test', prefix: token.slice(0, 8), hash: d.secrets.sha256Hex(token) });
  const sessionId = d.secrets.random('');
  await d.sessions.insert({ idHash: d.secrets.sha256Hex(sessionId), userId: user.id, expiresAt: sessionExpiry(d.clock.now()), method: 'password', deadline: null });
  return { id: user.id, login, password, token, cookie: `lore_session=${sessionId}`, bearer: { authorization: `Bearer ${token}` } };
}

export async function createTestLibrary(id = 'test-lib', displayName = 'Test Library') {
  return upsertLibrary(id, displayName);
}

export async function createTestVersion(libraryId = 'test-lib', versionId = 'v1', branch?: string) {
  const version = await createVersion(versionId, libraryId, branch);
  await promoteVersion(libraryId, versionId);
  return version;
}

export async function createTestDocument(
  libraryId = 'test-lib',
  versionId = 'v1',
  overrides: Partial<{
    slug: string;
    content: string;
    domain: string;
    entry_type: string;
    summary: string;
    category: string;
    links: LinkInput[];
  }> = {},
) {
  return insertDocument({
    library_id: libraryId,
    version_id: versionId,
    slug: overrides.slug ?? 'test/doc',
    content: overrides.content ?? '# Test\n\nSome content here.',
    domain: overrides.domain,
    entry_type: overrides.entry_type,
    summary: overrides.summary,
    category: overrides.category,
    links: overrides.links,
  });
}

/** Build a multipart/form-data body for Fastify inject (text fields only) */
export function buildMultipart(fields: Record<string, string>): { body: string; contentType: string } {
  const boundary = '----LoreTestBoundary';
  const parts = Object.entries(fields).map(
    ([name, value]) =>
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}`,
  );
  const body = parts.join('\r\n') + `\r\n--${boundary}--`;
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

/** Build a multipart/form-data body with text fields + one binary file part */
export function buildFileMultipart(
  fields: Record<string, string>,
  file: { fieldname: string; filename: string; content: Buffer; mimetype?: string },
): { body: Buffer; contentType: string } {
  const boundary = '----LoreTestFileBoundary';
  const crlf = '\r\n';
  const chunks: Buffer[] = [];

  for (const [name, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(
      `--${boundary}${crlf}` +
      `Content-Disposition: form-data; name="${name}"${crlf}` +
      `${crlf}${value}${crlf}`,
    ));
  }

  chunks.push(Buffer.from(
    `--${boundary}${crlf}` +
    `Content-Disposition: form-data; name="${file.fieldname}"; filename="${file.filename}"${crlf}` +
    `Content-Type: ${file.mimetype ?? 'image/png'}${crlf}` +
    `${crlf}`,
  ));
  chunks.push(file.content);
  chunks.push(Buffer.from(`${crlf}--${boundary}--`));

  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

/** Minimal valid-ish PNG buffer for use in tests */
export const FAKE_PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
  0x00, 0x00, 0x00, 0x01, // chunk length
  0x74, 0x45, 0x58, 0x74, // tEXt type
  0x74, 0x65, 0x73, 0x74, // data: "test"
]);
