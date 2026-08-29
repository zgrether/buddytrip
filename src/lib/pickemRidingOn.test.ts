import { describe, it, expect } from "vitest";
import { ridingOn } from "./pickemBoard";
import type { ScoredSlateGame, ScoredPick } from "./pickemScoring";

/**
 * "{n} matches are still riding on this" — the line that tells a runner which
 * of the unmarked games actually matters.
 *
 * Every case here is an EXCLUSION, because the number is only useful if the
 * things it counts can still change.
 */

const g = (id: string, result: ScoredSlateGame["result"] = null): ScoredSlateGame => ({
  id,
  result,
  multiplier: 1,
});

/** A sheet, as `slateGameId -> [pick, confidence]`. */
const sheet = (spec: Record<string, ["away" | "home", number]>): ScoredPick[] =>
  Object.entries(spec).map(([slateGameId, [pick, confidence]]) => ({
    slateGameId,
    pick,
    confidence,
  }));

const MATCH = [{ id: "m1", sideAId: "a", sideBId: "b" }];

describe("ridingOn", () => {
  it("counts a live match against each game that can still move it", () => {
    const slate = [g("g1"), g("g2")];
    const r = ridingOn(
      slate,
      MATCH,
      {
        a: sheet({ g1: ["home", 2], g2: ["home", 1] }),
        b: sheet({ g1: ["away", 2], g2: ["away", 1] }),
      },
      true
    );
    expect(r.byGame.get("g1")).toBe(1);
    expect(r.byGame.get("g2")).toBe(1);
    expect(r.matchesPending).toBe(1);
  });

  it("counts matches as a UNION, not a sum", () => {
    /**
     * One match riding on three unmarked games is one match hanging, not
     * three. The header reads "{m} matches hang on them" and a runner takes
     * that as how many people are still waiting.
     */
    const slate = [g("g1"), g("g2"), g("g3")];
    const r = ridingOn(
      slate,
      MATCH,
      {
        a: sheet({ g1: ["home", 3], g2: ["home", 2], g3: ["home", 1] }),
        b: sheet({ g1: ["away", 3], g2: ["away", 2], g3: ["away", 1] }),
      },
      true
    );
    expect([...r.byGame.values()]).toEqual([1, 1, 1]);
    expect(r.matchesPending).toBe(1);
  });

  it("excludes a CLINCHED match — nothing inside it is riding on anything", () => {
    /**
     * The design's own rule, and the pair is the assertion: the same slate and
     * the same match count when the lead is reachable and stop when it is not.
     * Points are still being scored inside a clinched match; none of them can
     * change who won it.
     *
     * g1 resolved with A taking 10; g2 is worth at most 1 to B.
     */
    const slate = [g("g1", "home"), g("g2")];
    const sheets = {
      a: sheet({ g1: ["home", 10], g2: ["home", 1] }),
      b: sheet({ g1: ["away", 10], g2: ["away", 1] }),
    };
    const clinched = ridingOn(slate, MATCH, sheets, true);
    expect(clinched.byGame.size).toBe(0);
    expect(clinched.matchesPending).toBe(0);

    // Same shape, reachable lead: B's remaining game is worth more than A's.
    const live = ridingOn(
      slate,
      MATCH,
      {
        a: sheet({ g1: ["home", 2], g2: ["home", 1] }),
        b: sheet({ g1: ["away", 2], g2: ["away", 9] }),
      },
      true
    );
    expect(live.byGame.get("g2")).toBe(1);
    expect(live.matchesPending).toBe(1);
  });

  it("excludes a FINISHED match", () => {
    const slate = [g("g1", "home")];
    const r = ridingOn(
      slate,
      MATCH,
      { a: sheet({ g1: ["home", 1] }), b: sheet({ g1: ["away", 1] }) },
      true
    );
    expect(r.byGame.size).toBe(0);
    expect(r.matchesPending).toBe(0);
  });

  it("excludes a game NO ONE can gain on, inside an otherwise live match", () => {
    /**
     * The extension beyond the design's rule, and the same reasoning one level
     * down. Both sides took the same team at the same rank on g1, so that game
     * cannot move this match by a point — counting it would put a number beside
     * a game where nothing is at stake.
     *
     * g2 keeps the match live, so this is not passing by the match being
     * excluded wholesale.
     */
    const slate = [g("g1"), g("g2")];
    const r = ridingOn(
      slate,
      MATCH,
      {
        a: sheet({ g1: ["home", 5], g2: ["home", 3] }),
        b: sheet({ g1: ["home", 5], g2: ["away", 3] }),
      },
      true
    );
    expect(r.byGame.has("g1")).toBe(false);
    expect(r.byGame.get("g2")).toBe(1);
    expect(r.matchesPending).toBe(1);
  });

  it("counts an agreement row at DIFFERENT ranks — the difference is real", () => {
    // The near-miss of the case above: same team, different ranks, so one of
    // them gains two points. That is a stake, and it is the whole reason the
    // head-to-head has a swing column.
    const slate = [g("g1")];
    const r = ridingOn(
      slate,
      MATCH,
      { a: sheet({ g1: ["home", 5] }), b: sheet({ g1: ["home", 3] }) },
      true
    );
    expect(r.byGame.get("g1")).toBe(1);
  });

  it("adds up across matches, and skips an unpaired side", () => {
    const slate = [g("g1")];
    const r = ridingOn(
      slate,
      [
        { id: "m1", sideAId: "a", sideBId: "b" },
        { id: "m2", sideAId: "c", sideBId: "d" },
        { id: "m3", sideAId: "e", sideBId: null },
      ],
      {
        a: sheet({ g1: ["home", 1] }),
        b: sheet({ g1: ["away", 1] }),
        c: sheet({ g1: ["home", 1] }),
        d: sheet({ g1: ["away", 1] }),
        e: sheet({ g1: ["home", 1] }),
      },
      true
    );
    expect(r.byGame.get("g1")).toBe(2);
    expect(r.matchesPending).toBe(2);
  });

  it("returns nothing at all when there are no matches", () => {
    // A team-totals game. The caller renders no line rather than "0 matches",
    // which would state a fact about a mechanic that is not in play.
    const r = ridingOn([g("g1")], [], { a: sheet({ g1: ["home", 1] }) }, true);
    expect(r.byGame.size).toBe(0);
    expect(r.matchesPending).toBe(0);
  });
});
