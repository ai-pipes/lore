import { describe, expect, it } from 'vitest';
import { isCurrent, isValidBranch, isValidVersionId, type Version } from './version.js';

describe('version', () => {
  const v: Version = { id: 'abc', library_id: 'lib', branch: null, is_current: true, pushed_at: '2026-01-01' };

  it('reports whether it is the current version', () => {
    expect(isCurrent(v)).toBe(true);
    expect(isCurrent({ ...v, is_current: false })).toBe(false);
  });
});

describe('version id', () => {
  it('accepts git SHAs, demo ids, semver and simple names', () => {
    for (const id of ['3f2a9c1', 'a'.repeat(40), 'demo-0123abcd', 'v1.2.3', '1.0.0-rc.1+build.5', 'v1', 'sha-abc', 'feat_1', 'insights']) {
      expect(isValidVersionId(id), id).toBe(true);
    }
  });

  it('rejects empty, too long, path-like and control-character ids', () => {
    for (const id of ['', 'a'.repeat(129), '../../x', '..', 'a..b', '/x', 'a/b', '-x', '.x', 'a b', 'a\u0000b', 'a\nb', '[object Object]']) {
      expect(isValidVersionId(id), JSON.stringify(id)).toBe(false);
    }
  });
});

describe('branch', () => {
  it('accepts branch names with slash-separated segments', () => {
    for (const b of ['main', 'feature/new-payment', 'release/2026.10', 'dependabot/npm_and_yarn/zod-3.23.8', 'user@x/fix#12', 'v1.2.3']) {
      expect(isValidBranch(b), b).toBe(true);
    }
  });

  it('rejects empty, too long, leading or doubled slashes, dot segments and control characters', () => {
    for (const b of ['', 'a'.repeat(256), '/main', 'main/', 'a//b', 'a/../b', '..', 'a..b', 'a/.hidden', 'a b', 'a\u0000b', 'a\tb', 'a\\b']) {
      expect(isValidBranch(b), JSON.stringify(b)).toBe(false);
    }
  });
});
