import { execFileSync } from 'node:child_process';

/** Document counts of one version a question can reach: the current version, or (with `branch`) a branch head. */
export interface CorpusCounts {
  library_id: string;
  /** Absent for the current (promoted) version. */
  branch?: string;
  docs: number;
  withoutVector: number;
}

export const EXPECTED_LIBRARIES: string[] = [
  'api-gateway',
  'identity-service',
  'notifications-service',
  'orders-service',
  'billing-service',
  'dispatch-service',
  'tracking-service',
];

/** Branch heads the golden set asks about (scope.branch). */
export const EXPECTED_BRANCHES: { library_id: string; branch: string }[] = [
  { library_id: 'dispatch-service', branch: 'feature/batch-dispatch' },
];

/** Returns one error per problem; an empty list means the corpus is ready for an eval run. */
export function checkCorpus(counts: CorpusCounts[]): string[] {
  const errors: string[] = [];
  for (const lib of EXPECTED_LIBRARIES) {
    const c = counts.find((x) => x.library_id === lib && !x.branch);
    if (!c) errors.push(`library ${lib} is missing from the corpus`);
    else if (c.docs === 0) errors.push(`library ${lib} has no documents in its current version`);
  }
  for (const b of EXPECTED_BRANCHES) {
    const c = counts.find((x) => x.library_id === b.library_id && x.branch === b.branch);
    if (!c) errors.push(`library ${b.library_id}: branch ${b.branch} is missing from the corpus`);
    else if (c.docs === 0) errors.push(`library ${b.library_id}: branch ${b.branch} has no documents`);
  }
  for (const c of counts) {
    if (c.withoutVector > 0) {
      const where = c.branch ? `${c.library_id} (branch ${c.branch})` : c.library_id;
      errors.push(`library ${where}: ${c.withoutVector} document(s) without an embedding`);
    }
  }
  return errors;
}

// Every version a question can reach: the current one of each library, and the head of each branch (the newest
// version of the branch that holds documents, as Lore's version filter resolves it) unless that head is current.
const SQL = `with heads as (
  select distinct on (v.library_id, v.branch) v.library_id, v.id, v.branch, v.is_current
  from versions v
  where v.branch is not null
    and exists (select 1 from documents d where d.library_id = v.library_id and d.version_id = v.id)
  order by v.library_id, v.branch, v.pushed_at desc, v.id desc
), picked as (
  select library_id, id, '' as branch from versions where is_current
  union all
  select library_id, id, branch from heads where not is_current
)
select p.library_id, p.branch, count(d.id),
  count(d.id) filter (where dv.document_id is null or dv.embedding is null)
from picked p
left join documents d on d.version_id = p.id and d.library_id = p.library_id
left join document_vectors dv on dv.document_id = d.id
group by p.library_id, p.branch order by p.library_id, p.branch`;

/** Parses `psql -At -F<tab>` rows of SQL; an empty branch column is the current version. */
export function parseCorpusCounts(out: string): CorpusCounts[] {
  return out
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => {
      const [library_id = '', branch = '', docs = '0', withoutVector = '0'] = l.split('\t');
      return { library_id, ...(branch ? { branch } : {}), docs: Number(docs), withoutVector: Number(withoutVector) };
    });
}

export function readCorpusCounts(container: string): CorpusCounts[] {
  const out = execFileSync('docker', ['exec', container, 'psql', '-U', 'lore', '-d', 'lore', '-At', '-F\t', '-c', SQL], {
    encoding: 'utf8',
  });
  return parseCorpusCounts(out);
}
