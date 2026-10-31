-- Serves the branch head lookup (version-filter.ts): for one branch, the newest version of each
-- library by pushed_at, then by the greater id. The branch leads because the heads of all
-- libraries are computed at once (DISTINCT ON library_id), which this index returns in order.
CREATE INDEX IF NOT EXISTS idx_versions_branch_head ON versions (branch, library_id, pushed_at DESC, id DESC);
