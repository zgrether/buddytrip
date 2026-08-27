import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { isObviouslyBogusPath } from "./botPaths";

/**
 * Edge middleware path handling — the bogus-path 404 and the matcher.
 *
 * The middleware itself can't be imported here (it pulls `next/server` and
 * `@supabase/ssr` into a node-env run), so this covers the two testable halves:
 * the pure predicate, and the matcher regex read out of the source. The matcher
 * is the piece with the auth-critical constraint — an over-broad exclusion
 * silently removes a route from the token-refresh path.
 */

// ── The matcher, reconstructed from source ───────────────────────────────────
// Read rather than duplicated: a hand-copied regex that drifts from the real one
// is a test that passes while the app is broken.
const MIDDLEWARE_SRC = readFileSync(resolve(__dirname, "..", "middleware.ts"), "utf8");

const MATCHER_SOURCE = (() => {
  const m = MIDDLEWARE_SRC.match(/matcher:\s*\[\s*(?:\/\/[^\n]*\n\s*)*"((?:[^"\\]|\\.)*)"/);
  if (!m) throw new Error("could not extract the matcher from src/middleware.ts");
  // The source is a TS string literal, so `\\.` in the file is `\.` in the regex.
  return m[1].replace(/\\\\/g, "\\");
})();

const matcher = new RegExp(`^${MATCHER_SOURCE}$`);
const isMatched = (pathname: string) => matcher.test(pathname);

describe("middleware matcher", () => {
  /**
   * The #689 constraint, and the reason this file exists. `/api/trpc` MUST stay in
   * the matcher: middleware is the confirmed token-refresh path, and `getUser()`
   * rotates cookies for a user whose access token expired while they only polled.
   * Excluding it would strand the browser on a consumed refresh token — a hard
   * mid-round logout. (What #689 changed was the RESPONSE for an unauthenticated
   * tRPC call, 307 → 401 JSON; the route stayed matched.)
   */
  it("still matches /api/trpc — the token-refresh path", () => {
    expect(isMatched("/api/trpc/games.getById")).toBe(true);
    expect(isMatched("/api/trpc/games.getById,scores.listByGame")).toBe(true);
  });

  // 12 paths, as #689 validated against: 6 that must be matched (auth applies),
  // 6 that must not (public statics — no auth, no redirect).
  const MATCHER_TABLE: Array<[string, boolean, string]> = [
    // — matched: auth applies —
    ["/api/trpc/users.getMe", true, "token refresh + 401 JSON"],
    ["/dashboard", true, "real page route"],
    ["/trips/11111111-2222-4333-8444-555555555555", true, "real trip route"],
    ["/login", true, "matched; isPublicRoute lets it through in the body"],
    ["/", true, "matched; the marketing/root route is public in the body"],
    ["/courses/new", true, "nested page route"],
    // — not matched: never auth-gated —
    ["/favicon.ico", false, "browser fetches it with no auth context"],
    ["/manifest.webmanifest", false, "Android install sends no auth context"],
    ["/sw.js", false, "service-worker registration sends no auth context"],
    ["/robots.txt", false, "crawler-facing — was 307'd to a 200 /login page"],
    ["/sitemap.xml", false, "crawler-facing — same live bug"],
    ["/icon-192.png", false, "static image extension"],
  ];

  it.each(MATCHER_TABLE)("%s → matched=%s (%s)", (pathname, expected) => {
    expect(isMatched(pathname)).toBe(expected);
  });

  /**
   * REGRESSION (live bug, not a cost issue). `/robots.txt` and `/sitemap.xml` were
   * matched, so an unauthenticated crawler got 307 → `/login` 200 HTML. Search
   * engines could not read this site's robots.txt at all.
   */
  it("robots.txt and sitemap.xml are never auth-gated", () => {
    expect(isMatched("/robots.txt")).toBe(false);
    expect(isMatched("/sitemap.xml")).toBe(false);
  });

  it("the exclusion list did not swallow a real page route", () => {
    for (const p of ["/", "/login", "/privacy", "/terms", "/dashboard", "/profile",
                     "/invite", "/quick-game", "/courses/new", "/trips/new",
                     "/auth/callback", "/auth/reset-password"]) {
      expect(isMatched(p)).toBe(true);
    }
  });
});

