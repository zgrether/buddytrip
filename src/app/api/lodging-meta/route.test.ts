import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

// Signed in: these cases are about where the route will fetch, not its caller
// check, which apiRoutesCheckCaller.test.ts covers against the real routeCaller.
vi.mock("@/server/lib/routeCaller", () => ({
  routeCaller: async () => ({ ok: true, userId: "user-1" }),
}));

import { POST } from "./route";

/**
 * 3. Every redirect hop is checked, not just the first URL.
 *
 * With `redirect: "follow"` the guard saw only the URL the caller pasted, and
 * any public page could 302 the server to a private address. The route now
 * follows redirects itself and judges each hop with the same guard.
 *
 * "Which URLs were fetched" is the mechanism under test: a refused hop must
 * never be requested at all.
 */

const LISTING = "https://listing.example/rental/1";
const OG_PAGE = '<html><head><meta property="og:title" content="Lake House"></head></html>';

function post(url: string) {
  return POST(
    new NextRequest("http://localhost/api/lodging-meta", {
      method: "POST",
      body: JSON.stringify({ url }),
      headers: { "Content-Type": "application/json" },
    })
  );
}

const redirectTo = (location: string) => new Response(null, { status: 302, headers: { Location: location } });
const page = () => new Response(OG_PAGE, { status: 200, headers: { "Content-Type": "text/html" } });

describe("POST /api/lodging-meta — redirects", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const fetched = () => fetchMock.mock.calls.map((c) => String(c[0]));

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("follows redirects by hand, so it can see them", async () => {
    fetchMock.mockResolvedValueOnce(page());
    await post(LISTING);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
  });

  it.each([
    ["loopback", "http://127.0.0.1/admin"],
    ["cloud metadata", "http://169.254.169.254/latest/meta-data/"],
    ["IPv6 loopback", "http://[::1]/"],
    ["IPv4-mapped metadata", "http://[::ffff:169.254.169.254]/"],
    ["a non-http scheme", "file:///etc/passwd"],
  ])("a public page redirecting to %s is refused, and that hop is never fetched", async (_label, target) => {
    fetchMock.mockResolvedValueOnce(redirectTo(target));
    const body = await (await post(LISTING)).json();
    expect(body).toMatchObject({ ok: false, reason: "blocked_redirect" });
    expect(fetched()).toEqual([LISTING]);
  });

  it("a refused hop LATER in the chain is still refused", async () => {
    fetchMock
      .mockResolvedValueOnce(redirectTo("https://cdn.example/step"))
      .mockResolvedValueOnce(redirectTo("http://10.0.0.5/"));
    const body = await (await post(LISTING)).json();
    expect(body).toMatchObject({ ok: false, reason: "blocked_redirect" });
    expect(fetched()).toEqual([LISTING, "https://cdn.example/step"]);
  });

  it("CONTROL: a relative redirect on a public host is followed and the page read", async () => {
    fetchMock.mockResolvedValueOnce(redirectTo("/rental/1/en")).mockResolvedValueOnce(page());
    const body = await (await post(LISTING)).json();
    expect(body).toMatchObject({ ok: true, title: "Lake House" });
    expect(fetched()).toEqual([LISTING, "https://listing.example/rental/1/en"]);
  });

  it("stops after too many hops", async () => {
    fetchMock.mockImplementation(async () => redirectTo("https://listing.example/again"));
    const body = await (await post(LISTING)).json();
    expect(body).toMatchObject({ ok: false, reason: "too_many_redirects" });
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("the pasted URL itself is judged by the same guard: [::1] is refused before any fetch", async () => {
    const res = await post("http://[::1]/");
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
