import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";

/**
 * A test gets a competition through `TestContext` — `createCupTrip` (a trip with
 * its own cup) or `createCompetition` (which refuses a trip that already has
 * one) — never by inserting a `competitions` row directly.
 *
 * Why this is a guard and not a convention: a trip holds one competition
 * (migration 195), and 37 suites had quietly put several on one trip, because a
 * direct insert asks nobody. The helpers make the right thing the easy thing;
 * this makes the wrong thing visible. A file that genuinely needs a raw insert —
 * a test OF the constraint — is named in ALLOWED, with the reason.
 *
 * The pattern spans whitespace and newlines (`.from("competitions")` on one line,
 * `.insert(` on the next is the common formatting), and its own red proof is the
 * PROBE case below, so it cannot quietly stop matching.
 */

const ROOT = join(__dirname, "..", "..");
const DIRECT_INSERT = /from\(\s*["'`]competitions["'`]\s*\)\s*\.\s*(insert|upsert)\s*\(/;

const ALLOWED = new Set<string>([
  // The helpers themselves.
  "__tests__/helpers/test-setup.ts",
  // This file: its PROBE case carries the pattern as a string, on purpose.
  "__tests__/helpers/oneCupPerTrip.guard.test.ts",
]);

function testFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "node_modules") continue;
      out.push(...testFiles(p));
    } else if (/\.test\.tsx?$/.test(name) || name === "test-setup.ts") {
      out.push(p);
    }
  }
  return out;
}

describe("competitions in tests come from the helpers", () => {
  it("PROBE: the pattern matches the shape it exists to catch, across a line break", () => {
    expect(DIRECT_INSERT.test(`ctx.admin.from("competitions")\n      .insert({ id, trip_id })`)).toBe(true);
    expect(DIRECT_INSERT.test(`ctx.admin.from("competitions").upsert(row)`)).toBe(true);
    expect(DIRECT_INSERT.test(`ctx.admin.from("competitions").select("id")`)).toBe(false);
  });

  it("no test file inserts a competition directly", () => {
    const files = testFiles(ROOT);
    expect(files.length).toBeGreaterThan(100); // the walk reached the suite
    const offenders = files
      .map((f) => relative(ROOT, f).split("\\").join("/"))
      .filter((rel) => !ALLOWED.has(rel))
      .filter((rel) => DIRECT_INSERT.test(readFileSync(join(ROOT, rel), "utf8")));
    expect(offenders).toEqual([]);
  });
});