// ── The bogus-path 404 ───────────────────────────────────────────────────────
describe("isObviouslyBogusPath", () => {
  // Every one of these was observed in the 3-hour production log window.
  it.each([
    "/.env",
    "/.env.local",
    "/.env.production",
    "/.git/config",
    "/.netrc",
    "/.aws/credentials",
    "/wp-config.php.bak",
    "/wp-admin/setup-config.php",
    "/wp-login.php",
    "/actuator/heapdump",
    "/actuator/env",
    "/actuator",
    "/phpinfo.php",
    "/xmlrpc.php",
    "/admin/index.jsp",
  ])("404s the scanner path %s", (p) => {
    expect(isObviouslyBogusPath(p)).toBe(true);
  });

  /**
   * THE SAFETY PROPERTY. A match is a hard 404 that never reaches the app, so a
   * false positive here takes a real route off the internet. `/api/trpc` is the
   * one that would hurt most: its batch URLs put dots INSIDE a segment
   * (`games.getById,scores.listByGame`), which is why the dotfile rule tests
   * `startsWith(".")` and not `includes(".")`.
   */
  it.each([
    "/",
    "/login",
    "/privacy",
    "/terms",
    "/dashboard",
    "/invite",
    "/quick-game",
    "/courses/new",
    "/trips/new",
    "/trips/11111111-2222-4333-8444-555555555555",
    "/trips/11111111-2222-4333-8444-555555555555/leaderboard",
    "/trips/e2e-trip-1785267995-a3f9/games/match/new",
    "/auth/callback",
    "/auth/reset-password",
    "/api/trpc/users.getMe",
    "/api/trpc/games.getById,scores.listByGame,matches.listByGame",
    "/api/golf-courses/search",
    "/api/lodging-meta",
    "/api/places",
    "/manifest.webmanifest",
    "/robots.txt",
    "/sitemap.xml",
    "/favicon.ico",
    "/sw.js",
  ])("leaves the legitimate path %s alone", (p) => {
    expect(isObviouslyBogusPath(p)).toBe(false);
  });

  it("carves out .well-known so certificate issuance can't be broken by rule", () => {
    expect(isObviouslyBogusPath("/.well-known/acme-challenge/tokenvalue")).toBe(false);
    expect(isObviouslyBogusPath("/.well-known/apple-app-site-association")).toBe(false);
  });

  it("catches a dot segment at any depth, not just the first", () => {
    expect(isObviouslyBogusPath("/static/.env")).toBe(true);
    expect(isObviouslyBogusPath("/a/b/.git/HEAD")).toBe(true);
  });

  /**
   * A trip id is `text`, not `uuid` (CLAUDE.md, ID Type Convention), so the ids in
   * a URL are whatever the server minted — UUIDs in production, `e2e-trip-<ts>-<rand>`
   * in the suite. Neither shape can trip these rules, but pin it: a 404 here would
   * take out trips rather than scanners.
   */
  it("an id-shaped segment never trips a rule", () => {
    for (const id of ["11111111-2222-4333-8444-555555555555", "e2e-trip-1785267995-a3f9", "bbmi-2027-a3f9"]) {
      expect(isObviouslyBogusPath(`/trips/${id}`)).toBe(false);
    }
  });
});

