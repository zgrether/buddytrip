import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { buildDraw } from "./bracket";
import { buildDoubleDraw } from "./bracketDouble";
import { resolveDraw, drawComplete, matchKey, type ResolvedMatch, type WinnerBySeed } from "./bracketAdvance";
import { resolveDoubleDraw } from "./bracketDoubleAdvance";
import { bracketPlacements } from "./bracketPlacements";
import { doubleBracketPlacements } from "./bracketDoublePlacements";
import { isDoubleElimination, resolveAnyDraw, placementsForDraw } from "./bracketFormat";

/**
 * PHASE 0 F1 — a double-elimination bracket finalized as SINGLE elimination.
 *
 * Production's one double bracket was posted with 4 of 15 matches undecided.
 * `deriveBracketPlacements` called `resolveDraw` unconditionally; that resolver
 * handles `main` + `consolation` and DROPS `lower`/`final` rows. The gate right
 * after it is `drawComplete(resolved)` = `resolved.every(m => !m.playable)`, so
 * the undecided lower-bracket rows were never in the set it checked.
 *
 * ── What this file can and cannot reach ────────────────────────────────────
 *
 * `deriveBracketPlacements` takes a Supabase client, so the end-to-end "server
 * finalize refuses" test is an integration test (`bracketResults.doubleElim.test.ts`)
 * and CI is its ONLY instrument — it cannot run without Docker.
 *
 * So this file deliberately carries as much of that claim as a pure test can.
 * The server's refusal IS `if (!drawComplete(resolved)) throw`, and both of its
 * inputs are pure: the first describe block asserts the gate's INPUT is right on
 * a real half-played double draw, which is the whole of the refusal minus the
 * `throw`. What CI alone still adjudicates is the wiring — that finalize calls
 * these functions and surfaces the error.
 */

/** Play only the MAIN bracket, leaving `lower` undecided — production's state. */
function playMainOnly(entrants: number): { draw: ReturnType<typeof buildDoubleDraw>; winners: WinnerBySeed } {
  const draw = buildDoubleDraw(entrants);
  const winners: WinnerBySeed = {};
  const limit = draw.length + 5;
  let picks = 0;
  for (;;) {
    const next = resolveDoubleDraw(draw, winners).find((m) => m.playable && m.bracket === "main");
    if (!next) return { draw, winners };
    winners[matchKey(next)] = Math.min(next.aSeed!, next.bSeed!);
    if (++picks > limit) throw new Error(`main bracket did not settle at ${entrants}`);
  }
}

/** Play a whole draw out, every bracket, favourite advancing. */
function playAll(draw: ReturnType<typeof buildDoubleDraw>): WinnerBySeed {
  const winners: WinnerBySeed = {};
  const limit = draw.length + 5;
  let picks = 0;
  for (;;) {
    const next: ResolvedMatch | undefined = resolveAnyDraw(draw, winners).find((m) => m.playable);
    if (!next) return winners;
    winners[matchKey(next)] = Math.min(next.aSeed!, next.bSeed!);
    if (++picks > limit) throw new Error("draw did not settle");
  }
}

describe("the finalize gate can see a double draw's lower bracket", () => {
  /**
   * THE BUG, as a pure assertion. `drawComplete` is the server's refusal, and
   * these are the two resolvers it can be handed.
   *
   * The `resolveDraw` line is the CHARACTERIZATION — it is what finalize did, and
   * it reports a half-played bracket as finished. If it ever goes false, the
   * single resolver has started carrying `lower` rows and this whole file needs
   * rereading.
   */
  it.each([4, 8, 16])("%i entrants: main decided, lower not", (entrants) => {
    const { draw, winners } = playMainOnly(entrants);

    // The fixture is only interesting if it really has undecided lower matches.
    const lowerLeft = resolveDoubleDraw(draw, winners).filter((m) => m.playable);
    expect(lowerLeft.length, "fixture must leave real matches unplayed").toBeGreaterThan(0);
    expect(lowerLeft.every((m) => m.bracket !== "main"), "…and none of them in main").toBe(true);

    // What finalize used to ask, and the wrong answer it got.
    expect(drawComplete(resolveDraw(draw, winners)), "OLD: the gate said finished").toBe(true);

    // What it asks now.
    expect(drawComplete(resolveAnyDraw(draw, winners)), "NEW: the gate refuses").toBe(false);
  });

  it("a single-elim draw is unaffected — same resolver, same answer", () => {
    const draw = buildDraw(8);
    const winners: WinnerBySeed = {};
    expect(isDoubleElimination(draw)).toBe(false);
    expect(resolveAnyDraw(draw, winners)).toEqual(resolveDraw(draw, winners));
    // Half-played single draw still refuses, as it always did.
    expect(drawComplete(resolveAnyDraw(draw, winners))).toBe(false);
  });
});

