import { describe, it, expect } from "vitest";
import { safeNextPath } from "@/lib/nextPath";

/**
 * Open-redirect guard for /auth/callback's `?next=`.
 *
 * The route builds its Location as `${origin}${next}`. That reads as safe — it
 * starts from a complete origin — but a `next` beginning with "@" turns the
 * origin into USERINFO and moves the host to the attacker:
 *
 *   "https://bbmi.app" + "@evil.example"  ->  host=evil.example, user=bbmi.app
 *
 * The phishing link therefore genuinely starts with the real domain, the victim
 * authenticates for real, and the callback hands them off with a fresh session.
 *
 * These cases assert the property the route depends on, at the origin-concatenation
 * level, so a future edit that drops the guard (or reverts to the raw param) fails
 * here instead of in production.
 */

const ORIGIN = "https://bbmi.app";

/** What the route effectively does, given a validated `next`. */
function resolve(rawNext: string | null): string | null {
  const next = safeNextPath(rawNext);
  return next === null ? null : new URL(`${ORIGIN}${next}`).host;
}

describe("/auth/callback ?next= — refuses off-origin destinations", () => {
  it("refuses the userinfo escape that defeats the origin prefix", () => {
    // The exploitable case: unguarded, this resolves to host=evil.example.
    expect(new URL(`${ORIGIN}@evil.example`).host).toBe("evil.example");
    // Guarded, it is refused outright.
    expect(resolve("@evil.example")).toBeNull();
    expect(resolve("@evil.example/harvest")).toBeNull();
  });

  it("refuses absolute and protocol-relative values", () => {
    expect(resolve("https://evil.example")).toBeNull();
    expect(resolve("//evil.example")).toBeNull();
    expect(resolve("/\\evil.example")).toBeNull();
    expect(resolve("javascript:alert(1)")).toBeNull();
  });

  it("never leaves the origin for any refused value", () => {
    for (const bad of [
      "@evil.example",
      "//evil.example",
      "https://evil.example",
      "/\\evil.example",
    ]) {
      const host = resolve(bad);
      expect(host === null || host === "bbmi.app").toBe(true);
    }
  });
});

describe("/auth/callback ?next= — still honors the real destinations", () => {
  it("keeps the signup confirmation target", () => {
    // handleSignUp sends emailRedirectTo=...?next=/dashboard
    expect(safeNextPath("/dashboard")).toBe("/dashboard");
    expect(resolve("/dashboard")).toBe("bbmi.app");
  });

  it("keeps a deep trip/game path with its query (the invite + expiry flows)", () => {
    const deep = "/trips/abc/games/match/new?game=xyz";
    expect(safeNextPath(deep)).toBe(deep);
    expect(resolve(deep)).toBe("bbmi.app");
  });

  it("treats a missing next as no override", () => {
    expect(safeNextPath(null)).toBeNull();
  });
});
