/**
 * Which hosts a server-side fetch of a CALLER-SUPPLIED URL may reach.
 *
 * `/api/lodging-meta` fetches whatever listing URL a person pastes, so the
 * server must not be talkable into fetching our own infrastructure: loopback,
 * private networks, link-local (cloud metadata lives there), and the IPv6 and
 * IPv4-in-IPv6 spellings of each. Three separate jobs, kept as three separate
 * functions so each can be tested, and broken, on its own:
 *
 *  1. `normalizeHost`  — one spelling per host. `URL` hands IPv6 back WITH its
 *     brackets (`[::1]`), keeps a trailing dot (`localhost.`), and lowercases;
 *     a string compare against `::1` or `localhost` misses the first two.
 *  2. `embeddedIPv4`   — the IPv4 address hiding inside an IPv6 one
 *     (`::ffff:127.0.0.1`, which `URL` writes as `::ffff:7f00:1`; the old
 *     IPv4-compatible `::a.b.c.d`; NAT64 `64:ff9b::/96`; 6to4 `2002::/16`), so
 *     it is judged as the IPv4 address it reaches.
 *  3. Redirects are the caller's job (`lodging-meta` follows them by hand and
 *     calls `isAllowedFetchUrl` on every hop); a guard on the first URL alone
 *     is no guard once a public page can 302 anywhere.
 *
 * NOT covered, and stated so nobody assumes it is: a PUBLIC hostname whose DNS
 * answer is a private address (DNS rebinding, or a name that simply resolves
 * to 127.0.0.1). This decides by the URL alone.
 */

/** Lowercase, brackets off an IPv6 literal, zone id and trailing dots gone. */
export function normalizeHost(hostname: string): string {
  let h = hostname.trim().toLowerCase();
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);
  const zone = h.indexOf("%");
  if (zone >= 0) h = h.slice(0, zone);
  while (h.endsWith(".")) h = h.slice(0, -1);
  return h;
}

/** Four octets from a dotted quad, or null. `URL` has already turned decimal
 *  and hex forms (`2130706433`, `0x7f.1`) into this one. */
export function parseIPv4(h: string): number[] | null {
  const parts = h.split(".");
  if (parts.length !== 4) return null;
  const out: number[] = [];
  for (const p of parts) {
    if (!/^[0-9]{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    out.push(n);
  }
  return out;
}

/** Eight 16-bit words from an IPv6 literal (`::` and a trailing dotted quad
 *  allowed), or null. */
export function parseIPv6(h: string): number[] | null {
  if (!h.includes(":")) return null;
  // A trailing dotted quad becomes its two hex groups, then it is ordinary.
  const lastColon = h.lastIndexOf(":");
  const last = h.slice(lastColon + 1);
  let text = h;
  if (last.includes(".")) {
    const v4 = parseIPv4(last);
    if (!v4) return null;
    const hex = (hi: number, lo: number) => ((hi << 8) | lo).toString(16);
    text = h.slice(0, lastColon + 1) + hex(v4[0], v4[1]) + ":" + hex(v4[2], v4[3]);
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const groupsOf = (s: string) => (s === "" ? [] : s.split(":"));
  const head = groupsOf(halves[0]);
  const rest = halves.length === 2 ? groupsOf(halves[1]) : [];
  const fill = 8 - head.length - rest.length;
  if (halves.length === 2 ? fill < 1 : head.length !== 8) return null;
  const groups = halves.length === 2 ? [...head, ...Array(fill).fill("0"), ...rest] : head;
  const out: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    out.push(parseInt(g, 16));
  }
  return out;
}

/** The IPv4 address an IPv6 address reaches, when it embeds one. */
export function embeddedIPv4(w: number[]): number[] | null {
  const v4 = (hi: number, lo: number) => [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff];
  const zeroTo = (n: number) => w.slice(0, n).every((x) => x === 0);
  // IPv4-mapped ::ffff:a.b.c.d
  if (zeroTo(5) && w[5] === 0xffff) return v4(w[6], w[7]);
  // IPv4-compatible ::a.b.c.d (deprecated, still routable by some stacks);
  // `::` and `::1` are their own cases, not addresses 0.0.0.0 / 0.0.0.1.
  if (zeroTo(6) && (w[6] !== 0 || w[7] > 1)) return v4(w[6], w[7]);
  // NAT64 64:ff9b::/96
  if (w[0] === 0x64 && w[1] === 0xff9b && w.slice(2, 6).every((x) => x === 0)) return v4(w[6], w[7]);
  // 6to4 2002:AABB:CCDD::/48
  if (w[0] === 0x2002) return v4(w[1], w[2]);
  return null;
}

export function isBlockedIPv4([a, b]: number[]): boolean {
  return (
    a === 0 || // "this network"
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224 // multicast and reserved, incl. 255.255.255.255
  );
}

export function isBlockedIPv6(w: number[]): boolean {
  if (w.every((x) => x === 0)) return true; // ::
  if (w.slice(0, 7).every((x) => x === 0) && w[7] === 1) return true; // ::1
  if ((w[0] & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
  if ((w[0] & 0xfe00) === 0xfc00) return true; // unique-local fc00::/7
  if ((w[0] & 0xff00) === 0xff00) return true; // multicast
  const v4 = embeddedIPv4(w);
  return v4 ? isBlockedIPv4(v4) : false;
}

/** May a server-side fetch go to this host? */
export function isBlockedHost(hostname: string): boolean {
  const h = normalizeHost(hostname);
  if (h === "") return true;
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) {
    return true;
  }
  const v4 = parseIPv4(h);
  if (v4) return isBlockedIPv4(v4);
  if (h.includes(":")) {
    const v6 = parseIPv6(h);
    // Something that looks like an IPv6 literal and does not parse is refused,
    // not waved through as "not an IP".
    return v6 ? isBlockedIPv6(v6) : true;
  }
  return false;
}

/** A URL a server-side fetch may go to: http(s), to a host that is not ours. */
export function isAllowedFetchUrl(url: URL): boolean {
  return (url.protocol === "http:" || url.protocol === "https:") && !isBlockedHost(url.hostname);
}
