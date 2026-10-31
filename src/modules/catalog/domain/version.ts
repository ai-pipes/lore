/**
 * An immutable snapshot of a library's documents, usually named after the git SHA and
 * optionally on a branch. One version per library is current (promoted).
 */
export interface Version {
  id: string;
  library_id: string;
  branch: string | null;
  is_current: boolean;
  pushed_at: string;
}

export function isCurrent(version: Version): boolean {
  return version.is_current;
}

/**
 * Version ids name a URL path segment: a letter or digit, then up to 127 letters, digits, `.`,
 * `_`, `+` or `-`, with no `..` (git SHAs, `demo-<hash>`, `v1.2.3`, `1.0.0-rc.1+build.5`).
 */
const VERSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/;

export function isValidVersionId(id: string): boolean {
  return VERSION_ID_RE.test(id) && !id.includes('..');
}

/** One segment of a branch name: no leading dot, no spaces, separators or control characters. */
const BRANCH_SEGMENT_RE = /^[A-Za-z0-9_@#+-][A-Za-z0-9._@#+-]*$/;

/**
 * Branch names are 1–255 characters of `/`-separated segments (`feature/new-payment`): no
 * leading, trailing or doubled `/`, no `..`, no segment starting with `.`, no spaces, `\` or
 * control characters.
 */
export function isValidBranch(branch: string): boolean {
  if (branch.length === 0 || branch.length > 255 || branch.includes('..')) return false;
  return branch.split('/').every((segment) => BRANCH_SEGMENT_RE.test(segment));
}
