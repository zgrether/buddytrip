import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { resolve, join } from "path";
import { resolveTripIdValue } from "./TripIdProvider";

const UUID_A = "11111111-2222-4333-8444-555555555555";

// ── The param → id decision ────────────────────────────────────────────────
describe("resolveTripIdValue", () => {
  it("treats a UUID param as the trip id", () => {
    const v = resolveTripIdValue({ rawParam: UUID_A });
    expect(v.tripId).toBe(UUID_A);
    expect(v.isError).toBe(false);
    expect(v.isResolving).toBe(false);
  });

  it("rejects a legacy SLUG param rather than trying to resolve it", () => {
    // Slugs were removed (CLAUDE.md #21). A slug can now only arrive from a
    // URL someone copied out of the address bar before the removal, and the
    // honest answer is "not a trip id" — the route bounces to /dashboard.
    const v = resolveTripIdValue({ rawParam: "bbmi-2027-a3f9" });
    expect(v.tripId).toBeUndefined();
    expect(v.isError).toBe(true);
  });

  it("rejects a malformed param", () => {
    expect(resolveTripIdValue({ rawParam: "not-a-uuid" }).isError).toBe(true);
  });

  it("is not an error for an absent param (the provider mounts before routing settles)", () => {
    const v = resolveTripIdValue({ rawParam: "" });
    expect(v.tripId).toBeUndefined();
    expect(v.isError).toBe(false);
  });

  it("never reports a resolving state — there is no async step left", () => {
    for (const p of [UUID_A, "bbmi-2027-a3f9", "", "junk"]) {
      expect(resolveTripIdValue({ rawParam: p }).isResolving).toBe(false);
    }
  });
});

// ── Source guards ──────────────────────────────────────────────────────────
const ROOT = resolve(__dirname, "..");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** Strip comments so prose ABOUT a pattern can't trip a guard on the pattern. */
function codeOf(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

// Guard 1 — the tripId URL param is read in exactly one place.
//
// The bug this came from: resolving the param was every component's own job,
// six had copied the same block, and the seventh (LiveFaceClient, root of the
// Cup subtree) skipped it. Removing slugs killed that specific failure, not
// the shape of it — a param read in a dozen places is still a dozen places to
// get wrong the next time this route's shape changes.
describe("no trip-scoped component reads the tripId param directly", () => {
  const SCANNED = ["components/games", "components/competition", "app/trips/[tripId]"];
  /** Redirect-only alias: reads the param solely to rebuild the URL it
   *  forwards to, never to call a procedure. */
  const ALLOWED = new Set(["app/trips/[tripId]/leaderboard/page.tsx"]);
  const files = SCANNED.flatMap((d) => walk(join(ROOT, d)));

  it("scans a non-trivial number of files (guards against a broken glob)", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it("reads the tripId param only in TripIdProvider", () => {
    const offenders = files.filter((file) => {
      const rel = file.slice(ROOT.length + 1).replace(/\\/g, "/");
      if (ALLOWED.has(rel)) return false;
      const code = codeOf(file);
      return /useParams\s*(<[^>]*>)?\s*\(/.test(code) && /tripId/.test(code);
    });
    expect(offenders.map((f) => f.slice(ROOT.length + 1))).toEqual([]);
  });
});

// Guard 2 — trip URLs are built from the id, never a slug.
//
// Slugs were removed once before and the removal was incomplete: the machinery
// survived in the background and the app drifted back onto it, which is how a
// `slug ?? id` fallback ended up being the URL form for every trip opened from
// a list. This fails the build if a `slug` identifier reappears anywhere in
// src, so a second partial removal can't quietly become a third.
describe("trip slugs stay removed", () => {
  const files = walk(join(ROOT, "components"))
    .concat(walk(join(ROOT, "app")))
    .concat(walk(join(ROOT, "lib")))
    .concat(walk(join(ROOT, "server")));

  it("no source file references a trip slug", () => {
    const offenders = files.filter((f) => /slug/i.test(codeOf(f)));
    expect(offenders.map((f) => f.slice(ROOT.length + 1))).toEqual([]);
  });

  it("no source file builds a trip URL with a `?? id` fallback", () => {
    const offenders = files.filter((f) => /\/trips\/\$\{[^}]*\?\?/.test(codeOf(f)));
    expect(offenders.map((f) => f.slice(ROOT.length + 1))).toEqual([]);
  });
});
