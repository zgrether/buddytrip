import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join, resolve } from "path";

/**
 * THE BOUNDARY: the matchup maker must not read or write pick'em state.
 *
 * ── Why this is the test that matters for Phase 2b ──────────────────────────
 * The component is not shared and is not going to be, yet. What is being
 * protected is the OPTION: with the boundary held, extracting it later is a
 * file move; without it, a rewrite. And the likely second consumer — ad-hoc
 * betting on a trip — mostly does not want this. "Twenty bucks says you miss
 * this putt" is free text, two sides, no ESPN. So the half that looks reusable
 * may be the half nobody else needs, and a premature shared home would have
 * been the wrong call.
 *
 * ── Why a source scan is legitimate HERE, of all places ─────────────────────
 * A source scan usually proves that text is present rather than that behaviour
 * happens (#945), and this file would be a weak test of almost anything else.
 * But the property under test IS a fact about imports: "this module cannot name
 * pick'em". Imports are exactly what source can settle, and nothing else can —
 * a render test would pass on a component that imported the whole slate and
 * simply did not use it on that path.
 */

const MATCHUP_DIR = resolve(__dirname);
const LIB = resolve(__dirname, "../../lib/matchupApi.ts");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => /\.tsx?$/.test(f) && !f.includes(".test."))
    .map((f) => join(dir, f));
}

const FILES = [...sourceFiles(MATCHUP_DIR), LIB];

describe("the matchup maker knows nothing about pick'em", () => {
  it("the scan sees real files (not passing vacuously)", () => {
    // Without this, a wrong directory would satisfy every "does not contain"
    // below by finding nothing at all — the same premise trap as an empty
    // OpenAPI document satisfying every negative assertion.
    expect(FILES.length).toBeGreaterThanOrEqual(2);
    for (const f of FILES) expect(readFileSync(f, "utf8").length).toBeGreaterThan(200);
    expect(FILES.some((f) => f.endsWith("MatchupSearch.tsx"))).toBe(true);
    expect(FILES.some((f) => f.endsWith("matchupApi.ts"))).toBe(true);
  });

  it("imports nothing from the pick'em tree", () => {
    for (const file of FILES) {
      const src = readFileSync(file, "utf8");
      const imports = [...src.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
      const offenders = imports.filter((i) => /pickem/i.test(i));
      expect(offenders, `${file} imports pick'em: ${offenders.join(", ")}`).toEqual([]);
    }
  });

  it("does not name pick'em concepts even in passing", () => {
    // Not just imports: a component that referenced `slate`, `confidence` or a
    // `pickem_*` table has taken on knowledge it should not have, whether or
    // not it imported anything.
    const banned = [/\bpickem\b/i, /pickem_slate_games/, /\buseConfidence\b/, /SlateDraftGame/];
    for (const file of FILES) {
      const src = readFileSync(file, "utf8");
      for (const pattern of banned) {
        expect(pattern.test(src), `${file} mentions ${pattern}`).toBe(false);
      }
    }
  });

  it("reaches no database and no tRPC — it is a fetch against one API", () => {
    // Storage is the caller's business. If this module could persist, "it does
    // not read or write pick'em state" would be a promise about restraint
    // rather than about capability.
    for (const file of FILES) {
      const src = readFileSync(file, "utf8");
      expect(/from\s+["']@\/lib\/trpc/.test(src), `${file} imports tRPC`).toBe(false);
      expect(/from\s+["']@\/lib\/supabase/.test(src), `${file} imports Supabase`).toBe(false);
    }
  });

  it("the guard can actually fail — a pick'em import would be caught", () => {
    // The mutation check, inline: the same detection run against a synthetic
    // source proves the regex would catch a real offender. Without it, all four
    // assertions above could be passing because the pattern never matches
    // anything.
    const offending = `import { SlateDraftGame } from "@/components/games/pickem/PickemSlateModal";`;
    const imports = [...offending.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
    expect(imports.filter((i) => /pickem/i.test(i))).toHaveLength(1);
    expect(/SlateDraftGame/.test(offending)).toBe(true);
  });
});
