import { describe, it, expect } from "vitest";
import {
  confirmUnresolvedFinalize,
  pickemFinalize,
  pickemResolution,
  unresolvedWarning,
  type PickemFinalizeInput,
} from "./pickemFinalize";
import type { ScoredPick } from "./pickemScoring";

/**
 * What a finished pick'em game pays the cup.
 *
 * The whole point of the module is that it COMPOSES the board's own functions,
 * so the tests that matter most are the ones that would pass against a second
 * implementation and the ones that would not.
 */

const slate = (n: number, resolved: number, multiplier = 1) =>
  Array.from({ length: n }, (_, i) => ({
    id: `g${i + 1}`,
    result: i < resolved ? ("home" as const) : null,
    multiplier,
  }));

/** A sheet that gets `right` of the first games correct, the rest wrong. */
const sheet = (n: number, right: number): ScoredPick[] =>
  Array.from({ length: n }, (_, i) => ({
    slateGameId: `g${i + 1}`,
    pick: i < right ? ("home" as const) : ("away" as const),
    confidence: n - i,
  }));

const base = (over: Partial<PickemFinalizeInput> = {}): PickemFinalizeInput => ({
  slate: slate(4, 4),
  sheets: {},
  matches: [],
  teams: [
    { id: "A", memberIds: ["a1", "a2"] },
    { id: "B", memberIds: ["b1", "b2"] },
  ],
  useConfidence: true,
  rollUp: "individual_matches",
  pointsMode: false,
  pointsTotal: 8,
  distribution: [8],
  ...over,
});

describe("pickemResolution", () => {
  it("reads points mode FIRST, because roll_up is inert there", () => {
    /**
     * A points cup still SETS `roll_up` and means nothing by it, so a cup
     * carrying `individual_matches` would be paid as match play by a build that
     * checked the roll-up first. Resolved in one place rather than by adding
     * `!pointsMode &&` at each site.
     */
    expect(pickemResolution({ rollUp: "individual_matches", pointsMode: true })).toBe(
      "placement"
    );
    expect(pickemResolution({ rollUp: "team_totals", pointsMode: true })).toBe("placement");
    expect(pickemResolution({ rollUp: "individual_matches", pointsMode: false })).toBe(
      "individual_matches"
    );
    expect(pickemResolution({ rollUp: "team_totals", pointsMode: false })).toBe("simple");
  });
});

