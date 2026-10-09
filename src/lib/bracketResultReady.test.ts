import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { buildDoubleDraw } from "./bracketDouble";
import { resolveDoubleDraw } from "./bracketDoubleAdvance";
import { matchKey, type ResolvedMatch, type WinnerBySeed } from "./bracketAdvance";
import { bracketResultReady } from "./bracketFormat";

/**
 * "Can this bracket's result be posted?" has ONE home: `bracketResultReady`,
 * which reads the placement functions (#1417). It used to be answered in three
 * places that disagreed — the server's own `drawComplete` gate, its separate
 * "no placements" refusal, and the play surface's Finish CTA — while the
 * preview read the placements.
 */

/** Seed 1 drops into the lower bracket, comes back, wins the first grand final. */
function upToReset(n: number) {
  const draw = buildDoubleDraw(n);
  const winners: WinnerBySeed = {};
  let dropped = false;
  const choose = (m: ResolvedMatch) => {
    const has1 = m.aSeed === 1 || m.bSeed === 1;
    if (has1 && m.bracket === "main" && !dropped) { dropped = true; return m.aSeed === 1 ? m.bSeed! : m.aSeed!; }
    if (has1) return 1;
    return Math.min(m.aSeed!, m.bSeed!);
  };
  for (let i = 0; i < draw.length + 5; i++) {
    const resolved = resolveDoubleDraw(draw, winners);
    const next = resolved.find((m) => m.playable);
    if (!next) throw new Error("settled before the reset");
    if (next.bracket === "final" && next.round === 2) return { draw, winners, resolved, reset: next };
    winners[matchKey(next)] = choose(next);
  }
  throw new Error("never reached the reset");
}

describe("bracketResultReady: postable exactly when the placement functions place someone", () => {
  it("is NOT ready while the grand-final reset is owed, and IS once it is played", () => {
    const { draw, winners, resolved, reset } = upToReset(4);
    expect(bracketResultReady(draw, resolved)).toBe(false);
    winners[matchKey(reset)] = 1;
    expect(bracketResultReady(draw, resolveDoubleDraw(draw, winners))).toBe(true);
  });
});

/**
 * SOURCE GUARD: nothing decides postability from `drawComplete` directly any
 * more. It remains the completeness rule INSIDE the placement functions, and is
 * defined in `bracketAdvance.ts`; anywhere else, a call is a second answer to
 * the question #1417 was about.
 *
 * Comments are stripped before matching: a comment that QUOTES the old rule
 * (`bracketFormat.ts` does) is not a call, and a guard that matched it would
 * either fail on prose or be "fixed" by allowlisting the file — which would
 * then hide a real call added there later.
 */
describe("drawComplete is called only inside the placement functions", () => {
  const SRC = join(__dirname, "..");
  const ALLOWED = new Set([
    "lib/bracketAdvance.ts",          // the definition
    "lib/bracketPlacements.ts",       // single-elim placement rule (and its re-export)
    "lib/bracketDoublePlacements.ts", // double-elim placement rule
  ]);
  const CALL = /\bdrawComplete\s*\(/;
  const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) return walk(full);
      return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
    });
  }

  it("no other source file calls it", () => {
    const files = walk(SRC);
    // Positive controls: the walk saw the codebase; the pattern catches the call
    // this PR removed from the server; and a call inside a comment does not count.
    expect(files.length).toBeGreaterThan(100);
    expect(CALL.test(stripComments("  if (!drawComplete(resolved)) {"))).toBe(true);
    expect(CALL.test(stripComments("/**\n * `drawComplete(resolved)` = every(...)\n */\n// drawComplete(x)"))).toBe(false);

    const offenders = files
      .map((f) => relative(SRC, f).split(sep).join("/"))
      .filter((rel) => !ALLOWED.has(rel))
      .filter((rel) => CALL.test(stripComments(readFileSync(join(SRC, rel), "utf8"))));
    expect(offenders).toEqual([]);
  });
});
