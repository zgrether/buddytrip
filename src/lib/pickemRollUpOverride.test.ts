import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Source guard — "points overrides roll_up" is applied ONCE per surface.
 *
 * ── Why this is a guard and not a note ─────────────────────────────────────
 *
 * `pickem_games.roll_up` is INERT in a points competition but still SET: a
 * points cup can carry `individual_matches` and mean nothing by it. So every
 * site that branches on the raw column is a site that renders match-play
 * behaviour in a competition with no matches.
 *
 * Phase 7 found FIVE of them. Four were bugs, each failing differently:
 *
 *   1. `PickemGameView.individualMatches`  — the matches surface and grid
 *   2. `PickemBoard`, ×4 internal sites    — a match LIST instead of standings
 *   3. `set_pickem_result` (migration 164) — refused every result with "set the
 *      matches first", on a game where the matches surface correctly does not
 *      render, so the instruction named something the runner could not do
 *   4. `runBlockedReason`                  — the client half of that same lie
 *
 * Three were found by tests written for something else and one by looking at
 * the screen. That ratio is the argument for this file: the next one will not
 * announce itself either, and the fix is always the same — read the DERIVED
 * value, which already carries the override.
 *
 * The rule, plainly: compare against `individual_matches` in exactly two kinds
 * of place — where the override is RESOLVED, and where the setting is EDITED.
 * Everywhere else, read what the resolution produced.
 */

const SRC = join(process.cwd(), "src");

/**
 * Files permitted to compare the raw column, and why each is not a lie.
 *
 * Kept as a literal list rather than a pattern: a pattern that admitted, say,
 * anything under `pickem/` would silently admit the next component, which is
 * exactly the class of file this guard exists to catch.
 */
const ALLOWED = new Map<string, string>([
  [
    "components/games/PickemGameView.tsx",
    "RESOLVES the override — `individualMatches = !pointsMode && rollUp === ...`",
  ],
  [
    "components/games/pickem/PickemBoard.tsx",
    "RESOLVES it locally — `rollUp = pointsMode ? 'team_totals' : rollUpSetting`",
  ],
  [
    "lib/pickemSheet.ts",
    "RESOLVES it for the explainer — drops the head-to-head paragraphs",
  ],
  [
    "components/games/pickem/PickemScoringRows.tsx",
    "EDITS the setting itself; the row is absent in a points cup (`showRollUp`)",
  ],
]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** A COMPARISON against the value, not a type annotation or an option list. */
const COMPARE = /(?:===|!==)\s*["']individual_matches["']|["']individual_matches["']\s*(?:===|!==)/;

describe("points overrides roll_up — applied once, not remembered", () => {
  const files = walk(SRC);

  it("no file outside the resolution points compares the RAW column", () => {
    const offenders = files
      .filter((f) => COMPARE.test(readFileSync(f, "utf8")))
      .map((f) => f.slice(SRC.length + 1).replace(/\\/g, "/"))
      .filter((rel) => !ALLOWED.has(rel));

    expect(
      offenders,
      "read the DERIVED value instead — `roll_up` is inert in a points cup, so a " +
        "raw comparison renders match-play behaviour in a competition with no matches"
    ).toEqual([]);
  });

  it("the guard can actually SEE a comparison — not passing on an empty scan", () => {
    // Absence of matches is absence of search. If the regex stopped matching
    // anything the case above would go permanently green while covering
    // nothing, and the allowlist below would be describing files that no longer
    // contain what it claims.
    const found = files.filter((f) => COMPARE.test(readFileSync(f, "utf8")));
    expect(found.length).toBeGreaterThan(0);
  });

  it("every ALLOWED file still contains one — the list cannot rot silently", () => {
    // An entry that no longer matches is an entry nobody has to justify any
    // more, and a stale exemption is how the next offender gets waved through.
    const stale: string[] = [];
    for (const rel of ALLOWED.keys()) {
      const full = join(SRC, rel);
      if (!COMPARE.test(readFileSync(full, "utf8"))) stale.push(rel);
    }
    expect(stale, "these no longer compare the raw column — drop them from ALLOWED").toEqual([]);
  });
});
