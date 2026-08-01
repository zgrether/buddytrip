import { describe, it, expect } from "vitest";
import { computeStrokeTeamStandings, type StrokeStanding } from "./strokePlay";

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
    // The dangerous edge: a row would carry total 0 and, under lowest-wins, an
    // absent team would win the game outright. Teams are discovered FROM the
    // players, so this holds by construction.
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
});