describe("individual matches — the game's points split across valid matches", () => {
  const twoMatches = (right: [number, number, number, number]) =>
    base({
      matches: [
        { sideAId: "a1", sideBId: "b1", pointValue: null },
        { sideAId: "a2", sideBId: "b2", pointValue: null },
      ],
      sheets: {
        a1: sheet(4, right[0]),
        b1: sheet(4, right[1]),
        a2: sheet(4, right[2]),
        b2: sheet(4, right[3]),
      },
    });

  it("pays each match its even share of the game's points", () => {
    // 8 points, 2 valid matches → 4 each. A wins both.
    const r = pickemFinalize(twoMatches([4, 0, 4, 0]));
    expect(r.resolution).toBe("individual_matches");
    expect(r.awards.get("A")).toBe(8);
    expect(r.awards.get("B")).toBe(0);
  });

  it("changes the divisor with the number of VALID matches, not the roster", () => {
    /**
     * The divisor is `liveMatchPointsPerMatch`, which counts matches with both
     * sides filled. A roster-derived divisor is the exact bug #1101 removed —
     * a plausible non-zero figure with no relationship to who was paired.
     *
     * Same four people, one match unpaired: the remaining match is worth the
     * WHOLE 8 rather than half of it.
     */
    const oneValid = base({
      matches: [
        { sideAId: "a1", sideBId: "b1", pointValue: null },
        { sideAId: "a2", sideBId: null, pointValue: null },
      ],
      sheets: { a1: sheet(4, 4), b1: sheet(4, 0), a2: sheet(4, 4) },
    });
    expect(pickemFinalize(oneValid).awards.get("A")).toBe(8);
  });

  it("splits a HALVED match", () => {
    // Equal totals: half the match's value each.
    const r = pickemFinalize(twoMatches([2, 2, 4, 0]));
    expect(r.awards.get("A")).toBe(4 + 2); // won one (4), halved the other (2)
    expect(r.awards.get("B")).toBe(2);
  });

  it("pays a per-match OVERRIDE its own value, not the even share", () => {
    /**
     * The case that decides how this composes. `matchesWonByTeam` returns wins
     * per TEAM, so "total wins × the even share" is exact only when no match
     * carries its own value — which is why the shared function is run per match
     * and scaled, rather than once over all of them.
     *
     * A build that multiplied the tally by the average pays A 8 here. The right
     * answer is 6: one match worth 2, the other taking the remaining share.
     */
    const withOverride = base({
      pointsTotal: 8,
      matches: [
        { sideAId: "a1", sideBId: "b1", pointValue: 2 },
        { sideAId: "a2", sideBId: "b2", pointValue: null },
      ],
      sheets: { a1: sheet(4, 4), b1: sheet(4, 0), a2: sheet(4, 4), b2: sheet(4, 0) },
    });
    const r = pickemFinalize(withOverride);
    expect(r.awards.get("A")).toBe(8);
    // ...and the shares are not equal: the overridden match paid 2, the other 6.
    const evenOnly = pickemFinalize(
      base({
        pointsTotal: 8,
        matches: [
          { sideAId: "a1", sideBId: "b1", pointValue: 2 },
          { sideAId: "a2", sideBId: "b2", pointValue: null },
        ],
        sheets: { a1: sheet(4, 4), b1: sheet(4, 0), a2: sheet(4, 0), b2: sheet(4, 4) },
      })
    );
    expect(evenOnly.awards.get("A")).toBe(2);
    expect(evenOnly.awards.get("B")).toBe(6);
  });

  it("pays a match whose contests are UNRESOLVED, on the totals as they stand", () => {
    /**
     * `matchesWonByTeam` pays only a settled match, which is right on a live
     * board — an undecided match has not been won by anybody yet.
     *
     * At finalize there is nothing left by definition, so the rows are built
     * with `remaining: 0`. Without that, finalizing with contests outstanding
     * pays NOTHING for the matches those contests were in — silently, and only
     * for some of them. This is the case that catches it.
     */
    const halfPlayed = base({
      slate: slate(4, 2),
      matches: [{ sideAId: "a1", sideBId: "b1", pointValue: null }],
      sheets: { a1: sheet(4, 4), b1: sheet(4, 0) },
    });
    const r = pickemFinalize(halfPlayed);
    expect(r.unresolved).toBe(2);
    expect(r.awards.get("A")).toBe(8);
  });
});

describe("simple — the app's existing word for team totals", () => {
  it("gives the WHOLE value to the higher total", () => {
    const r = pickemFinalize(
      base({
        rollUp: "team_totals",
        sheets: { a1: sheet(4, 4), b1: sheet(4, 0) },
      })
    );
    expect(r.resolution).toBe("simple");
    expect(r.awards.get("A")).toBe(8);
    expect(r.awards.get("B")).toBe(0);
  });

  it("SPLITS on equal totals", () => {
    const r = pickemFinalize(
      base({ rollUp: "team_totals", sheets: { a1: sheet(4, 2), b1: sheet(4, 2) } })
    );
    expect(r.awards.get("A")).toBe(4);
    expect(r.awards.get("B")).toBe(4);
  });

  it("splits across EVERY team on the top total, not just two", () => {
    // Two is the common shape and the one the copy is written for, but nothing
    // about the resolution needs it — and hard-coding a pair is how "either
    // side" language gets into a four-team cup.
    const r = pickemFinalize(
      base({
        rollUp: "team_totals",
        pointsTotal: 9,
        teams: [
          { id: "A", memberIds: ["a1"] },
          { id: "B", memberIds: ["b1"] },
          { id: "C", memberIds: ["c1"] },
        ],
        sheets: { a1: sheet(4, 3), b1: sheet(4, 3), c1: sheet(4, 3) },
      })
    );
    expect(r.awards.get("A")).toBe(3);
    expect(r.awards.get("C")).toBe(3);
  });

  it("pays nothing from a game worth nothing", () => {
    const r = pickemFinalize(
      base({ rollUp: "team_totals", pointsTotal: null, sheets: { a1: sheet(4, 4) } })
    );
    expect(r.awards.get("A")).toBe(0);
  });
});

