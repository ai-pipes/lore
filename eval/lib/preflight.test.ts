import { describe, expect, it } from 'vitest';
import { checkCorpus, EXPECTED_BRANCHES, EXPECTED_LIBRARIES, parseCorpusCounts, type CorpusCounts } from './preflight.js';
import { loginError } from './lore-client.js';

const full = (): CorpusCounts[] => [
  ...EXPECTED_LIBRARIES.map((library_id) => ({ library_id, docs: 10, withoutVector: 0 })),
  ...EXPECTED_BRANCHES.map((b) => ({ ...b, docs: 5, withoutVector: 0 })),
];

describe('checkCorpus', () => {
  it('accepts a complete corpus', () => {
    expect(checkCorpus(full())).toEqual([]);
  });
  it('names a missing library', () => {
    const errs = checkCorpus(full().slice(1));
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain(EXPECTED_LIBRARIES[0]);
  });
  it('flags documents without vectors', () => {
    const c = full();
    c[2] = { ...c[2]!, withoutVector: 3 };
    const errs = checkCorpus(c);
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain(c[2].library_id);
    expect(errs[0]).toContain('3');
  });
  it('names a missing branch head', () => {
    const c = full().filter((x) => !x.branch);
    const errs = checkCorpus(c);
    expect(errs).toEqual(['library dispatch-service: branch feature/batch-dispatch is missing from the corpus']);
  });
  it('flags documents without vectors in a branch head', () => {
    const c = full().map((x) => (x.branch ? { ...x, withoutVector: 2 } : x));
    expect(checkCorpus(c)).toEqual(['library dispatch-service (branch feature/batch-dispatch): 2 document(s) without an embedding']);
  });
  it('flags an empty branch head', () => {
    const c = full().map((x) => (x.branch ? { ...x, docs: 0 } : x));
    expect(checkCorpus(c)).toEqual(['library dispatch-service: branch feature/batch-dispatch has no documents']);
  });
  it('flags an empty library', () => {
    const c = full();
    c[0] = { ...c[0]!, docs: 0 };
    expect(checkCorpus(c)[0]).toContain(c[0].library_id);
  });
});

describe('parseCorpusCounts', () => {
  it('reads tab-separated psql rows, an empty branch meaning the current version', () => {
    const out = 'orders-service\t\t12\t0\ndispatch-service\tfeature/batch-dispatch\t3\t1\n\n';
    expect(parseCorpusCounts(out)).toEqual([
      { library_id: 'orders-service', docs: 12, withoutVector: 0 },
      { library_id: 'dispatch-service', branch: 'feature/batch-dispatch', docs: 3, withoutVector: 1 },
    ]);
  });
});

describe('loginError', () => {
  it('maps statuses', () => {
    expect(loginError(401)).toContain('wrong LORE_ADMIN_LOGIN/LORE_ADMIN_PASSWORD');
    expect(loginError(429)).toBe('login rate-limited, wait and retry');
    expect(loginError(403)).toContain('SSO-only server');
    expect(loginError(500)).toBe('login failed: HTTP 500');
  });
});
