import { describe, it, expect } from "vitest";
import {
  computeStrokePlayStandings,
  computeStrokeTeamStandings,
  type StrokeStanding,
} from "./strokePlay";

/**
 * Team aggregate net — every player's net counts toward their team's total,
 * lowest total wins.
 *
 * The regression this guards: a finalized stroke game contributed NOTHING to the
 * cup, because the engine wrote only `entity_type='user'` rows while
 * `competitionLeaderboard` reads `.eq("entity_type","team")`. Stroke's writer was
 * built for standalone play ("competition_points_earned null — standalone game",
 * its own doc comment) and never learned the competition half.
 */

const s = (entityId: string, rawScore: number, position = 1): StrokeStanding => ({
  entityId,
  rawScore,
  position,
});

describe("computeStrokeTeamStandings", () => {
  it("sums every player's net into their team, lowest total first", () => {
    const out = computeStrokeTeamStandings(
      [s("a1", 72), s("a2", 80), s("b1", 70), s("b2", 75)],
      { a1: "A", a2: "A", b1: "B", b2: "B" }
    );
    expect(out).toEqual([
      { teamId: "B", total: 145, playerCount: 2, position: 1 },
      { teamId: "A", total: 152, playerCount: 2, position: 2 },
    ]);
  });

  it("drops NO scores — a team's worst player still counts", () => {
    // The distinguishing property vs lowest-N. If a blow-up round were dropped,
    // A would win here; every shot counting is the whole premise of the format.
    const out = computeStrokeTeamStandings([s("a1", 70), s("a2", 110), s("b1", 85), s("b2", 88)], {
      a1: "A",
      a2: "A",
      b1: "B",
      b2: "B",
    });
    expect(out[0]).toMatchObject({ teamId: "B", total: 173, position: 1 });
    expect(out[1]).toMatchObject({ teamId: "A", total: 180, position: 2 });
  });

  it("handles uneven team sizes without any special rule", () => {
    // Three-a-side vs two-a-side simply produces a bigger total. That is the
    // known consequence of the chosen rule, not a bug — recorded so nobody
    // "fixes" it into an average later without deciding to.
    const out = computeStrokeTeamStandings([s("a1", 70), s("a2", 70), s("a3", 70), s("b1", 80), s("b2", 80)], {
      a1: "A",
      a2: "A",
      a3: "A",
      b1: "B",
      b2: "B",
    });
    expect(out).toEqual([
      { teamId: "B", total: 160, playerCount: 2, position: 1 },
      { teamId: "A", total: 210, playerCount: 3, position: 2 },
    ]);
  });

  it("gives a team with NO players in the game no row at all", () => {
    // NOTE: this is NOT the case that failed in production — see the block below.
    // Kept because it is still true, but it is the weaker of the two.
    const out = computeStrokeTeamStandings([s("a1", 72), s("a2", 74)], {
      a1: "A",
      a2: "A",
      b1: "B", // B is assigned in the competition but nobody played
      b2: "B",
    });
    expect(out).toEqual([{ teamId: "A", total: 146, playerCount: 2, position: 1 }]);
  });

  it("ignores a player with no team assignment", () => {
    const out = computeStrokeTeamStandings([s("a1", 70), s("nomad", 1), s("b1", 80)], {
      a1: "A",
      b1: "B",
    });
    expect(out).toEqual([
      { teamId: "A", total: 70, playerCount: 1, position: 1 },
      { teamId: "B", total: 80, playerCount: 1, position: 2 },
    ]);
  });

  it("shares a position on a tie and skips the next (1, 2, 2, 4)", () => {
    const out = computeStrokeTeamStandings(
      [s("a", 70), s("b", 80), s("c", 80), s("d", 90)],
      { a: "A", b: "B", c: "C", d: "D" }
    );
    expect(out.map((r) => [r.teamId, r.position])).toEqual([
      ["A", 1],
      ["B", 2],
      ["C", 2],
      ["D", 4],
    ]);
  });

  it("orders equal totals deterministically by teamId", () => {
    // Position is what scores, but an unstable row order makes diffs unreadable
    // and would churn anything downstream that hashes the read.
    const first = computeStrokeTeamStandings([s("z", 70), s("a", 70)], { z: "Z", a: "A" });
    const second = computeStrokeTeamStandings([s("a", 70), s("z", 70)], { z: "Z", a: "A" });
    expect(first).toEqual(second);
    expect(first.map((r) => r.teamId)).toEqual(["A", "Z"]);
    expect(first.every((r) => r.position === 1)).toBe(true);
  });

  it("returns nothing when no player is assigned to any team", () => {
    // A standalone stroke game: no competition, so no assignments and no team
    // rows. The caller must not write an empty team set as a result.
    expect(computeStrokeTeamStandings([s("a", 70), s("b", 80)], {})).toEqual([]);
  });

  /**
   * ── The case the original guard MISSED ──────────────────────────────────────
   *
   * #802 shipped an exclusion for teams with no ROSTER and called the absent-team
   * edge "handled by construction". Production then produced a three-way tie for
   * first among teams that had played no golf: every one of them had rostered
   * players, and those players had simply never scored. The guard was on the
   * wrong axis — and the roster case it did cover cannot even occur in the field,
   * because it requires nobody to have been added at all.
   *
   * Qualification now lives one level down, in `computeStrokePlayStandings`, so
   * these tests drive the two functions TOGETHER. Testing the team function on
   * hand-made standings is what let the gap through the first time: it can only
   * see rows it is given, and the bug was in which rows it was given.
   */
  describe("unscored players — the production failure", () => {
    const ROUND = 18;

    it("drops a team whose players are all unscored, rather than crowning it with 0", () => {
      // Reproduces "BBMI Playground (Points)" / Test1: one player completed the
      // round; seven rostered team-mates across three other teams never teed off.
      const entries = Array.from({ length: ROUND }, () => ({ participant_id: "zach", value: 5 }));
      const standings = computeStrokePlayStandings(
        ["zach", "rob", "steve", "johnny", "taj", "brad", "charlie", "llama"],
        entries,
        { requiredUnits: ROUND }
      );

      const teams = computeStrokeTeamStandings(standings, {
        zach: "Phoenix", rob: "Phoenix",
        steve: "Negronis",
        johnny: "Stallions", taj: "Stallions",
        brad: "Lightning", charlie: "Lightning", llama: "Lightning",
      });

      // Before the fix this was four rows: Negronis/Stallions/Lightning tied at
      // position 1 with total 0, and Phoenix — the only team that played — 4th.
      expect(teams).toEqual([{ teamId: "Phoenix", total: 90, playerCount: 1, position: 1 }]);
    });

    it("excludes a partially-finished player, not just a completely unscored one", () => {
      // The mid-round case, which is the one that recurs: a legitimately rostered
      // player thru 9 of 18 is not a 45-stroke round. Nothing about the bug needs
      // a deleted player — only an unfinished one.
      const entries = [
        ...Array.from({ length: ROUND }, () => ({ participant_id: "done", value: 5 })),
        ...Array.from({ length: 9 }, () => ({ participant_id: "thru9", value: 4 })),
      ];
      const standings = computeStrokePlayStandings(["done", "thru9"], entries, {
        requiredUnits: ROUND,
      });
      expect(standings.map((r) => r.entityId)).toEqual(["done"]);

      // …and the half-round player's 36 does not become his team's total.
      expect(computeStrokeTeamStandings(standings, { done: "A", thru9: "B" })).toEqual([
        { teamId: "A", total: 90, playerCount: 1, position: 1 },
      ]);
    });

    it("returns nothing at all when nobody completed the round", () => {
      // The caller must refuse to finalize on this, rather than record an empty
      // result — `computeStrokePlayResults` throws PRECONDITION_FAILED.
      const standings = computeStrokePlayStandings(["a", "b"], [{ participant_id: "a", value: 4 }], {
        requiredUnits: ROUND,
      });
      expect(standings).toEqual([]);
      expect(computeStrokeTeamStandings(standings, { a: "A", b: "B" })).toEqual([]);
    });

    it("counts a 9-hole round as complete at 9 — qualification is per game, not per 18", () => {
      const entries = Array.from({ length: 9 }, () => ({ participant_id: "a", value: 4 }));
      const standings = computeStrokePlayStandings(["a", "b"], entries, { requiredUnits: 9 });
      expect(standings).toEqual([{ entityId: "a", rawScore: 36, position: 1 }]);
    });

    it("without requiredUnits, behaviour is unchanged — the live surfaces still see everyone", () => {
      // The three client callers render mid-round. Excluding the field there
      // would blank the screen, which is why qualification is opt-in.
      const standings = computeStrokePlayStandings(["a", "b"], [{ participant_id: "a", value: 4 }]);
      expect(standings).toHaveLength(2);
      expect(standings.find((r) => r.entityId === "b")).toMatchObject({ rawScore: 0, position: 1 });
    });
  });
});
