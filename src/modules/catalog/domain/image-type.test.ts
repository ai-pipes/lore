import { describe, expect, it } from 'vitest';
import { ALLOWED_IMAGE_TYPES, IMAGE_FILENAME_RE, detectImageType, extensionMatchesType, isAllowedImageType } from './image-type.js';

const bytes = (...b: number[]) => new Uint8Array(b);
const ascii = (s: string, pad = 0) => new Uint8Array([...s].map((c) => c.charCodeAt(0)).concat(Array(pad).fill(0)));

describe('detectImageType', () => {
  it('detects PNG, JPEG, GIF and WebP by magic bytes', () => {
    expect(detectImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe('image/png');
    expect(detectImageType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
    expect(detectImageType(ascii('GIF89a'))).toBe('image/gif');
    expect(detectImageType(ascii('GIF87a', 2))).toBe('image/gif');
    const webp = ascii('RIFF\0\0\0\0WEBPVP8 ');
    expect(detectImageType(webp)).toBe('image/webp');
  });

  it('rejects SVG, unknown formats and truncated headers', () => {
    expect(detectImageType(ascii('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    expect(detectImageType(bytes(0x89, 0x50, 0x4e, 0x47))).toBeNull();
    expect(detectImageType(bytes(0xff, 0xd8))).toBeNull();
    expect(detectImageType(ascii('RIFF\0\0\0\0WAVE'))).toBeNull();
    expect(detectImageType(new Uint8Array())).toBeNull();
  });

  it('works on Node Buffers', () => {
    expect(detectImageType(Buffer.from('GIF89a'))).toBe('image/gif');
  });
});

describe('isAllowedImageType', () => {
  it('accepts only the raster types', () => {
    for (const t of ALLOWED_IMAGE_TYPES) expect(isAllowedImageType(t)).toBe(true);
    expect(isAllowedImageType('image/svg+xml')).toBe(false);
    expect(isAllowedImageType(null)).toBe(false);
    expect(isAllowedImageType(undefined)).toBe(false);
  });
});

describe('IMAGE_FILENAME_RE', () => {
  it('allows one safe path segment', () => {
    expect(IMAGE_FILENAME_RE.test('diagram-1.png')).toBe(true);
    expect(IMAGE_FILENAME_RE.test('../x.png')).toBe(false);
    expect(IMAGE_FILENAME_RE.test('a/b.png')).toBe(false);
    expect(IMAGE_FILENAME_RE.test('.hidden')).toBe(false);
  });
});

describe('filename extension matches the detected type', () => {
  it('accepts the extensions of each type, in any case, jpg and jpeg alike', () => {
    expect(extensionMatchesType('a.png', 'image/png')).toBe(true);
    expect(extensionMatchesType('a.jpg', 'image/jpeg')).toBe(true);
    expect(extensionMatchesType('a.JPEG', 'image/jpeg')).toBe(true);
    expect(extensionMatchesType('a.b.GIF', 'image/gif')).toBe(true);
    expect(extensionMatchesType('a.webp', 'image/webp')).toBe(true);
  });

  it('rejects another extension or none', () => {
    expect(extensionMatchesType('a.html', 'image/gif')).toBe(false);
    expect(extensionMatchesType('a.png', 'image/jpeg')).toBe(false);
    expect(extensionMatchesType('a.gif.html', 'image/gif')).toBe(false);
    expect(extensionMatchesType('png', 'image/png')).toBe(false);
  });
});
