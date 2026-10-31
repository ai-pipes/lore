import { describe, expect, it } from 'vitest';
import { InFlightLimiter, InMemoryRateLimiter } from './rate-limiter.js';

function limiter(limit = 3, maxKeys?: number) {
  let now = 1_000_000;
  const l = new InMemoryRateLimiter(limit, 60, 120, () => now, maxKeys);
  return { l, advance: (sec: number) => (now += sec * 1000) };
}

describe('InMemoryRateLimiter', () => {
  it('allows `limit` hits per window; the next one locks the key for lockSec', () => {
    const { l, advance } = limiter();
    for (let i = 0; i < 3; i++) expect(l.hit('ip').allowed).toBe(true);
    expect(l.hit('ip')).toEqual({ allowed: false, retryAfterSec: 120 });
    advance(30);
    expect(l.check('ip')).toEqual({ allowed: false, retryAfterSec: 90 });
    expect(l.hit('ip')).toEqual({ allowed: false, retryAfterSec: 90 });
    expect(l.check('other').allowed).toBe(true);
    advance(90);
    expect(l.check('ip')).toEqual({ allowed: true, retryAfterSec: 0 });
  });

  it('starts a new window after windowSec and sweeps stale entries', () => {
    const { l, advance } = limiter();
    l.hit('a');
    l.hit('a');
    l.hit('b');
    advance(61);
    for (let i = 0; i < 3; i++) expect(l.hit('a').allowed).toBe(true);
    expect(l.size.counters).toBe(1); // b was swept
  });

  it('reset clears the counter and the lock', () => {
    const { l } = limiter(1);
    l.hit('ip');
    expect(l.hit('ip').allowed).toBe(false);
    l.reset('ip');
    expect(l.check('ip').allowed).toBe(true);
    expect(l.hit('ip').allowed).toBe(true);
  });

  it('count reports the hits of the window; refund gives one back but never lifts a lock', () => {
    const { l } = limiter(2);
    expect(l.count('ip')).toBe(0);
    l.hit('ip');
    l.hit('ip');
    expect(l.count('ip')).toBe(2);
    l.refund('ip');
    expect(l.count('ip')).toBe(1);
    l.refund('ip');
    l.refund('ip'); // never below zero
    expect(l.count('ip')).toBe(0);
    for (let i = 0; i < 3; i++) l.hit('ip');
    expect(l.check('ip').allowed).toBe(false);
    l.refund('ip');
    expect(l.check('ip').allowed).toBe(false);
    expect(l.count('ip')).toBe(3); // a locked key counts as over the limit
  });

  it('a flood of single-hit keys evicts only single-hit keys, oldest first', () => {
    const { l } = limiter(10, 3);
    l.hit('a');
    l.hit('a'); // busy: a failure on record
    l.hit('b');
    l.hit('c');
    l.hit('d');
    l.hit('e'); // the fresh map (3) is full: b goes
    expect(l.count('a')).toBe(2);
    expect(l.count('b')).toBe(0);
    expect([l.count('c'), l.count('d'), l.count('e')]).toEqual([1, 1, 1]);
  });

  it('a busy counter (e.g. 9 of 10 failures) survives a flood of 10x maxKeys fresh keys', () => {
    const { l } = limiter(10, 100);
    for (let i = 0; i < 9; i++) l.hit('almost');
    for (let n = 0; n < 1000; n++) l.hit(`flood-${n}`);
    expect(l.count('almost')).toBe(9);
    expect(l.hit('almost').allowed).toBe(true);
    expect(l.hit('almost').allowed).toBe(false);
  });

  it('a locked account stays locked through a flood of 10x maxKeys keys until the lock expires', () => {
    const { l, advance } = limiter(3, 100);
    for (let i = 0; i < 4; i++) l.hit('account');
    for (let n = 0; n < 1000; n++) l.hit(`flood-${n}`);
    for (let n = 0; n < 200; n++) {
      l.hit(`busy-${n}`);
      l.hit(`busy-${n}`);
    }
    expect(l.check('account').allowed).toBe(false);
    advance(120);
    expect(l.check('account').allowed).toBe(true);
  });

  it('when the busy map is full too, its oldest entry goes with a warning', () => {
    let now = 0;
    const warnings: string[] = [];
    const l = new InMemoryRateLimiter(10, 60, 120, () => now, 2, 2, (m) => void warnings.push(m));
    for (const k of ['a', 'b', 'c']) {
      l.hit(k);
      l.hit(k);
    }
    expect(l.size.busy).toBe(2);
    expect(l.count('a')).toBe(0);
    expect(l.count('c')).toBe(2);
    expect(warnings).toHaveLength(1);
    // an expired oldest entry goes silently
    now += 61_000;
    for (const k of ['x', 'y']) {
      l.hit(k);
      l.hit(k);
    }
    expect(warnings).toHaveLength(1);
  });

  it('a flood of fresh keys never lifts a lock and sweeps at most once per window', () => {
    const { l, advance } = limiter(3, 100);
    for (let i = 0; i < 4; i++) l.hit('victim');
    expect(l.check('victim').allowed).toBe(false);
    for (let n = 0; n < 50_000; n++) l.hit(`flood-${n}`);
    expect(l.check('victim').allowed).toBe(false);
    expect(l.size.counters).toBe(100);
    expect(l.sweeps).toBe(0); // no per-insert scans
    advance(61);
    for (let n = 0; n < 1000; n++) l.hit(`later-${n}`);
    expect(l.sweeps).toBe(1);
  });

  it('an attacker who keeps hitting a key keeps its counter through a flood', () => {
    const { l } = limiter(10, 100);
    for (let round = 0; round < 5; round++) {
      l.hit('attacker');
      for (let n = 0; n < 99; n++) l.hit(`flood-${round}-${n}`);
    }
    expect(l.count('attacker')).toBe(5);
  });

  it('sweeps never more often than once per second, even with a short window', () => {
    let now = 0;
    const l = new InMemoryRateLimiter(3, 0.1, 1, () => now);
    for (let n = 0; n < 100; n++) {
      now += 50;
      l.hit(`k${n}`);
    }
    expect(l.sweeps).toBeLessThanOrEqual(5);
  });

  it('caps the number of locks by evicting the earliest', () => {
    const { l } = limiter(1, 2);
    for (const k of ['a', 'b', 'c']) {
      l.hit(k);
      l.hit(k);
    }
    expect(l.size.locks).toBe(2);
    expect(l.check('a').allowed).toBe(true); // the earliest lock was evicted
    expect(l.check('c').allowed).toBe(false);
  });
});

describe('InFlightLimiter', () => {
  it('admits `max` holders per key and frees a slot on release', () => {
    const l = new InFlightLimiter(2);
    expect(l.tryAcquire('ip')).toBe(true);
    expect(l.tryAcquire('ip')).toBe(true);
    expect(l.tryAcquire('ip')).toBe(false);
    expect(l.tryAcquire('other')).toBe(true);
    l.release('ip');
    expect(l.tryAcquire('ip')).toBe(true);
    l.release('ip');
    l.release('ip');
    l.release('other');
    expect(l.size).toBe(0);
    l.release('unknown'); // no-op
    expect(l.size).toBe(0);
  });
});
