/**
 * Keys for per-client limits. An IPv6 client usually holds a whole /64 and can pick a new address
 * for every request, while a whole office may share one /64; so limits count both per address
 * (`clientAddress`) and, more generously, per network (`clientNetwork`). IPv4 (also when mapped
 * into IPv6) is one address and its own network. Anything that is not an address is returned
 * unchanged by both.
 */

/** The address in one spelling: IPv4-mapped IPv6 as IPv4, IPv6 expanded, lower case, no zone. */
export function clientAddress(ip: string): string {
  const v4 = mappedIpv4(ip);
  if (v4) return v4;
  const groups = ipv6Groups(ip.replace(/%.*$/, ''));
  return groups ? groups.map(hex).join(':') : ip;
}

/** The /64 network of an IPv6 address; the address itself for IPv4. */
export function clientNetwork(ip: string): string {
  const v4 = mappedIpv4(ip);
  if (v4) return v4;
  const groups = ipv6Groups(ip.replace(/%.*$/, ''));
  return groups ? `${groups.slice(0, 4).map(hex).join(':')}::/64` : ip;
}

const GROUP = /^[0-9a-f]{1,4}$/i;

const hex = (group: string) => parseInt(group, 16).toString(16);

function mappedIpv4(ip: string): string | null {
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  return mapped ? mapped[1] : null;
}

/** The eight groups of an IPv6 address without an embedded IPv4 part, or null. */
function ipv6Groups(ip: string): string[] | null {
  const halves = ip.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] === '' ? [] : halves[0].split(':');
  const tail = halves.length === 1 || halves[1] === '' ? [] : halves[1].split(':');
  if (![...head, ...tail].every((g) => GROUP.test(g))) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const missing = 8 - head.length - tail.length;
  return missing >= 1 ? [...head, ...Array<string>(missing).fill('0'), ...tail] : null;
}