describe("placement — a points cup", () => {
  it("pays by finishing position", () => {
    const r = pickemFinalize(
      base({
        pointsMode: true,
        distribution: [10, 6, 3],
        teams: [
          { id: "A", memberIds: ["a1"] },
          { id: "B", memberIds: ["b1"] },
          { id: "C", memberIds: ["c1"] },
        ],
        sheets: { a1: sheet(4, 4), b1: sheet(4, 2), c1: sheet(4, 0) },
      })
    );
    expect(r.resolution).toBe("placement");
    expect(r.awards.get("A")).toBe(10);
    expect(r.awards.get("B")).toBe(6);
    expect(r.awards.get("C")).toBe(3);
  });

  it("AVERAGES the award across a tie, as the board renders it", () => {
    // Two teams tied for first take (10 + 6) / 2 = 8 each, and the third still
    // finishes third. The board already draws it this way; this is the same
    // function, so they cannot disagree.
    const r = pickemFinalize(
      base({
        pointsMode: true,
        distribution: [10, 6, 3],
        teams: [
          { id: "A", memberIds: ["a1"] },
          { id: "B", memberIds: ["b1"] },
          { id: "C", memberIds: ["c1"] },
        ],
        sheets: { a1: sheet(4, 4), b1: sheet(4, 4), c1: sheet(4, 0) },
      })
    );
    expect(r.awards.get("A")).toBe(8);
    expect(r.awards.get("B")).toBe(8);
    expect(r.awards.get("C")).toBe(3);
  });

  it("pays without a single match paired", () => {
    // Placement reads team TOTALS, so pairing is irrelevant to it. A build that
    // required matches would strand every points cup.
    const r = pickemFinalize(
      base({
        pointsMode: true,
        matches: [],
        distribution: [5, 2],
        sheets: { a1: sheet(4, 4), b1: sheet(4, 1) },
      })
    );
    expect(r.awards.get("A")).toBe(5);
    expect(r.awards.get("B")).toBe(2);
  });
});

describe("unresolved games", () => {
  it("score zero for everyone — identically to a cancellation", () => {
    /**
     * The pair is the assertion. A slate half played and a slate whose second
     * half was CANCELLED pay exactly the same, because an unplayed contest and
     * a voided one are the same arithmetic.
     */
    const halfPlayed = base({
      rollUp: "team_totals",
      slate: slate(4, 2),
      sheets: { a1: sheet(4, 4), b1: sheet(4, 0) },
    });
    const halfCancelled = base({
      rollUp: "team_totals",
      slate: slate(4, 2).map((g, i) =>
        i >= 2 ? { ...g, result: "cancelled" as const } : g
      ),
      sheets: { a1: sheet(4, 4), b1: sheet(4, 0) },
    });
    expect(pickemFinalize(halfPlayed).awards.get("A")).toBe(
      pickemFinalize(halfCancelled).awards.get("A")
    );
    // ...and only the first one has anything to warn about.
    expect(pickemFinalize(halfPlayed).unresolved).toBe(2);
    expect(pickemFinalize(halfCancelled).unresolved).toBe(0);
  });

  it("names the count and the consequence, and says nothing when there is none", () => {
    // "Are you sure" without either is a dialog people confirm without reading.
    expect(unresolvedWarning(0)).toBe(null);
    expect(unresolvedWarning(4)).toContain("4 games have no result");
    expect(unresolvedWarning(4)).toContain("score nothing for everyone");
    expect(unresolvedWarning(1)).toContain("1 game has no result");
  });
});

