import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { isAllowedImageType, IMAGE_FILENAME_RE } from '../../domain/image-type.js';
import type { CatalogDeps } from '../../application/ports.js';
import { deleteImage, findImage, listImages, uploadImage } from '../../application/images.js';

/** True if `s` holds NUL, another C0 control character or DEL. */
function hasControlChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/** Headers for serving user-uploaded files: no sniffing, no script execution, no framing, no shared caching. */
function setImageHeaders(reply: FastifyReply, mimeType: string | null, filename: string): void {
  const safeType = isAllowedImageType(mimeType) ? mimeType : 'application/octet-stream';
  const safeName = filename.replace(/[^A-Za-z0-9._-]/g, '_');
  reply.header('Content-Type', safeType);
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('Content-Disposition', `${safeType === 'application/octet-stream' ? 'attachment' : 'inline'}; filename="${safeName}"`);
  reply.header('Content-Security-Policy', "default-src 'none'; sandbox");
  // Images are served only to authenticated callers: the browser may cache them, shared caches may not.
  reply.header('Cache-Control', 'private, max-age=86400');
}

export async function imageRoutes(app: FastifyInstance, d: CatalogDeps): Promise<void> {
  // Upload image for a document in a specific version
  app.post<{ Params: { id: string; versionId: string } }>(
    '/api/libraries/:id/versions/:versionId/images',
    {
      handler: async (request, reply) => {
        const { id: library_id, versionId: version_id } = request.params;

        let slug: string | undefined;
        let filename: string | undefined;
        let fileBuffer: Buffer | undefined;

        // The platform rejects control characters in params, query and JSON bodies before the
        // handler; multipart fields are parsed here, so they are checked here.
        let controlChar = false;
        for await (const part of request.parts()) {
          if (part.type === 'field') {
            if (typeof part.value === 'string' && hasControlChar(part.value)) controlChar = true;
            if (part.fieldname === 'slug') slug = part.value as string;
            if (part.fieldname === 'filename') filename = part.value as string;
          } else if (part.type === 'file') {
            const chunks: Buffer[] = [];
            for await (const chunk of part.file) {
              chunks.push(chunk);
            }
            fileBuffer = Buffer.concat(chunks);
            if (!filename) filename = part.filename;
          }
        }

        if (controlChar) {
          return reply.code(400).send({ error: 'multipart fields must not contain control characters' });
        }
        if (!slug || !filename || !fileBuffer) {
          return reply.code(400).send({ error: 'slug, filename, and image file are required' });
        }
        if (!IMAGE_FILENAME_RE.test(filename) || filename.includes('..')) {
          return reply.code(400).send({ error: 'filename must be a plain file name (letters, digits, ".", "_", "-")' });
        }
        if (slug.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')) {
          return reply.code(400).send({ error: 'invalid slug' });
        }
        // Never trust the client-declared mimetype: the type is detected from magic bytes
        const result = await uploadImage(d, { libraryId: library_id, versionId: version_id, slug, filename, data: fileBuffer });
        if (result === 'unsupported_type') {
          return reply.code(415).send({ error: 'Unsupported image type. Allowed: PNG, JPEG, GIF, WebP' });
        }
        if (result === 'extension_mismatch') {
          return reply.code(400).send({
            error: 'The filename extension does not match the image type (use .png, .jpg/.jpeg, .gif or .webp for the actual format)',
          });
        }
        if (result === 'library_not_found') {
          return reply.code(404).send({ error: 'Library not found' });
        }
        if (result === 'invalid_library_id') {
          return reply.code(400).send({
            error: 'This library id cannot name an image storage directory (it contains "/", "\\", a control character or is "." / ".."); images cannot be stored for it',
          });
        }
        return reply.code(201).send(result);
      },
    },
  );

  // List images for a document in a specific version
  app.get<{ Params: { id: string; versionId: string }; Querystring: { slug?: string } }>(
    '/api/libraries/:id/versions/:versionId/images',
    async (request, reply) => {
      const { id: library_id, versionId: version_id } = request.params;
      const { slug } = request.query;

      if (!slug) {
        return reply.code(400).send({ error: 'slug query parameter is required' });
      }

      return reply.send(await listImages(d, library_id, version_id, slug));
    },
  );

  // Serve image via /static/ — used by document content img tags
  app.get<{ Params: { id: string; versionId: string; '*': string } }>(
    '/static/libraries/:id/versions/:versionId/images/*',
    async (request, reply) => {
      const { id: library_id, versionId: version_id } = request.params;
      const wildcard = request.params['*'];
      const lastSlash = wildcard.lastIndexOf('/');

      if (lastSlash === -1) {
        return reply.code(400).send({ error: 'Invalid image path' });
      }

      const slug = wildcard.slice(0, lastSlash);
      const filename = wildcard.slice(lastSlash + 1);

      const img = await findImage(d, library_id, version_id, slug, filename);
      if (!img) {
        return reply.code(404).send({ error: 'Image not found' });
      }

      try {
        const info = await stat(img.path);
        if (!info.isFile()) throw new Error('not a file');
      } catch {
        return reply.code(404).send({ error: 'Image file missing from storage' });
      }

      setImageHeaders(reply, img.mimeType, filename);
      return reply.send(createReadStream(img.path));
    },
  );

  // Serve image — resolve hash from DB, stream file from content-addressable store
  app.get<{ Params: { id: string; versionId: string; '*': string } }>(
    '/api/libraries/:id/versions/:versionId/images/*',
    async (request, reply) => {
      const { id: library_id, versionId: version_id } = request.params;
      const wildcard = request.params['*'];
      const lastSlash = wildcard.lastIndexOf('/');

      if (lastSlash === -1) {
        return reply.code(400).send({ error: 'Invalid image path' });
      }

      const slug = wildcard.slice(0, lastSlash);
      const filename = wildcard.slice(lastSlash + 1);

      const img = await findImage(d, library_id, version_id, slug, filename);
      if (!img) {
        return reply.code(404).send({ error: 'Image not found' });
      }

      try {
        const info = await stat(img.path);
        if (!info.isFile()) throw new Error('not a file');
      } catch {
        return reply.code(404).send({ error: 'Image file missing from storage' });
      }

      setImageHeaders(reply, img.mimeType, filename);
      return reply.send(createReadStream(img.path));
    },
  );

  // Delete image from a specific version.
  // Deletes the file only if no other DB record references the same hash.
  app.delete<{ Params: { id: string; versionId: string; '*': string } }>(
    '/api/libraries/:id/versions/:versionId/images/*',
    {
      handler: async (request, reply) => {
        const { id: library_id, versionId: version_id } = request.params;
        const wildcard = request.params['*'];
        const lastSlash = wildcard.lastIndexOf('/');

        if (lastSlash === -1) {
          return reply.code(400).send({ error: 'Invalid image path' });
        }

        const slug = wildcard.slice(0, lastSlash);
        const filename = wildcard.slice(lastSlash + 1);

        await deleteImage(d, library_id, version_id, slug, filename);

        return reply.send({ deleted: filename });
      },
    },
  );
}
