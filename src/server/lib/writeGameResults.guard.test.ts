import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * SOURCE GUARD — the finalize path must ask for a LOUD results write (#776).
 *
 * `writeGameResults` defaults to `onFailure: "log"`, which is correct for 9 of
 * the 12 engine call sites: those are `skipComplete` recomputes of DERIVED state
 * during setup, where throwing would make "pair a match" fail on a results-write
 * error, and where `saveConfig`'s post-save recompute throwing would mean the
 * settings RPC COMMITTED while the mutation returns an error — a worse lie than
 * the one #776 fixes.
 *
 * The three FINALIZE sites are the exception and must opt in explicitly. That
 * opt-in is the entire behavioural change of #776 — a game marked complete with
 * an empty results table is worse than a game that didn't finish — so leaving it
 * to memory would let a future format arm silently reintroduce the bug the issue
 * was filed for. A new `else if (strategy === ...)` branch that forgets
 * `onFailure: "throw"` fails the build here instead.
 *
 * Deliberately a source grep, not a behavioural test: the property is "every
 * finalize arm passes the flag", which is a statement about the dispatch's
 * shape. A runtime test could only prove the arms it happened to exercise.
 */

const GAMES_ROUTER = resolve(__dirname, "../routers/games.ts");
const src = readFileSync(GAMES_ROUTER, "utf8");

/** The engine computes that `games.finish` dispatches to. The placement arms
 *  (`writeManualResults`) are held to the same property separately below: they
 *  are not engine computes, so the count here cannot see them. */
const FINALIZE_ENGINES = [
  "computeMatchPlayResults",
  "computeRackNStackResults",
  "computeStrokePlayResults",
] as const;

/** Isolate `finish`'s body so a setup-path call elsewhere in the same file
 *  (saveConfig's recompute, which must NOT throw) can't satisfy the assertion. */
function finishBody(): string {
  const start = src.indexOf("  finish: authedProcedure");
  expect(start, "games.finish not found — did the procedure get renamed?").toBeGreaterThan(-1);
  const end = src.indexOf("\n  update: authedProcedure", start);
  expect(end, "could not find the procedure after finish").toBeGreaterThan(start);
  return src.slice(start, end);
}

describe("games.finish — results writes must fail loudly (#776)", () => {
  const body = finishBody();

  it.each(FINALIZE_ENGINES)("%s is called with onFailure: \"throw\"", (engine) => {
    const call = new RegExp(`${engine}\\s*\\([^)]*onFailure:\\s*"throw"`);
    expect(
      call.test(body),
      `${engine} is called in games.finish without onFailure: "throw". The finalize ` +
        `path must throw on a results-write failure — otherwise the game is marked ` +
        `complete with an empty results table, which is the bug #776 exists to fix.`
    ).toBe(true);
  });

  it("every engine call inside finish passes the flag (catches a new format arm)", () => {
    // Counts calls rather than naming them, so an engine added later is covered
    // without anyone remembering to extend FINALIZE_ENGINES above.
    const allCalls = body.match(/compute[A-Za-z]+Results\s*\(/g) ?? [];
    // `[^)]*` already spans newlines, so no `s` flag is needed (and the repo's
    // tsconfig target predates it).
    const loudCalls = body.match(/compute[A-Za-z]+Results\s*\([^)]*onFailure:\s*"throw"/g) ?? [];
    expect(
      loudCalls.length,
      `finish dispatches ${allCalls.length} engine compute(s) but only ${loudCalls.length} ` +
        `pass onFailure: "throw".`
    ).toBe(allCalls.length);
  });

  /**
   * The placement arms are the OTHER half of the same property.
   *
   * Two of `finish`'s branches commit through `writeManualResults` (the entered
   * order, and the bracket's derived one). A future arm that swapped it for a
   * bare insert would reintroduce the swallowed-failure bug on the placement
   * path while the engine assertions above stayed green.
   *
   * Named rather than counted, unlike the engine case: there is no shared prefix
   * to match on, so a count would only ever assert against itself.
   */
  it("both placement arms commit through writeManualResults", () => {
    const calls = body.match(/writeManualResults\s*\(/g) ?? [];
    expect(
      calls.length,
      `games.finish makes ${calls.length} writeManualResults call(s); expected 2 — the ` +
        `entered-order (manual) arm and the derived (bracket) arm. A placement arm that ` +
        `writes any other way must be atomic and throw on failure.`
    ).toBe(2);
  });

  /**
   * …and `writeManualResults` itself commits ATOMICALLY, in finalize mode (#1398).
   *
   * The assertion above is only as good as the function it names. That function
   * used to be a bare `.delete()` then a bare `.insert()` on `game_results`, so a
   * failure between them erased a finished game's results — and the call-count
   * assertion was green the whole time. So the body is checked too: it must go
   * through `writeGameResults` with `onFailure: "throw"`, and it must not touch
   * the table directly. `games.placementsAtomic.test.ts` is the behavioural half.
   */
  it("writeManualResults writes through writeGameResults, loudly, and never touches the table itself", () => {
    const start = src.indexOf("async function writeManualResults(");
    expect(start, "writeManualResults not found — did it get renamed?").toBeGreaterThan(-1);
    // Its body ends at the first top-level closing brace after the declaration.
    const end = src.indexOf("\n}\n", start);
    expect(end).toBeGreaterThan(start);
    const fn = src.slice(start, end);

    expect(
      /writeGameResults\s*\([^)]*onFailure:\s*"throw"/.test(fn),
      'writeManualResults must commit through writeGameResults with onFailure: "throw" — ' +
        "one transaction, and a failure that stops the game being marked complete."
    ).toBe(true);
    expect(
      /\.from\(\s*"game_results"\s*\)/.test(fn),
      "writeManualResults reads or writes game_results directly. A direct delete and insert " +
        "are two requests with nothing spanning them — the #1398 bug."
    ).toBe(false);
  });

  /**
   * The bracket arm DERIVES before it writes, and the derivation is a read — so
   * it must not be mistaken for an engine compute and handed the `onFailure`
   * flag, and it must not be inlined into the router either. Pinning the call
   * keeps the CLAUDE.md #8 split visible at the dispatch: pure rule in
   * `lib/bracketPlacements`, DB wrapper in `server/lib/bracketResults`, one
   * shared writer.
   */
  it("the bracket arm derives through the shared server wrapper", () => {
    expect(
      /deriveBracketPlacements\s*\(/.test(body),
      "games.finish's bracket arm no longer calls deriveBracketPlacements. The placement " +
        "rule is shared with the play surface's preview (CLAUDE.md #8) — a second derivation " +
        "in the router is a second answer to who won."
    ).toBe(true);
  });

  it("the setup paths are NOT converted — they must keep the quiet default", () => {
    // The inverse guard. If someone "helpfully" makes the setup callers throw,
    // pairing a match starts failing on a results-write error and saveConfig
    // reports failure after its RPC committed. Both were explicitly ruled out.
    const setupFiles = ["../routers/matches.ts", "../routers/playGroups.ts"];
    for (const rel of setupFiles) {
      const text = readFileSync(resolve(__dirname, rel), "utf8");
      expect(
        text.includes('onFailure: "throw"'),
        `${rel} passes onFailure: "throw". Setup-path recomputes must stay quiet — ` +
          `they re-derive state the next recompute reproduces, and throwing there makes ` +
          `mechanical setup writes user-visible failures.`
      ).toBe(false);
    }
  });
});
