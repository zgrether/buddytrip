import fs from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

/**
 * ── EVERY SLICE IN `anyTouched` MUST BE CLEARABLE, AND MUST BE DURABLE ──────
 *
 * The settings page is draft-then-save (CLAUDE.md #18). Each view keeps its
 * edits as null-per-slice state, folds them into one `configDraft`, and asks
 * three things of that slice set:
 *
 *   1. `anyTouched`   — has the user edited anything? (freezes the baseline)
 *   2. `resetSlices`  — drop every edit          (Cancel, and post-save)
 *   3. `draftBundle`  — mirror every edit to the outbox (hard-teardown recovery)
 *
 * A slice in (1) but not (2) is not a cosmetic omission. `anyTouched` gates the
 * baseline freeze in `useConfigDraft` — `if (prev && anyTouched) return prev` —
 * so a slice that can never return to null pins the frozen `{draft, hash}` for
 * the LIFE OF THE MOUNT. The hash half of that pair is Save's
 * optimistic-concurrency base, so once it is stale the page answers every save
 * with "This game changed on another device" and **no in-app action can clear
 * it**: Cancel routes to the same `resetSlices`, and the builder's own Clear
 * writes `[]`, which is not null.
 *
 * That is what `PickemGameView` shipped. `matchesDraft` was in `anyTouched`
 * (:791) and in `configDraft` (:803) and in neither `resetSlices` nor
 * `draftBundle`. Reported from the running app: slate, pair, Save -> refused,
 * Cancel -> nothing, clear the matches -> still nothing, leave the game.
 *
 * A slice in (1) but not (3) is quieter and loses more: the outbox never
 * mirrors it, so a hard teardown mid-edit drops that slice alone.
 *
 * ── Why a SOURCE guard, and what it therefore does not prove ────────────────
 *
 * These are 1,000-2,000-line client components full of hooks and tRPC, and this
 * suite is `environment: "node"`. It cannot mount them. What it can do is read
 * the three lists and check they agree — which is the actual invariant, and
 * catches the NEXT slice rather than only this one.
 *
 * It does NOT prove Cancel works end to end. That needs a person, or a
 * Playwright spec; if this surface ever gets one, the sequence above is the
 * thing to put in it. Said here rather than implied.
 *
 * ── The scanner is tested BEFORE it is trusted ─────────────────────────────
 *
 * A source scan is exactly the instrument that reports a confident green about
 * a file it failed to parse. So `sliceReport` is a pure function, and the first
 * three cases below feed it fixtures whose answers are known — including one
 * where the missing setter is present but COMMENTED OUT, which is the way a
 * naive scan passes on a bug. Only after it has been watched to go red is it
 * pointed at the real views.
 */

/** Body of the first brace-balanced block at or after `from`. Braces, never a
 *  line range — a range walks off the end of the declaration it meant to bound
 *  and sweeps in the neighbours (CLAUDE.md: measure the thing, not the region). */
function blockAfter(src: string, from: number): string {
  const open = src.indexOf("{", from);
  if (open === -1) throw new Error("no block");
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open + 1, i);
  }
  throw new Error("unbalanced");
}

