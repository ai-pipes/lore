import { eq, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { VersionFilter } from '../domain/document.js';
import { versions } from './schema.js';

export type { VersionFilter };

/**
 * The condition on the joined `versions` row that selects the requested version
 * of each library: an explicit version_id wins; a branch resolves to its head —
 * the newest version of that branch in the same library (by pushed_at, then by
 * the greater id) that holds at least one document, so a version a push has just
 * created (or a push that failed before uploading) does not hide the previous
 * head; otherwise the current (promoted) version.
 *
 * The heads are computed once for all libraries (DISTINCT ON, served by
 * idx_versions_branch_head), not once per joined row.
 */
export function versionCondition(filter: VersionFilter): SQL {
  if (filter.version_id) {
    return eq(versions.id, filter.version_id);
  }
  if (filter.branch) {
    return sql`(${versions.library_id}, ${versions.id}) IN (
      SELECT DISTINCT ON (head.library_id) head.library_id, head.id
      FROM versions AS head
      WHERE head.branch = ${filter.branch}
        AND EXISTS (SELECT 1 FROM documents AS d WHERE d.library_id = head.library_id AND d.version_id = head.id)
      ORDER BY head.library_id, head.pushed_at DESC, head.id DESC
    )`;
  }
  return eq(versions.is_current, true);
}
