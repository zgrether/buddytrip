import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * SOURCE GUARD — nothing in the stroke path may name a ranking direction of its
 * own. `rankingDirection()` is the one mapping; everything else derives.
 *
 * ── Why a source scan and not an assertion ─────────────────────────────────
 *
 * The obvious guard is "assert the direction passed in matches the scoring
 * type", and it CANNOT FAIL: the same caller derives both from the same config,
 * so the two agree by construction and a green run says nothing. That is the
 * shape CLAUDE.md's compressed rule names — an instrument incapable of a red
 * result, reporting success indistinguishable from a real one.
 *
 * So the ranking functions take the SCORING TYPE and derive direction
 * internally, which makes a mismatch inexpressible AT THOSE SITES. This test is
 * the other half: the remaining way a second, drifting answer could appear is a
 * NEW site that sorts stroke results by a direction it decided for itself. A
 * source scan is the only thing that sees a site nobody has written yet.
 *
 * #1245 is the precedent. Its guard (`assertRankingConventionMatches`) fires
 * only when `position` is NULL, and a stroke game always writes a real one — so
 * that guard is structurally blind to this format and cannot be leaned on.
 */

const ROOT = join(process.cwd(), "src");

/**
 * Every file that ranks, renders or persists a stroke result. A new one gets
 * added here; that is the maintenance cost, and it is the point — the list is
 * the set of places a direction could be decided.
 */
const STROKE_PATH = [
  "lib/strokePlay.ts",
  "lib/stableford.ts",
  "server/lib/strokePlay.ts",
  "components/games/StrokeLeaderboard.tsx",
  "components/games/StandardGrid.tsx",
];

/**
 * The ONLY two lines in the whole stroke path allowed to contain a direction
 * literal: the type that declares the pair, and the mapping that chooses
 * between them.
 */
const ALLOWED = [
  'export type ScoreDirection = "low_wins" | "high_wins";',
  'return scoring === "stableford" ? "high_wins" : "low_wins";',
  // `ranking()` — the one branch below the mapping, handing out a comparator
  // and a strictly-better predicate together so no site can hand-roll half.
  'const low = rankingDirection(scoring) === "low_wins";',
];

/** Code lines only — JSDoc and `//` comments discuss directions constantly. */
function codeLines(src: string): { line: string; n: number }[] {
  const out: { line: string; n: number }[] = [];
  let inBlock = false;
  src.split("\n").forEach((raw, i) => {
    const t = raw.trim();
    if (inBlock) {
      if (t.includes("*/")) inBlock = false;
      return;
    }
    if (t.startsWith("/*")) {
      if (!t.includes("*/")) inBlock = true;
      return;
    }
    if (t.startsWith("//") || t.startsWith("*")) return;
    out.push({ line: t, n: i + 1 });
  });
  return out;
}

function offenders(rel: string): string[] {
  const src = readFileSync(join(ROOT, rel), "utf8");
  return codeLines(src)
    .filter((l) => l.line.includes("low_wins") || l.line.includes("high_wins"))
    .filter((l) => !ALLOWED.includes(l.line))
    .map((l) => `${rel}:${l.n}  ${l.line}`);
}

describe("stroke ranking direction has exactly one source", () => {
  it.each(STROKE_PATH)("%s names no direction of its own", (rel) => {
    expect(offenders(rel)).toEqual([]);
  });

  it("the guard is looking at real code — the allowed lines are actually there", () => {
    // Without this the suite would pass just as happily against a renamed
    // function or a moved file: zero offenders and zero anchors is the same
    // green as zero offenders and two anchors. "Absence of matches is absence
    // of search" — check the search could have found something.
    const src = readFileSync(join(ROOT, "lib/strokePlay.ts"), "utf8");
    const present = codeLines(src).map((l) => l.line);
    for (const a of ALLOWED) expect(present, `anchor missing: ${a}`).toContain(a);
  });

  it("the comment stripper does not hide a real code line", () => {
    // A stripper that dropped everything would make this guard vacuous. Feed it
    // a known offender and confirm it survives, and a known comment and confirm
    // it does not.
    const sample = [
      "/** direction: low_wins in a docblock */",
      "// direction: high_wins in a line comment",
      " * high_wins inside a JSDoc body",
      'const bad = { direction: "low_wins" };',
    ].join("\n");
    const kept = codeLines(sample).map((l) => l.line);
    expect(kept).toEqual(['const bad = { direction: "low_wins" };']);
  });
});
