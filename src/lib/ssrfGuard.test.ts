import { describe, it, expect } from "vitest";
import { isAllowedFetchUrl, isBlockedHost, normalizeHost, parseIPv6, embeddedIPv4 } from "./ssrfGuard";

/**
 * Which hosts a server-side fetch of a caller-supplied URL may reach.
 *
 * Every case goes through `new URL(...)`, because that is what the route
 * judges: `URL` keeps IPv6 brackets, keeps a trailing dot, and rewrites
 * `::ffff:127.0.0.1` as `::ffff:7f00:1`. A guard tested on hand-written
 * strings would be tested on spellings the route never sees.
 *
 * One group per fix, so each fix's red-proof names its own cases.
 */

const allowed = (u: string) => isAllowedFetchUrl(new URL(u));

describe("1. host normalization", () => {
  it("normalizeHost gives one spelling: no brackets, no trailing dot, no zone, lowercase", () => {
    expect(normalizeHost(new URL("http://[::1]/").hostname)).toBe("::1");
    expect(normalizeHost(new URL("http://localhost./").hostname)).toBe("localhost");
    expect(normalizeHost(new URL("http://LOCALHOST/").hostname)).toBe("localhost");
    expect(normalizeHost("fe80::1%eth0")).toBe("fe80::1");
  });

  it.each([
    "http://[::1]/",
    "http://[fe80::1]/",
    "http://[fd00::1]/",
    "http://[fc00::1]/",
    "http://[ff02::1]/",
    "http://[::]/",
    "http://localhost./",
    "http://127.0.0.1./",
    "http://foo.localhost/",
    "http://LOCALHOST/",
  ])("refuses %s", (u) => {
    expect(allowed(u)).toBe(false);
  });

  it.each(["http://[2606:4700:4700::1111]/", "https://example.com/", "https://www.vrbo.com/12345"])(
    "CONTROL: allows the public %s",
    (u) => {
      expect(allowed(u)).toBe(true);
    }
  );
});

describe("2. IPv4 hiding inside IPv6 is judged as the IPv4 it reaches", () => {
  it.each([
    ["mapped loopback", "http://[::ffff:127.0.0.1]/"],
    ["mapped metadata", "http://[::ffff:169.254.169.254]/"],
    ["mapped private", "http://[::ffff:10.0.0.1]/"],
    ["compatible loopback", "http://[::127.0.0.1]/"],
    ["NAT64 loopback", "http://[64:ff9b::127.0.0.1]/"],
    ["6to4 loopback", "http://[2002:7f00:1::]/"],
  ])("refuses %s (%s)", (_label, u) => {
    expect(allowed(u)).toBe(false);
  });

  it("extracts the address, not just a yes/no", () => {
    const w = parseIPv6(normalizeHost(new URL("http://[::ffff:169.254.169.254]/").hostname));
    expect(w).not.toBeNull();
    expect(embeddedIPv4(w!)).toEqual([169, 254, 169, 254]);
  });

  it.each(["http://[::ffff:8.8.8.8]/", "http://[64:ff9b::8.8.8.8]/", "http://[2002:808:808::]/"])(
    "CONTROL: allows %s, which reaches a public IPv4",
    (u) => {
      expect(allowed(u)).toBe(true);
    }
  );
});

describe("IPv4 literals (unchanged behaviour, pinned)", () => {
  it.each([
    "http://127.0.0.1/",
    "http://2130706433/",
    "http://0x7f.1/",
    "http://10.1.2.3/",
    "http://172.16.0.1/",
    "http://172.31.255.255/",
    "http://192.168.1.1/",
    "http://169.254.169.254/",
    "http://0.0.0.0/",
    "http://100.64.0.1/",
  ])("refuses %s", (u) => {
    expect(allowed(u)).toBe(false);
  });

  it.each(["http://8.8.8.8/", "http://172.32.0.1/", "http://93.184.216.34/"])("CONTROL: allows %s", (u) => {
    expect(allowed(u)).toBe(true);
  });

  it("refuses anything but http(s)", () => {
    expect(allowed("ftp://example.com/")).toBe(false);
    expect(allowed("file:///etc/passwd")).toBe(false);
  });

  it("refuses an IPv6-looking host that does not parse rather than calling it 'not an IP'", () => {
    expect(isBlockedHost("1:2:3:4:5:6:7:8:9")).toBe(true);
  });
});
