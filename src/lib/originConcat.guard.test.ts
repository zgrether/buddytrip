import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative, sep } from "path";
import { safeNextPath } from "./nextPath";

/**
 * OBSERVATIONAL guard — the open-redirect class from #689 must not reappear.
 *
 * The bug: `NextResponse.redirect(`${origin}${next}`)` reads as safe because it
 * starts from a complete, trusted origin. It isn't. A value beginning with "@"
 * turns the origin into USERINFO and moves the host to the attacker:
 *
 *   "https://bbmi.app" + "@evil.example"  ->  host=evil.example, user=bbmi.app
 *
 * The phishing link genuinely starts with the real domain, the victim
 * authenticates for real, and the redirect hands them off with a live session.
 *
 * What makes every OTHER base-URL concatenation in the repo safe is that a
 * literal path segment sits between the origin and the interpolation
 * (`${BASE_URL}/trips/${tripId}`), which terminates the authority and forces the
 * value into path/query position. That property is asserted below, then this
 * file scans the source for the one shape that lacks it.
 *
 * This is the same species of guard as `configHash.coverage.test.ts`: it reads
 * what the code actually is, rather than restating what it was when written — so
 * a NEW `${origin}${input}` fails here instead of in production. A behavioural
 * test can't cover that, because the risk is a site nobody has written yet.
 */

// ── The property the "safe" sites rely on ───────────────────────────────────

const ORIGIN = "https://bbmi.app";
/** Inputs that escape an origin when placed in authority position. */
const HOSTILE = ["@evil.example", "@evil.example/harvest", "//evil.example", "../../../x"];

describe("userinfo escape — the mechanism behind #689", () => {
  it("bare `${origin}${input}` escapes the origin", () => {
    // The exact pre-fix shape. Documented so the class stays recognisable.
    expect(new URL(`${ORIGIN}@evil.example`).host).toBe("evil.example");
  });

  it("a literal path segment after the origin contains every hostile input", () => {
    // This is why email trip links, invite links and the login redirects are safe.
    for (const bad of HOSTILE) {
      expect(new URL(`${ORIGIN}/trips/${bad}`).host).toBe("bbmi.app");
      expect(new URL(`${ORIGIN}/invite?token=${bad}`).host).toBe("bbmi.app");
    }
  });

  it("safeNextPath refuses everything that reaches authority position", () => {
    for (const bad of HOSTILE) expect(safeNextPath(bad)).toBeNull();
  });
});

// ── The source scan ────────────────────────────────────────────────────────

const SRC = join(process.cwd(), "src");

/** Identifiers that hold a full origin / base URL. */
const BASE_IDENTS = ["origin", "baseUrl", "BASE_URL", "siteUrl", "SITE_URL", "API_BASE", "getBaseUrl"];

/**
 * A base-URL interpolation immediately followed by another interpolation —
 * i.e. nothing between the origin and the value. `${origin}/x${y}` is fine;
 * `${origin}${y}` is the bug.
 */
const ADJACENT = new RegExp(
  String.raw`\$\{[^}]*(?:` + BASE_IDENTS.join("|") + String.raw`)[^}]*\}\$\{`
);

/**
 * Sites that are allowed to concatenate a base URL directly with a value,
 * because the value is validated same-origin first. Keep this list at zero or
 * one entries; each addition needs the validation shown at the call site.
 */
const ALLOWLIST = new Map<string, string>([
  [
    "app/auth/callback/route.ts",
    "next is run through safeNextPath() before use (#689); covered by route.test.ts",
  ],
]);

/**
 * Blank out comments so a doc-comment quoting the bad shape isn't a false
 * positive — replacing with spaces rather than deleting, so line numbers in the
 * failure message still match the real file.
 */
function stripComments(src: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, " ");
  return src.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/\/\/[^\n]*/g, blank);
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === "__tests__") continue;
      walk(full, out);
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe("no base URL is concatenated directly with an interpolated value", () => {
  it("finds source files to scan (guard is not vacuous)", () => {
    expect(walk(SRC).length).toBeGreaterThan(100);
  });

  it("every adjacency is either absent or explicitly allowlisted", () => {
    const offenders: string[] = [];

    for (const file of walk(SRC)) {
      const rel = relative(SRC, file).split(sep).join("/");
      const code = stripComments(readFileSync(file, "utf8"));
      if (!ADJACENT.test(code)) continue;
      if (ALLOWLIST.has(rel)) continue;
      const line =
        code.split("\n").findIndex((l) => ADJACENT.test(l)) + 1;
      offenders.push(`${rel}:${line}`);
    }

    expect(
      offenders,
      offenders.length
        ? `Base URL concatenated directly with an interpolated value — a leading "@" in that ` +
          `value escapes the origin (see #689). Put a literal path segment between them ` +
          `(\`\${base}/path/\${value}\`), or validate with safeNextPath() and add the site to ` +
          `ALLOWLIST with the reason. Offenders: ${offenders.join(", ")}`
        : undefined
    ).toEqual([]);
  });

  it("the allowlisted site still validates with safeNextPath", () => {
    // If the guard is bypassed via the allowlist, the validation must be real.
    const cb = readFileSync(join(SRC, "app/auth/callback/route.ts"), "utf8");
    expect(cb).toContain("safeNextPath(");
  });
});
