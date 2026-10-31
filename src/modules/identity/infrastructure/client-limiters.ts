import type { ConcurrencyLimiter, RateLimiter } from '../application/ports.js';
import { clientAddress, clientNetwork } from '../domain/client-address.js';

/** The network key of an IPv6 client; null for IPv4, which is counted per address only. */
function networkOf(ip: string): string | null {
  const network = clientNetwork(ip);
  return network === clientAddress(ip) ? null : network;
}

/**
 * A per-client rate limit keyed on the client's IP: every hit counts against the address and, for
 * IPv6, against its /64 with a higher limit. A client is refused when either counter is locked, so
 * rotating addresses inside one /64 does not dodge the limit, while one busy address does not lock
 * its whole network.
 */
export class ClientRateLimiter implements RateLimiter {
  constructor(
    private readonly perAddress: RateLimiter,
    private readonly perNetwork: RateLimiter,
  ) {}

  check(ip: string): { allowed: boolean; retryAfterSec: number } {
    const network = networkOf(ip);
    return worst(this.perAddress.check(clientAddress(ip)), network === null ? null : this.perNetwork.check(network));
  }

  hit(ip: string): { allowed: boolean; retryAfterSec: number } {
    const network = networkOf(ip);
    const address = this.perAddress.hit(clientAddress(ip));
    if (network === null) return address;
    // A locked address does not use up its network's allowance: one blocked host stays its own problem.
    if (!address.allowed) return worst(address, this.perNetwork.check(network));
    return worst(address, this.perNetwork.hit(network));
  }

  count(ip: string): number {
    return this.perAddress.count(clientAddress(ip));
  }

  refund(ip: string): void {
    this.perAddress.refund(clientAddress(ip));
    const network = networkOf(ip);
    if (network !== null) this.perNetwork.refund(network);
  }

  reset(ip: string): void {
    this.perAddress.reset(clientAddress(ip));
    const network = networkOf(ip);
    if (network !== null) this.perNetwork.reset(network);
  }
}

function worst(
  a: { allowed: boolean; retryAfterSec: number },
  b: { allowed: boolean; retryAfterSec: number } | null,
): { allowed: boolean; retryAfterSec: number } {
  if (b === null || (a.allowed && b.allowed)) return a;
  return { allowed: false, retryAfterSec: Math.max(a.allowed ? 0 : a.retryAfterSec, b.allowed ? 0 : b.retryAfterSec) };
}

/** Concurrent holders per client IP: per address and, for IPv6, per /64 with a higher cap. */
export class ClientInFlightLimiter implements ConcurrencyLimiter {
  constructor(
    private readonly perAddress: ConcurrencyLimiter,
    private readonly perNetwork: ConcurrencyLimiter,
  ) {}

  tryAcquire(ip: string): boolean {
    const address = clientAddress(ip);
    if (!this.perAddress.tryAcquire(address)) return false;
    const network = networkOf(ip);
    if (network !== null && !this.perNetwork.tryAcquire(network)) {
      this.perAddress.release(address);
      return false;
    }
    return true;
  }

  release(ip: string): void {
    this.perAddress.release(clientAddress(ip));
    const network = networkOf(ip);
    if (network !== null) this.perNetwork.release(network);
  }
}
