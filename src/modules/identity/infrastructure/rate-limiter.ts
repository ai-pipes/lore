import type { ConcurrencyLimiter, RateLimiter } from '../application/ports.js';

interface Counter {
  count: number;
  windowStart: number;
}

const DEFAULT_MAX_KEYS = 50_000;

/** Expired entries are swept at most once per window and never more often than once per second. */
const MIN_SWEEP_INTERVAL_MS = 1000;

/**
 * Fixed-window counter with a lock-out: the (limit+1)-th hit inside a window locks the key for
 * `lockSec`. In memory, per process; every hit is O(1) apart from the rate-limited sweep.
 *
 * Three capped maps, so floods of fresh keys cannot reset anybody's progress:
 * - `fresh`: keys hit once in their window, an LRU that absorbs floods (a full map evicts its
 *   oldest key, expired or not);
 * - `busy`: keys hit at least twice (a failure on record), `busyMaxKeys` large, never evicted by
 *   fresh keys; only by expiry or, when it is full too, its oldest entry goes (with a warning);
 * - `locks`: locked keys until their lock expires; a lock needs `limit + 1` hits on one key, and a
 *   full lock map evicts the lock that expires first.
 */
export class InMemoryRateLimiter implements RateLimiter {
  private readonly fresh = new Map<string, Counter>();
  private readonly busy = new Map<string, Counter>();
  private readonly locks = new Map<string, number>();
  private lastSweep: number;
  private sweepCount = 0;

  constructor(
    private readonly limit: number,
    private readonly windowSec: number,
    private readonly lockSec: number,
    private readonly nowMs: () => number = Date.now,
    private readonly maxKeys: number = DEFAULT_MAX_KEYS,
    private readonly busyMaxKeys: number = maxKeys * 2,
    private readonly warn: (msg: string) => void = () => {},
  ) {
    this.lastSweep = nowMs();
  }

  /** Number of counting entries (fresh + busy), of busy ones and of locked keys (observability, tests). */
  get size(): { counters: number; busy: number; locks: number } {
    return { counters: this.fresh.size + this.busy.size, busy: this.busy.size, locks: this.locks.size };
  }

  /** How many sweeps ran (tests: sweeps are rate-limited). */
  get sweeps(): number {
    return this.sweepCount;
  }

  check(key: string): { allowed: boolean; retryAfterSec: number } {
    const until = this.locks.get(key);
    const now = this.nowMs();
    if (until !== undefined && until > now) {
      return { allowed: false, retryAfterSec: Math.ceil((until - now) / 1000) };
    }
    return { allowed: true, retryAfterSec: 0 };
  }

  hit(key: string): { allowed: boolean; retryAfterSec: number } {
    const now = this.nowMs();
    if (now - this.lastSweep >= Math.max(MIN_SWEEP_INTERVAL_MS, this.windowSec * 1000)) this.sweep(now);

    const state = this.check(key);
    if (!state.allowed) return state;

    let c = this.busy.get(key) ?? this.fresh.get(key);
    this.fresh.delete(key);
    if (!c || this.expired(c, now)) {
      this.busy.delete(key);
      while (this.fresh.size >= this.maxKeys) this.evictFirst(this.fresh);
      this.fresh.set(key, { count: 1, windowStart: now });
      return this.limit >= 1 ? { allowed: true, retryAfterSec: 0 } : this.lock(key, now);
    }
    c.count++;
    if (c.count > this.limit) {
      this.busy.delete(key);
      return this.lock(key, now);
    }
    if (!this.busy.has(key)) {
      while (this.busy.size >= this.busyMaxKeys) {
        const first = this.busy.entries().next();
        if (first.done) break;
        if (!this.expired(first.value[1], now)) this.warn('rate limiter: busy counters full, evicting the oldest');
        this.busy.delete(first.value[0]);
      }
      this.busy.set(key, c);
    }
    return { allowed: true, retryAfterSec: 0 };
  }

  count(key: string): number {
    if (!this.check(key).allowed) return this.limit + 1;
    const c = this.busy.get(key) ?? this.fresh.get(key);
    return c && !this.expired(c, this.nowMs()) ? c.count : 0;
  }

  refund(key: string): void {
    const c = this.busy.get(key) ?? this.fresh.get(key);
    if (c && c.count > 0) c.count--;
  }

  reset(key: string): void {
    this.fresh.delete(key);
    this.busy.delete(key);
    this.locks.delete(key);
  }

  private expired(c: Counter, now: number): boolean {
    return now - c.windowStart >= this.windowSec * 1000;
  }

  private lock(key: string, now: number): { allowed: boolean; retryAfterSec: number } {
    this.locks.delete(key); // re-insert at the end to keep the expiry order
    while (this.locks.size >= this.maxKeys) this.evictFirst(this.locks);
    this.locks.set(key, now + this.lockSec * 1000);
    return { allowed: false, retryAfterSec: this.lockSec };
  }

  private evictFirst(map: Map<string, unknown>): void {
    const first = map.keys().next();
    if (!first.done) map.delete(first.value);
  }

  private sweep(now: number): void {
    this.lastSweep = now;
    this.sweepCount++;
    for (const map of [this.fresh, this.busy]) {
      for (const [k, c] of map) if (this.expired(c, now)) map.delete(k);
    }
    for (const [k, until] of this.locks) {
      if (until <= now) this.locks.delete(k);
    }
  }
}

/** At most `max` holders per key at a time, in memory, per process. Keys without holders are dropped. */
export class InFlightLimiter implements ConcurrencyLimiter {
  private readonly held = new Map<string, number>();

  constructor(private readonly max: number) {}

  /** Number of keys with holders (observability, tests). */
  get size(): number {
    return this.held.size;
  }

  tryAcquire(key: string): boolean {
    const n = this.held.get(key) ?? 0;
    if (n >= this.max) return false;
    this.held.set(key, n + 1);
    return true;
  }

  release(key: string): void {
    const n = this.held.get(key);
    if (n === undefined) return;
    if (n <= 1) this.held.delete(key);
    else this.held.set(key, n - 1);
  }
}