describe("every team appears in the awards", () => {
  it("writes a team that earned nothing as 0, not as absent", () => {
    // "Earned nothing" and "was not in this game" are different facts, and a
    // results table that omits the first cannot express the second.
    const r = pickemFinalize(
      base({ rollUp: "team_totals", sheets: { a1: sheet(4, 4), b1: sheet(4, 0) } })
    );
    expect([...r.awards.keys()].sort()).toEqual(["A", "B"]);
    expect(r.awards.get("B")).toBe(0);
  });
});

describe("re-running produces the same answer", () => {
  it("is a pure function of its inputs, in all three resolutions", () => {
    /**
     * Idempotence at the arithmetic layer. The persistence layer's idempotence
     * is `games.finish`'s, which is already re-runnable — but a finalize that
     * recomputed differently from the same inputs would defeat that, and this
     * is the cheapest place to rule it out.
     */
    for (const over of [
      { rollUp: "individual_matches" as const, matches: [{ sideAId: "a1", sideBId: "b1", pointValue: null }] },
      { rollUp: "team_totals" as const },
      { pointsMode: true, distribution: [5, 2] },
    ]) {
      const input = base({ sheets: { a1: sheet(4, 3), b1: sheet(4, 1) }, ...over });
      expect([...pickemFinalize(input).awards]).toEqual([...pickemFinalize(input).awards]);
    }
  });
});

/**
 * ── WHAT GETS PERSISTED, AND WHY IT IS NOT ONE SHAPE ───────────────────────
 *
 * `computeCompetitionLeaderboard` reads a `game_results` row two ways:
 * POSITION against a distribution (`low_wins`), or RAW_SCORE as points already
 * decided (`high_wins`). Which one it uses is a property of the game.
 *
 * A points cup must write POSITIONS, so that changing the split — or the game's
 * total — afterwards re-derives the payout instead of leaving a figure frozen
 * to whatever the schedule said the evening somebody pressed Save. That is the
 * same rule migration 119's header states for the bracket.
 *
 * These are the cases a build that wrote points everywhere would fail, and it
 * is worth saying that such a build passes every OTHER test in this file: the
 * `awards` map is identical either way. The persisted shape is invisible to the
 * arithmetic, which is exactly why it needs its own assertions.
 */
describe("the persisted shape", () => {
  const twoTeams = (aRight: number, bRight: number, over: Partial<PickemFinalizeInput> = {}) =>
    base({
      slate: slate(4, 4),
      sheets: { a1: sheet(4, aRight), b1: sheet(4, bRight) },
      teams: [
        { id: "A", memberIds: ["a1"] },
        { id: "B", memberIds: ["b1"] },
      ],
      ...over,
    });

  it("a POINTS CUP writes positions, so the payout stays derived", () => {
    const out = pickemFinalize(twoTeams(4, 1, { pointsMode: true, distribution: [10, 4] }));
    expect(out.resolution).toBe("placement");
    expect(out.write.kind).toBe("placements");
    if (out.write.kind !== "placements") throw new Error("unreachable");
    // A ahead of B, and it is the PLACE that is stored — not the 10 and the 4.
    expect(out.write.rows).toEqual([
      { entityId: "A", position: 1 },
      { entityId: "B", position: 2 },
    ]);
    // ...while the preview still answers in points, which is what a runner asks.
    expect(out.awards.get("A")).toBe(10);
    expect(out.awards.get("B")).toBe(4);
  });

  it("a TIE writes ONE shared position, which is how the board recognises it", () => {
    /**
     * `placementPoints` reads equal positions as a tie group and averages the
     * award across the places they span. So writing 1 and 2 for a genuine tie
     * would not merely mislabel it — it would pay the wrong amounts, silently,
     * on a read the finalize never sees.
     */
    const out = pickemFinalize(twoTeams(3, 3, { pointsMode: true, distribution: [10, 4] }));
    if (out.write.kind !== "placements") throw new Error("expected placements");
    expect(out.write.rows.map((r) => r.position)).toEqual([1, 1]);
    expect(out.awards.get("A")).toBe(7);
    expect(out.awards.get("B")).toBe(7);
  });

  it("MATCH PLAY writes the points themselves — there is no schedule to defer to", () => {
    const out = pickemFinalize(
      twoTeams(4, 1, {
        rollUp: "individual_matches",
        matches: [{ sideAId: "a1", sideBId: "b1", pointValue: null }],
        pointsTotal: 6,
      })
    );
    expect(out.write.kind).toBe("points");
    if (out.write.kind !== "points") throw new Error("unreachable");
    expect(out.write.rows).toEqual([
      { entityId: "A", points: 6 },
      { entityId: "B", points: 0 },
    ]);
  });

  it("SIMPLE writes points too, and both write shapes describe EVERY team", () => {
    // A team on zero is written, not omitted — "earned nothing" and "was not in
    // this game" must not arrive at the board looking the same.
    const out = pickemFinalize(twoTeams(4, 1, { rollUp: "team_totals", pointsTotal: 6 }));
    expect(out.write.kind).toBe("points");
    if (out.write.kind !== "points") throw new Error("unreachable");
    expect(out.write.rows.map((r) => r.entityId).sort()).toEqual(["A", "B"]);
    expect(out.write.rows.find((r) => r.entityId === "B")?.points).toBe(0);
  });

  it("the write and the awards are the SAME answer in the points shapes", () => {
    // The one property that keeps the two fields from drifting: where points
    // are what gets stored, the stored figure IS the previewed figure.
    for (const rollUp of ["individual_matches", "team_totals"] as const) {
      const out = pickemFinalize(
        twoTeams(4, 2, {
          rollUp,
          matches: [{ sideAId: "a1", sideBId: "b1", pointValue: null }],
          pointsTotal: 9,
        })
      );
      if (out.write.kind !== "points") throw new Error("expected points for " + rollUp);
      for (const row of out.write.rows) {
        expect(row.points, rollUp + " / " + row.entityId).toBe(out.awards.get(row.entityId));
      }
    }
  });
});

