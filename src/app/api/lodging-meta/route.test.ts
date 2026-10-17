import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

// Signed in: these cases are about where the route will fetch, not its caller
// check, which apiRoutesCheckCaller.test.ts covers against the real routeCaller.
vi.mock("@/server/lib/routeCaller", () => ({
  routeCaller: async () => ({ ok: true, userId: "user-1" }),
}));

import { POST } from "./route";

/**
 * Where `/api/lodging-meta` will fetch.
 *
 * Two lines, both checked on the pasted URL AND on every redirect hop:
 *  - the lodging list (lodgingDomains.ts): previews come from listed lodging
 *    sites only, and a redirect must land on one too;
 *  - the address check (ssrfGuard.ts): kept as a second line of defence.
 *
 * "Which URLs were fetched" is the mechanism under test: a refused hop must
 * never be requested at all.
 */

const LISTING = "https://www.airbnb.com/rooms/1";
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

describe("POST /api/lodging-meta", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const fetched = () => fetchMock.mock.calls.map((c) => String(c[0]));

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("the lodging list", () => {
    it("a link to any other site is not fetched, and is not an error", async () => {
      const res = await post("https://example.com/our-cabin");
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ ok: false, reason: "not_a_lodging_site" });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("a listed site redirecting OFF the list stops, and that hop is never fetched", async () => {
      fetchMock.mockResolvedValueOnce(redirectTo("https://tracker.example/r?to=listing"));
      const body = await (await post(LISTING)).json();
      expect(body).toMatchObject({ ok: false, reason: "redirect_off_list" });
      expect(fetched()).toEqual([LISTING]);
    });

    it("CONTROL: an Airbnb share link redirecting to the listing is followed and read", async () => {
      fetchMock.mockResolvedValueOnce(redirectTo("https://www.airbnb.com/rooms/9")).mockResolvedValueOnce(page());
      const body = await (await post("https://abnb.me/AbC123")).json();
      expect(body).toMatchObject({ ok: true, title: "Lake House" });
      expect(fetched()).toEqual(["https://abnb.me/AbC123", "https://www.airbnb.com/rooms/9"]);
    });
  });

  describe("redirects", () => {
    it("are followed by hand, so each hop can be judged", async () => {
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
    ])("to %s are refused by the address check first, and never fetched", async (_label, target) => {
      fetchMock.mockResolvedValueOnce(redirectTo(target));
      const body = await (await post(LISTING)).json();
      expect(body).toMatchObject({ ok: false, reason: "blocked_redirect" });
      expect(fetched()).toEqual([LISTING]);
    });

    it("a refused hop LATER in the chain is still refused", async () => {
      fetchMock
        .mockResolvedValueOnce(redirectTo("https://www.vrbo.com/step"))
        .mockResolvedValueOnce(redirectTo("http://10.0.0.5/"));
      const body = await (await post(LISTING)).json();
      expect(body).toMatchObject({ ok: false, reason: "blocked_redirect" });
      expect(fetched()).toEqual([LISTING, "https://www.vrbo.com/step"]);
    });

    it("CONTROL: a relative redirect on a listed host is followed and the page read", async () => {
      fetchMock.mockResolvedValueOnce(redirectTo("/rooms/1/en")).mockResolvedValueOnce(page());
      const body = await (await post(LISTING)).json();
      expect(body).toMatchObject({ ok: true, title: "Lake House" });
      expect(fetched()).toEqual([LISTING, "https://www.airbnb.com/rooms/1/en"]);
    });

    it("stop after too many hops", async () => {
      fetchMock.mockImplementation(async () => redirectTo("https://www.airbnb.com/again"));
      const body = await (await post(LISTING)).json();
      expect(body).toMatchObject({ ok: false, reason: "too_many_redirects" });
      expect(fetchMock).toHaveBeenCalledTimes(6);
    });
  });

  it("the pasted URL meets the address check first: [::1] is refused before any fetch", async () => {
    const res = await post("http://[::1]/");
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
