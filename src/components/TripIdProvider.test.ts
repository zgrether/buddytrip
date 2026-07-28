import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { resolve, join } from "path";
import { resolveTripIdValue } from "./TripIdProvider";

const UUID_A = "11111111-2222-4333-8444-555555555555";
const UUID_B = "99999999-8888-4777-8666-555555555555";

// ── The unit under test: the resolution decision ───────────────────────────
describe("resolveTripIdValue", () => {
  const base = {
    rawParam: "",
    initialParam: null,
    initialTripId: null,
    resolvedId: undefined,
    resolveErrored: false,
  };

  it("passes a UUID param straight through — no lookup, resolved immediately", () => {
    const v = resolveTripIdValue({ ...base, rawParam: UUID_A });
    expect(v.tripId).toBe(UUID_A);
    expect(v.isResolving).toBe(false);
  });

  it("uses the server-seeded id for a slug param, with no client lookup", () => {
    const v = resolveTripIdValue({
      ...base,
      rawParam: "bbmi-2027-a3f9c1",
      initialParam: "bbmi-2027-a3f9c1",
      initialTripId: UUID_A,
    });
    expect(v.tripId).toBe(UUID_A);
    expect(v.isResolving).toBe(false);
  });

  it("reports resolving — NOT a resolved id — for a slug with no seed yet", () => {
    const v = resolveTripIdValue({ ...base, rawParam: "bbmi-2027-a3f9c1" });
    expect(v.tripId).toBeUndefined();
    expect(v.isResolving).toBe(true);
  });

  it("falls back to the client-resolved id when the server seed is absent", () => {
    const v = resolveTripIdValue({
      ...base,
      rawParam: "bbmi-2027-a3f9c1",
      resolvedId: UUID_A,
    });
    expect(v.tripId).toBe(UUID_A);
    expect(v.isResolving).toBe(false);
  });

  it("surfaces an unknown slug as isError so the route can bounce", () => {
    const v = resolveTripIdValue({
      ...base,
      rawParam: "not-a-real-trip",
      resolveErrored: true,
    });
    expect(v.isError).toBe(true);
    expect(v.tripId).toBeUndefined();
  });

  // ── The cross-trip bleed guard ───────────────────────────────────────────
  // A trip switch reuses this component: the param updates to trip B while the
  // seed may still be the one the server resolved for trip A. Trusting it
  // would render trip A's competition under trip B — worse than absence.
  it("NEVER returns a seed resolved for a DIFFERENT param (cross-trip bleed)", () => {
    const v = resolveTripIdValue({
      ...base,
      rawParam: "trip-b-slug",
      initialParam: "trip-a-slug",
      initialTripId: UUID_A,
    });
    expect(v.tripId).not.toBe(UUID_A);
    expect(v.tripId).toBeUndefined();
    expect(v.isResolving).toBe(true);
  });

  it("prefers the param's OWN uuid over a mismatched seed", () => {
    const v = resolveTripIdValue({
      ...base,
      rawParam: UUID_B,
      initialParam: "trip-a-slug",
      initialTripId: UUID_A,
    });
    expect(v.tripId).toBe(UUID_B);
  });
});

// ── The structural guard (this is the part that fails on `main`) ───────────
//
// The bug was not that one component resolved the param wrongly — it's that
// resolving it was every component's own job, six had copied the same block,
// and the seventh (LiveFaceClient, the root of the Cup subtree) skipped it and
// handed a slug to `competitions.faceBootstrap`. A slug never matches
// `trip_members.trip_id`, so the server threw FORBIDDEN and Cup rendered "no
// competition yet" for any trip opened from a list.
//
// Fixing that one call site would leave the NEXT one free to reappear. This
// asserts the property instead: inside trip-scoped code, the tripId URL param
// is read in exactly one place — TripIdProvider.
describe("no trip-scoped component re-derives tripId from useParams()", () => {
  const ROOT = resolve(__dirname, "..");
  const SCANNED = [
    "components/games",
    "components/competition",
    "app/trips/[tripId]",
  ];

  /**
   * `leaderboard/page.tsx` is a redirect-only alias: it reads the param solely
   * to rebuild the URL it forwards to (`/trips/<param>?view=cup`), never to
   * call a procedure. Passing the raw form along is correct there — the URL
   * layer accepts both slug and uuid.
   */
  const ALLOWED = new Set(["app/trips/[tripId]/leaderboard/page.tsx"]);

  function walk(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) out.push(...walk(full));
      else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
    }
    return out;
  }

  const files = SCANNED.flatMap((d) => walk(join(ROOT, d)));

  it("scans a non-trivial number of files (guards against a broken glob)", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it("reads the tripId param only in TripIdProvider", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = file.slice(ROOT.length + 1).replace(/\\/g, "/");
      if (ALLOWED.has(rel)) continue;
      const src = readFileSync(file, "utf8");
      // Strip comments so prose ABOUT useParams (including this fix's own
      // explanatory notes) can't trip the guard — only real code counts.
      const code = src
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");
      if (/useParams\s*(<[^>]*>)?\s*\(/.test(code) && /tripId/.test(code)) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });
});