/**
 * ── WHETHER THE FINALIZE STOPS TO ASK ──────────────────────────────────────
 *
 * The rule lives here rather than in the component because the component suite
 * runs in `node` with `renderToStaticMarkup` — nothing clicks, so "tapping Save
 * opens the prompt" is not a question that file can answer. Extracting the
 * predicate makes it one that can be answered exactly, which is better than an
 * approximation of it rendered.
 */
describe("confirmUnresolvedFinalize", () => {
  it("asks when contests are outstanding, and not otherwise", () => {
    expect(confirmUnresolvedFinalize({ unresolved: 2, canFinalize: true })).toBe(true);
    expect(confirmUnresolvedFinalize({ unresolved: 0, canFinalize: true })).toBe(false);
  });

  it("does NOT ask on the re-lock — that decision has already been taken", () => {
    /**
     * `canFinalize` and `canRelock` are mutually exclusive, so a false here IS
     * the re-lock arm. Somebody who reopened a finalized game, made corrections
     * and is closing it again has already answered this question; asking twice
     * is friction on a decision, not a safeguard.
     *
     * This is the case that separates the build from the obvious wrong one
     * (`unresolved > 0` alone), and it is the only case in the file that does.
     */
    expect(confirmUnresolvedFinalize({ unresolved: 2, canFinalize: false })).toBe(false);
  });

  it("never fires where there is no finalize on offer at all", () => {
    // A member's view, or a game still taking picks. Both reach here with
    // canFinalize false and must not raise a dialog nobody can act on.
    expect(confirmUnresolvedFinalize({ unresolved: 5, canFinalize: false })).toBe(false);
  });

  it("has a sentence to show wherever it fires", () => {
    /**
     * The pair, asserted together: a build where the predicate says yes and the
     * wording says null renders an EMPTY dialog, which is worse than no dialog —
     * it stops the finalize and explains nothing. They read the same count, and
     * this is what pins that they agree about it.
     */
    for (const unresolved of [1, 2, 16]) {
      expect(confirmUnresolvedFinalize({ unresolved, canFinalize: true })).toBe(true);
      expect(unresolvedWarning(unresolved)).toBeTruthy();
    }
    expect(confirmUnresolvedFinalize({ unresolved: 0, canFinalize: true })).toBe(false);
    expect(unresolvedWarning(0)).toBeNull();
  });
});