describe("the placement rule follows the draw too", () => {
  /**
   * THE SECOND DUPLICATION. Fixing only the resolver yields a quieter wrong
   * build: finalize stops early (right) and still posts SINGLE-elim placements
   * (wrong), because the server only ever called `bracketPlacements`.
   *
   * This is the case that separates the two builds, and it is the one that looks
   * redundant next to the gate test until you write it.
   */
  it.each([4, 8, 16])("%i entrants: a finished double draw places by the double rule", (entrants) => {
    const draw = buildDoubleDraw(entrants);
    const winners = playAll(draw);
    const resolved = resolveAnyDraw(draw, winners);
    expect(drawComplete(resolved), "fixture must be finished").toBe(true);

    expect(placementsForDraw(draw, resolved)).toEqual(doubleBracketPlacements(resolved));

    // And it is NOT what the single rule would have said — otherwise this test
    // passes against the resolver-only build and proves nothing.
    expect(placementsForDraw(draw, resolved)).not.toEqual(bracketPlacements(resolved));
  });

  it("a finished single draw places by the single rule", () => {
    const draw = buildDraw(8);
    const winners: WinnerBySeed = {};
    const limit = draw.length + 5;
    let picks = 0;
    for (;;) {
      const next = resolveDraw(draw, winners).find((m) => m.playable);
      if (!next) break;
      winners[matchKey(next)] = Math.min(next.aSeed!, next.bSeed!);
      if (++picks > limit) throw new Error("single draw did not settle");
    }
    const resolved = resolveAnyDraw(draw, winners);
    expect(placementsForDraw(draw, resolved)).toEqual(bracketPlacements(resolved));
  });
});

/**
 * ONE DECIDER, AND A FOURTH READER MUST GO RED.
 *
 * Two agreeing while a third disagrees is the shape that produced this bug: the
 * client read `bracketConfig.elimination`, `games.bracketPick` read the draw, and
 * finalize asked nothing. A test that only checks "client and server agree" would
 * have passed on two of those three.
 *
 * So the guard is structural rather than behavioural: `bracketFormat.ts` is the
 * ONLY module allowed to know both formats exist. Any other module importing a
 * single-format function AND a double-format function is deciding for itself,
 * which is a fourth reader arriving.
 *
 * Note what is deliberately ALLOWED: a module may import one side's functions.
 * `games.ts` passes `resolveDoubleDraw` to the pick cascade and `NonGolfGameView`
 * passes it to the board — format-specific USES, not format DECISIONS.
 */
const SINGLE_ONLY = ["resolveDraw", "bracketPlacements"] as const;
const DOUBLE_ONLY = ["resolveDoubleDraw", "doubleBracketPlacements"] as const;

/**
 * The BINDINGS a module imports — not its raw text.
 *
 * The first version of this guard searched whole file text and flagged four
 * false positives: `NonGolfGameView` and `games.ts` for the import PATH
 * "@/lib/bracketPlacements", and the two double modules for naming the single
 * ones in comments. A module discussing a function is not a module deciding
 * with it, and a guard that cries about comments becomes a guard people delete.
 */
function importedBindings(src: string): Set<string> {
  const out = new Set<string>();
  for (const m of src.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s*from/g)) {
    for (const raw of m[1].split(",")) {
      const name = raw.replace(/\btype\b/, "").split(/\bas\b/)[0].trim();
      if (name) out.add(name);
    }
  }
  return out;
}

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) { sourceFiles(full, acc); continue; }
    if (!/\.(ts|tsx)$/.test(entry)) continue;
    if (/\.test\.(ts|tsx)$/.test(entry)) continue;       // tests may name both
    acc.push(full);
  }
  return acc;
}

describe("one decider", () => {
  const root = path.join(process.cwd(), "src");
  const files = sourceFiles(root);

  /**
   * POSITIVE CONTROL. A scanner that reads nothing reports no violations, which
   * is indistinguishable from a clean tree — the inert-guard failure this repo
   * has now hit five times in a month. This proves the scan reaches real files
   * and that the matcher finds a string it must find.
   */
  it("the scan reaches the source tree and its matcher works", () => {
    expect(files.length).toBeGreaterThan(200);
    const self = files.find((f) => f.endsWith(path.join("lib", "bracketFormat.ts")));
    expect(self, "bracketFormat.ts must be in the scanned set").toBeDefined();
    const bindings = importedBindings(readFileSync(self!, "utf8"));
    expect(SINGLE_ONLY.every((n) => bindings.has(n))).toBe(true);
    expect(DOUBLE_ONLY.every((n) => bindings.has(n))).toBe(true);
    // A comment or an import PATH naming a function is not importing it.
    const decoy = importedBindings('import { EntrantPlacement } from "./bracketPlacements";\n// resolveDraw is mentioned here');
    expect(decoy.has("bracketPlacements")).toBe(false);
    expect(decoy.has("resolveDraw")).toBe(false);
    expect(decoy.has("EntrantPlacement")).toBe(true);
  });

  it("bracketFormat.ts is the ONLY module that knows both formats exist", () => {
    const knowsBoth = files.filter((f) => {
      const b = importedBindings(readFileSync(f, "utf8"));
      return SINGLE_ONLY.some((n) => b.has(n)) && DOUBLE_ONLY.some((n) => b.has(n));
    });
    expect(knowsBoth.map((f) => path.relative(root, f)).sort()).toEqual(["lib/bracketFormat.ts"]);
  });
});