/** Comments out. A `// setFooDraft(null)` left behind by a half-finished edit
 *  would otherwise satisfy the scan — the exact shape this file is guarding
 *  against, one level up. Inert against today's sources; the fixtures below are
 *  what prove it is doing anything at all. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");
}

export type SliceReport = {
  touched: string[];
  missingFromReset: string[];
  missingFromBundle: string[];
};

/** The three lists, read out of a view's source and compared. */
export function sliceReport(rawSrc: string, resetFn = "resetSlices"): SliceReport {
  const src = stripComments(rawSrc);

  const anyTouched = /const anyTouched\s*=([\s\S]*?);/.exec(src);
  if (!anyTouched) throw new Error("no `const anyTouched` — the scan cannot see the view");
  const touched = [...new Set([...anyTouched[1].matchAll(/\b(\w+Draft)\b/g)].map((m) => m[1]))].sort();
  if (touched.length === 0) throw new Error("`anyTouched` names no slices — parsed, but wrongly");

  const resetAt = src.indexOf(`function ${resetFn}(`);
  if (resetAt === -1) throw new Error(`no \`function ${resetFn}(\``);
  const resetBody = blockAfter(src, resetAt);
  const cleared = new Set(
    [...resetBody.matchAll(/\bset(\w+Draft)\(/g)].map((m) => m[1][0].toLowerCase() + m[1].slice(1))
  );

  const bundleAt = src.indexOf("const draftBundle");
  if (bundleAt === -1) throw new Error("no `const draftBundle`");
  const bundleBody = blockAfter(src, bundleAt);

  return {
    touched,
    missingFromReset: touched.filter((t) => !cleared.has(t)),
    missingFromBundle: touched.filter((t) => !new RegExp(`\\b${t}\\b`).test(bundleBody)),
  };
}

const COMPLETE = `
  const anyTouched = nameDraft !== null || matchesDraft !== null;
  const draftBundle = useMemo(() => ({ name: nameDraft, matches: matchesDraft }), [nameDraft, matchesDraft]);
  function resetSlices() {
    setNameDraft(null);
    setMatchesDraft(null);
  }
`;

describe("the scanner goes red on a known-bad view before it is trusted", () => {
  it("passes a view whose three lists agree", () => {
    const r = sliceReport(COMPLETE);
    expect(r.touched).toEqual(["matchesDraft", "nameDraft"]);
    expect(r.missingFromReset).toEqual([]);
    expect(r.missingFromBundle).toEqual([]);
  });

  it("flags a slice that `resetSlices` does not clear — the shipped defect", () => {
    const r = sliceReport(COMPLETE.replace("    setMatchesDraft(null);\n", ""));
    expect(r.missingFromReset).toEqual(["matchesDraft"]);
  });

  it("flags a slice whose setter is present but COMMENTED OUT", () => {
    // Without `stripComments` this fixture passes, and the stripper has no
    // other case that proves it: it is inert against every real view today.
    const r = sliceReport(COMPLETE.replace("    setMatchesDraft(null);", "    // setMatchesDraft(null);"));
    expect(r.missingFromReset).toEqual(["matchesDraft"]);
  });

  it("flags a slice missing from the outbox bundle", () => {
    const r = sliceReport(COMPLETE.replace(", matches: matchesDraft", "").replace(", matchesDraft]", "]"));
    expect(r.missingFromBundle).toEqual(["matchesDraft"]);
    expect(r.missingFromReset).toEqual([]);
  });

  it("throws rather than passing when it cannot find the view's parts", () => {
    // A green from a scan that parsed nothing is the failure this whole file
    // is about. Renaming `anyTouched` must break the suite, not satisfy it.
    expect(() => sliceReport(COMPLETE.replace("const anyTouched", "const somethingElse"))).toThrow();
    expect(() => sliceReport(COMPLETE.replace("function resetSlices", "function somethingElse"))).toThrow();
    expect(() => sliceReport(COMPLETE.replace("const draftBundle", "const somethingElse"))).toThrow();
  });
});

const read = (f: string) => fs.readFileSync(join(__dirname, f), "utf8");

describe("every game settings view clears and mirrors every slice it counts as touched", () => {
  // `MatchGameView` is absent on purpose — its `resetSlices` TAKES the matches
  // to reset to, and its matches touch-flag is a ref (`draftTouched.current`),
  // so neither is a `*Draft` identifier the generic scan can see. It gets its
  // own case below rather than being silently skipped, which would be this
  // file's own failure mode.
  const VIEWS = ["RackGameView", "StrokeGameView", "NonGolfGameView", "PickemGameView"] as const;

  it.each(VIEWS)("%s", (view) => {
    const r = sliceReport(read(`${view}.tsx`));
    expect(r.touched.length).toBeGreaterThan(3); // parsed something real
    expect(r.missingFromReset, `${view}: in anyTouched, never cleared`).toEqual([]);
    expect(r.missingFromBundle, `${view}: in anyTouched, never mirrored to the outbox`).toEqual([]);
  });

  it("PickemGameView clears the matches slice — the reported defect, named", () => {
    const r = sliceReport(read("PickemGameView.tsx"));
    expect(r.touched).toContain("matchesDraft");
    expect(r.missingFromReset).toEqual([]);
  });

  it("MatchGameView's reset re-seeds its matches draft and clears its touch flag", () => {
    const body = blockAfter(stripComments(read("MatchGameView.tsx")), stripComments(read("MatchGameView.tsx")).indexOf("function resetSlices("));
    expect(body).toContain("draftTouched.current = false");
    expect(body).toContain("setDraft(");
  });
});

describe("the slate write refreshes the config fingerprint it moves", () => {
  /**
   * `save_pickem_config` ends by creating the `pickem_games` row (migration
   * 176), which IS hashed — so the slate save moves `games.configHash` even
   * though the slate table itself is not hashed. `resetGameConfigHash`'s
   * contract covers exactly this ("any write that changes a column
   * `readGameConfigHash` folds in … when the write does NOT go through
   * `save_game_config`") and this writer did not call it.
   *
   * Bounded to the mutation's own block, not the file: a match anywhere in
   * 2,000 lines would pass while the handler that needs it has nothing.
   */
  it("`pickem.saveConfig`'s onSuccess resets the hash", () => {
    const src = stripComments(read("PickemGameView.tsx"));
    const at = src.indexOf("trpc.pickem.saveConfig.useMutation");
    expect(at, "the slate mutation moved or was renamed").toBeGreaterThan(-1);
    expect(blockAfter(src, at)).toContain("resetGameConfigHash(utils,");
  });
});
