import { describe, expect, it } from 'vitest';
import { clientAddress, clientNetwork } from './client-address.js';

describe('clientAddress', () => {
  it('keeps an IPv4 address and reads an IPv4-mapped IPv6 address as IPv4', () => {
    expect(clientAddress('192.0.2.1')).toBe('192.0.2.1');
    expect(clientAddress('::ffff:192.0.2.1')).toBe('192.0.2.1');
    expect(clientAddress('::FFFF:192.0.2.1')).toBe('192.0.2.1');
  });

  it('writes one IPv6 address one way, whatever its spelling or zone', () => {
    const key = clientAddress('2001:db8:1:2::1');
    expect(key).toBe('2001:db8:1:2:0:0:0:1');
    expect(clientAddress('2001:0DB8:0001:0002:0:0:0:0001')).toBe(key);
    expect(clientAddress('2001:db8:1:2::1%eth0')).toBe(key);
    expect(clientAddress('2001:db8:1:2::2')).not.toBe(key);
  });

  it('leaves anything that is not an address untouched', () => {
    for (const s of ['', 'unknown', '1:2:3', '1::2::3', 'g::1']) expect(clientAddress(s)).toBe(s);
  });
});

describe('clientNetwork', () => {
  it('is the address itself for IPv4 (also when mapped into IPv6)', () => {
    expect(clientNetwork('192.0.2.1')).toBe('192.0.2.1');
    expect(clientNetwork('::ffff:192.0.2.1')).toBe('192.0.2.1');
  });

  it('is the /64 network for IPv6, whatever the interface id', () => {
    const key = clientNetwork('2001:db8:1:2:aaaa:bbbb:cccc:dddd');
    expect(key).toBe('2001:db8:1:2::/64');
    expect(clientNetwork('2001:db8:1:2::1')).toBe(key);
    expect(clientNetwork('2001:0DB8:0001:0002:0:0:0:ffff')).toBe(key);
    expect(clientNetwork('2001:db8:1:2::1%eth0')).toBe(key);
    expect(clientNetwork('2001:db8:1:3::1')).not.toBe(key);
  });

  it('expands a compressed prefix', () => {
    expect(clientNetwork('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(clientNetwork('::1')).toBe('0:0:0:0::/64');
    expect(clientNetwork('::')).toBe('0:0:0:0::/64');
    expect(clientNetwork('fe80::')).toBe('fe80:0:0:0::/64');
  });

  it('leaves anything that is not an address untouched', () => {
    for (const s of ['', 'unknown', '1:2:3', '1::2::3', '1:2:3:4:5:6:7:8:9', 'g::1', '12345::1']) {
      expect(clientNetwork(s)).toBe(s);
    }
  });
});
