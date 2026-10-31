import { readFileSync } from 'fs';
import { basename } from 'path';
import type { Command } from 'commander';
import type { ImageListItem, ImageUploadResponse } from '../contracts/catalog.js';
import { apiRequest } from './client.js';
import { resolveCredentials } from './credentials.js';
import { orExit, resolveVersion } from './shared.js';

/** `lore images ls|add|rm`. */
export function registerImageCommands(program: Command): void {
  const images = program
    .command('images')
    .description('Manage document images');

  // lore images ls <slug>
  images
    .command('ls <slug>')
    .description('List images for a document slug')
    .requiredOption('-l, --library <id>', 'Library id')
    .option('-v, --ver <id>', 'Version id (defaults to current version)')
    .option('-u, --url <url>', 'Lore server URL (default: LORE_URL or the stored URL)')
    .action(async (slug: string, opts: { library: string; ver?: string; url?: string }) => {
      const { url, token } = await orExit(async () => resolveCredentials(opts));
      const version = await resolveVersion(url, opts.library, token, opts.ver);
      const list = await orExit(() => apiRequest<ImageListItem[]>(
        url,
        `/api/libraries/${opts.library}/versions/${version}/images?slug=${encodeURIComponent(slug)}`,
        { token },
      ));
      if (list.length === 0) {
        console.log(`No images for "${slug}" in version ${version}.`);
        return;
      }
      console.log(`\nImages for "${slug}" (version: ${version}):\n`);
      for (const img of list) {
        const size = img.file_size != null ? `${(img.file_size / 1024).toFixed(1)} KB` : '?';
        const hash = img.image_hash ? img.image_hash.slice(0, 12) : '?';
        console.log(`  ${img.filename.padEnd(30)} ${size.padStart(10)}  hash: ${hash}`);
      }
      console.log();
    });

  // lore images add <file> <slug>
  images
    .command('add <file> <slug>')
    .description('Upload an image (PNG, JPEG, GIF or WebP) for a document slug')
    .requiredOption('-l, --library <id>', 'Library id')
    .option('-v, --ver <id>', 'Version id (defaults to current version)')
    .option('-u, --url <url>', 'Lore server URL (default: LORE_URL or the stored URL)')
    .action(async (file: string, slug: string, opts: { library: string; ver?: string; url?: string }) => {
      const { url, token } = await orExit(async () => resolveCredentials(opts));
      const version = await resolveVersion(url, opts.library, token, opts.ver);
      const filename = basename(file);
      const fileBuffer = readFileSync(file);

      const formData = new FormData();
      formData.append('slug', slug);
      formData.append('filename', filename);
      formData.append('image', new Blob([fileBuffer]), filename);

      const json = await orExit(() => apiRequest<ImageUploadResponse>(
        url,
        `/api/libraries/${opts.library}/versions/${version}/images`,
        { method: 'POST', token, form: formData },
      ));
      console.log(`Uploaded: ${json.filename}`);
      console.log(`URL:      ${url}${json.url}`);
    });

  // lore images rm <slug> <filename>
  images
    .command('rm <slug> <filename>')
    .description('Remove an image from a document slug')
    .requiredOption('-l, --library <id>', 'Library id')
    .option('-v, --ver <id>', 'Version id (defaults to current version)')
    .option('-u, --url <url>', 'Lore server URL (default: LORE_URL or the stored URL)')
    .action(async (slug: string, filename: string, opts: { library: string; ver?: string; url?: string }) => {
      const { url, token } = await orExit(async () => resolveCredentials(opts));
      const version = await resolveVersion(url, opts.library, token, opts.ver);
      await orExit(() => apiRequest(
        url,
        `/api/libraries/${opts.library}/versions/${version}/images/${slug}/${filename}`,
        { method: 'DELETE', token },
      ));
      console.log(`Deleted: ${slug}/${filename} from version ${version}`);
    });
}
