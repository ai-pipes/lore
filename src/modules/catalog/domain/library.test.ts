import { describe, expect, it } from 'vitest';
import { isPathSafeSegment, isValidLibraryId, LIBRARY_ID_RE, storageOwnerKey } from './library.js';

describe('library id', () => {
  it('accepts lowercase slug-like ids', () => {
    expect(isValidLibraryId('orders-api')).toBe(true);
    expect(isValidLibraryId('a')).toBe(true);
    expect(isValidLibraryId('svc_2')).toBe(true);
  });

  it('rejects ids that start with a separator', () => {
    expect(isValidLibraryId('-x')).toBe(false);
    expect(isValidLibraryId('_x')).toBe(false);
  });

  it('rejects uppercase, empty and other characters', () => {
    expect(isValidLibraryId('A')).toBe(false);
    expect(isValidLibraryId('')).toBe(false);
    expect(isValidLibraryId('a/b')).toBe(false);
    expect(isValidLibraryId('a b')).toBe(false);
  });

  it('exposes the pattern', () => {
    expect(LIBRARY_ID_RE.source).toBe('^[a-z0-9][a-z0-9_-]*$');
  });
});

describe('path-safe segment (legacy library ids in storage paths)', () => {
  it('accepts ids outside the creation pattern that are still one plain path segment', () => {
    for (const id of ['PaymentService', 'Legacy-Lib', 'svc.v2', 'a b', '_x', 'a..b']) {
      expect(isPathSafeSegment(id), id).toBe(true);
    }
  });

  it('rejects empty, dot segments, separators and control characters', () => {
    for (const id of ['', '.', '..', 'a/b', '/abs', 'a\\b', 'a\0b', 'a\nb', 'x/../../escape']) {
      expect(isPathSafeSegment(id), JSON.stringify(id)).toBe(false);
    }
  });

  it('rejects forms that alias or misbehave on Windows file systems', () => {
    for (const id of ['svc.', 'svc ', 'a:b', 'CON', 'con', 'Nul.txt', 'aux', 'PRN', 'com1', 'LPT9.log', 'nul .txt']) {
      expect(isPathSafeSegment(id), JSON.stringify(id)).toBe(false);
    }
    for (const id of ['console', 'com', 'com10', 'nullable', 'lpt']) {
      expect(isPathSafeSegment(id), id).toBe(true);
    }
  });

  it('rejects anything but printable ASCII (file systems fold and normalize non-ASCII differently)', () => {
    for (const id of ['Ünïcode', 'café', 'café', 'ǅ', 'a b', 'KK']) {
      expect(isPathSafeSegment(id), JSON.stringify(id)).toBe(false);
    }
    expect(isPathSafeSegment('Payment~Service!')).toBe(true);
  });
});

describe('storage owner key', () => {
  it('folds ASCII letters only, independent of locale and collation', () => {
    expect(storageOwnerKey('PaymentService')).toBe('paymentservice');
    expect(storageOwnerKey('A-Z_09')).toBe('a-z_09');
    expect(storageOwnerKey('ÜI')).toBe('Üi');
  });
});
