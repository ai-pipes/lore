import { describe, expect, it } from 'vitest';
import { ClientInFlightLimiter, ClientRateLimiter } from './client-limiters.js';
import { InFlightLimiter, InMemoryRateLimiter } from './rate-limiter.js';

function rate(perAddress = 2, perNetwork = 4) {
  let now = 1_000_000;
  const clock = () => now;
  const address = new InMemoryRateLimiter(perAddress, 60, 120, clock);
  const network = new InMemoryRateLimiter(perNetwork, 60, 120, clock);
  return { l: new ClientRateLimiter(address, network), address, network, advance: (s: number) => (now += s * 1000) };
}

describe('ClientRateLimiter', () => {
  it('locks one IPv6 address at the per-address limit without locking its neighbours', () => {
    const { l } = rate();
    expect(l.hit('2001:db8::1').allowed).toBe(true);
    expect(l.hit('2001:db8::1').allowed).toBe(true);
    expect(l.hit('2001:db8::1').allowed).toBe(false);
    expect(l.check('2001:db8::1').allowed).toBe(false);
    expect(l.hit('2001:db8::2').allowed).toBe(true);
  });

  it('locks the whole /64 once addresses rotated inside it pass the per-network limit', () => {
    const { l } = rate();
    for (const a of ['2001:db8::1', '2001:db8::2', '2001:db8::3', '2001:db8::4']) expect(l.hit(a).allowed).toBe(true);
    expect(l.hit('2001:db8::5')).toEqual({ allowed: false, retryAfterSec: 120 });
    expect(l.check('2001:db8::99').allowed).toBe(false);
    expect(l.check('2001:db8:0:1::1').allowed).toBe(true);
  });

  it('a locked address does not use up its network\'s allowance', () => {
    const { l, network } = rate();
    for (let i = 0; i < 10; i++) l.hit('2001:db8::1');
    expect(network.count('2001:db8:0:0::/64')).toBe(2);
    expect(l.hit('2001:db8::2').allowed).toBe(true);
  });

  it('counts IPv4 (also IPv4-mapped) per address only, under one key', () => {
    const { l, network } = rate();
    expect(l.hit('192.0.2.1').allowed).toBe(true);
    expect(l.hit('::ffff:192.0.2.1').allowed).toBe(true);
    expect(l.hit('192.0.2.1').allowed).toBe(false);
    expect(network.count('192.0.2.1')).toBe(0);
    expect(l.count('::ffff:192.0.2.1')).toBe(3);
  });

  it('refund and reset apply to both counters', () => {
    const { l, address, network } = rate();
    l.hit('2001:db8::1');
    l.refund('2001:db8::1');
    expect(address.count('2001:db8:0:0:0:0:0:1')).toBe(0);
    expect(network.count('2001:db8:0:0::/64')).toBe(0);
    l.hit('2001:db8::1');
    l.reset('2001:db8::1');
    expect(l.count('2001:db8::1')).toBe(0);
    expect(network.count('2001:db8:0:0::/64')).toBe(0);
  });
});

describe('ClientInFlightLimiter', () => {
  it('caps concurrent holders per address and per /64, and gives a slot back when the other cap refuses', () => {
    const address = new InFlightLimiter(1);
    const network = new InFlightLimiter(2);
    const l = new ClientInFlightLimiter(address, network);
    expect(l.tryAcquire('2001:db8::1')).toBe(true);
    expect(l.tryAcquire('2001:db8::1')).toBe(false); // per address
    expect(l.tryAcquire('2001:db8::2')).toBe(true);
    expect(l.tryAcquire('2001:db8::3')).toBe(false); // per network: ::3 got its address slot back
    expect(address.size).toBe(2);
    l.release('2001:db8::1');
    expect(l.tryAcquire('2001:db8::3')).toBe(true);
    expect(l.tryAcquire('192.0.2.1')).toBe(true);
    expect(l.tryAcquire('192.0.2.1')).toBe(false);
    l.release('192.0.2.1');
    expect(network.size).toBe(1); // IPv4 never takes a network slot
  });
});
