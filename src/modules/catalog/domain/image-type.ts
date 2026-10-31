/**
 * Image type detection by magic bytes. The client-supplied Content-Type of an
 * upload is never trusted: only these raster formats are accepted, and the
 * stored/served MIME type is the one detected here. SVG (scriptable) and every
 * other format are rejected.
 */
export const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function latin1(buf: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...buf.subarray(start, end));
}

export function detectImageType(buf: Uint8Array): AllowedImageType | null {
  if (buf.length >= 8 && PNG_SIGNATURE.every((b, i) => buf[i] === b)) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 6) {
    const head = latin1(buf, 0, 6);
    if (head === 'GIF87a' || head === 'GIF89a') return 'image/gif';
  }
  if (buf.length >= 12 && latin1(buf, 0, 4) === 'RIFF' && latin1(buf, 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

export function isAllowedImageType(mime: string | null | undefined): mime is AllowedImageType {
  return (ALLOWED_IMAGE_TYPES as readonly string[]).includes(mime ?? '');
}

/** The filename extensions of each allowed type (lowercase, without the dot). */
const EXTENSIONS: Record<AllowedImageType, readonly string[]> = {
  'image/png': ['png'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/gif': ['gif'],
  'image/webp': ['webp'],
};

/** True when the extension of `filename` (any case) is one of `type`'s: a GIF is never `a.html`. */
export function extensionMatchesType(filename: string, type: AllowedImageType): boolean {
  const dot = filename.lastIndexOf('.');
  if (dot < 0) return false;
  return EXTENSIONS[type].includes(filename.slice(dot + 1).toLowerCase());
}

/** Filenames are a single path segment of safe characters (they appear in URLs). */
export const IMAGE_FILENAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
