/**
 * Bogus-path detection for the edge middleware.
 *
 * Production logs over a 3-hour window carried 76 distinct paths, almost all
 * credential scanners: `.env`, `.env.local`, `.git/config`, `wp-config.php.bak`,
 * `aws-exports.js`, `terraform.tfvars`, `/actuator/heapdump`, `swagger.json`,
 * `.netrc`. Every one of them was 307'd to `/login`; the scanner follows the
 * redirect, and we pay a full serverless page render so somebody can check
 * whether we leak AWS keys. This turns that into an edge 404.
 *
 * Kept pure + free of `next/server` and `@supabase/ssr` imports so the rules are
 * directly testable — the middleware itself can't be imported under a node-env
 * vitest run without dragging the whole edge runtime in.
 *
 * ── The safety property ─────────────────────────────────────────────────────
 * None of these may match a legitimate route, because a match is a hard 404 that
 * never reaches the app. Each rule is therefore keyed to something the App Router
 * cannot produce, not to a list of observed scanner names (a name list is what
 * gets patched narrowly, twice, and still misses the 74th path).
 *
 * The one case that needs care is tRPC, whose batch URLs look like
 * `/api/trpc/games.getById,scores.listByGame`. That segment CONTAINS dots but
 * does not START with one — which is why rule 1 tests `startsWith("."`), not
 * `includes(".")`. Getting this wrong would 404 every data read in the app.
 */

/** `.well-known` is a real, spec'd dotfile directory (ACME challenges, app-site
 *  association). It has no route here today, but 404-ing it by RULE would quietly
 *  break certificate issuance later, so it is carved out of the dotfile rule. */
const ALLOWED_DOT_SEGMENTS = new Set([".well-known"]);

/**
 * Server-side script extensions this app can never serve. A Next.js App Router
 * route is a `page.tsx` / `route.ts`, so there is no reachable `.php` / `.asp` /
 * `.jsp` / `.cgi` URL at any path — which makes this the one extension rule with
 * provably zero collision surface. Catches the PHP-shell sweep (`phpinfo.php`,
 * `shell.php`, `xmlrpc.php`) without naming any of them.
 */
const BOGUS_EXTENSIONS = /\.(?:php\d?|phtml|asp|aspx|jsp|jspx|cgi|pl)$/i;

/**
 * True for a path that is obviously not this app — safe to 404 at the edge
 * without an auth check or a page render.
 *
 * Rules, in order:
 *  1. **A dot-prefixed path segment.** Covers `/.env`, `/.env.local`,
 *     `/.env.production`, `/.git/config`, `/.aws/credentials`, `/.netrc`,
 *     `/.ssh/id_rsa` — the entire dotfile class, not the four names that
 *     happened to show up in one log window. No App Router route can produce a
 *     segment starting with `.` (a `.`-prefixed directory in `app/` is ignored
 *     by the router). `.well-known` is carved out above.
 *  2. **A `wp-` prefixed segment.** `wp-admin`, `wp-login.php`, `wp-content/…`,
 *     `wp-includes/…`, `wp-config.php.bak`. This is not a WordPress site.
 *  3. **`/actuator` (any depth).** Spring Boot Actuator — `/actuator/heapdump`,
 *     `/actuator/env`. Not a Java service either.
 *  4. **A server-script extension** (see `BOGUS_EXTENSIONS`).
 */
export function isObviouslyBogusPath(pathname: string): boolean {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return false; // "/" is the marketing route

  for (const seg of segments) {
    // 1 — dotfiles
    if (seg.startsWith(".") && !ALLOWED_DOT_SEGMENTS.has(seg)) return true;
    // 2 — WordPress sweep
    if (seg.startsWith("wp-")) return true;
    // 4 — server-script extensions
    if (BOGUS_EXTENSIONS.test(seg)) return true;
  }

  // 3 — Spring Boot Actuator, bare or with a sub-path
  if (segments[0] === "actuator") return true;

  return false;
}