// ── The auth path is untouched ───────────────────────────────────────────────
// Source guards, because the tRPC 401 contract (#689) is exactly the thing a
// middleware edit is likely to disturb, and it fails SILENTLY: scores still save,
// the client just can't recover an expired session.
describe("middleware auth path is unchanged", () => {
  it("/api/trpc still answers 401 JSON with the full tRPC error envelope", () => {
    expect(MIDDLEWARE_SRC).toContain('request.nextUrl.pathname.startsWith("/api/trpc")');
    expect(MIDDLEWARE_SRC).toContain("NextResponse.json(body, { status: 401 })");
    expect(MIDDLEWARE_SRC).toContain("code: -32001");
    expect(MIDDLEWARE_SRC).toContain('data: { code: "UNAUTHORIZED", httpStatus: 401 }');
  });

  it("still carries setAll's cookies onto the 401 (the dead-session deletion)", () => {
    expect(MIDDLEWARE_SRC).toMatch(/supabaseResponse\.cookies\.getAll\(\)\.forEach/);
  });

  it("getUser() — not getSession() — is still what validates the session", () => {
    // The call is now RACED against a timeout rather than awaited bare
    // (`middlewareAuthTimeout.ts`), so the old literal `await supabase.auth
    // .getUser()` is gone. The invariant it protected is not: getUser()
    // re-verifies against the auth server, getSession() only decodes a cookie
    // locally and Supabase flags it insecure server-side.
    expect(MIDDLEWARE_SRC).toContain("supabase.auth.getUser()");
    expect(MIDDLEWARE_SRC).not.toContain("auth.getSession()");
  });

  // This asserted the two lines were ADJACENT (`url.pathname = "/login"`
  // immediately followed by the redirect). #980 deliberately puts code between
  // them — the bounce now carries where the user was going as `?next=` — so the
  // adjacency is gone while the invariant it was protecting is not. Rewritten to
  // pin the invariant (a page route still redirects to /login) plus the ordering,
  // rather than the exact adjacent text.
  it("a real page route still 307s to /login", () => {
    expect(MIDDLEWARE_SRC).toMatch(/url\.pathname = "\/login";/);
    const loginAt = MIDDLEWARE_SRC.indexOf('url.pathname = "/login";');
    const redirectAt = MIDDLEWARE_SRC.indexOf("return NextResponse.redirect(url);", loginAt);
    expect(loginAt).toBeGreaterThan(-1);
    expect(redirectAt).toBeGreaterThan(loginAt);
  });

  it("...and carries the intended destination across the bounce as ?next=", () => {
    // The other half of #980: a deep link to a signed-out browser used to lose
    // its destination entirely. Guarded here for the same reason as the 401
    // contract above — it fails silently, as a link that merely lands somewhere
    // plausible instead of where it pointed.
    expect(MIDDLEWARE_SRC).toMatch(/const intended = request\.nextUrl\.pathname \+ request\.nextUrl\.search;/);
    expect(MIDDLEWARE_SRC).toMatch(/url\.searchParams\.set\("next", intended\)/);
  });

  it("a `next` READ back out of the URL goes through safeNextPath, never raw", () => {
    // Writing `next` is safe; honoring one is the open-redirect. The authed
    // bounce off /login is the read side, and it must validate.
    expect(MIDDLEWARE_SRC).toContain("safeNextPath");
    expect(MIDDLEWARE_SRC).toMatch(
      /safeNextPath\(request\.nextUrl\.searchParams\.get\("next"\)\)/
    );
  });

  it("the bogus 404 runs BEFORE the auth check, not after", () => {
    // Anchored on the auth call itself rather than the `await` that used to
    // precede it — a scanner path must still cost one edge invocation and no
    // auth round-trip, whether or not that call is raced.
    const bogusAt = MIDDLEWARE_SRC.indexOf("isObviouslyBogusPath(request.nextUrl.pathname)");
    const authAt = MIDDLEWARE_SRC.indexOf("supabase.auth.getUser()");
    expect(bogusAt).toBeGreaterThan(-1);
    expect(authAt).toBeGreaterThan(-1);
    expect(bogusAt).toBeLessThan(authAt);
  });

  it("the auth call is RACED, and a timeout never signs anyone out", () => {
    // Added with the timeout guard. The redirect/401 arms above must stay
    // unreachable from a timeout — the rule is pinned in detail by
    // `middlewareAuthTimeout.test.ts`; this is the reminder at the site the
    // other auth guards live at.
    expect(MIDDLEWARE_SRC).toContain("resolveWithTimeout");
    expect(MIDDLEWARE_SRC).not.toMatch(/awaits+supabase.auth.getUser()/);
  });
});
