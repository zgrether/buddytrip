import { describe, it, expect } from "vitest";
import { matchesWonByTeam, type MatchTallyRow } from "./pickemBoard";

/**
 * The matches-won tally.
 *
 * Every case here is about the boundary between "counts" and "does not yet",
 * because that boundary is the only thing this function decides.
 */

const row = (over: Partial<MatchTallyRow> = {}): MatchTallyRow => ({
  aTeamId: "A",
  bTeamId: "B",
  margin: 0,
  remaining: 0,
  clinched: false,
  ...over,
});

describe("matchesWonByTeam", () => {
  it("counts the leader of a FINISHED match", () => {
    const t = matchesWonByTeam([row({ margin: 5 })]);
    expect(t.get("A")).toBe(1);
    expect(t.get("B")).toBeUndefined();
  });

  it("counts a CLINCHED match too — the winner can no longer change", () => {
    /**
     * The decisive case, and the reason the predicate is two conditions rather
     * than one. `matchStanding` reports `clinched: false` once nothing is left —
     * a finished match is DECIDED, not clinched — so a tally asking only about
     * `clinched` would drop every completed match, and one asking only about
     * `remaining === 0` would sit at zero all Saturday and jump at the end.
     */
    const t = matchesWonByTeam([row({ margin: -9, remaining: 4, clinched: true })]);
    expect(t.get("B")).toBe(1);
  });

  it("counts nothing for a match still in the balance", () => {
    // Banked, not projected. A leader who can still be caught has won nothing
    // yet, and a scoreline must not say otherwise.
    const t = matchesWonByTeam([row({ margin: 9, remaining: 4, clinched: false })]);
    expect(t.size).toBe(0);
  });

  it("halves a tied match, which is what makes the scoreline read as golf", () => {
    // "3½ – 2½" is a number a golfer reads without translating, and it is the
    // reason a COUNT is still allowed to be fractional here.
    const t = matchesWonByTeam([row({ margin: 0, remaining: 0 })]);
    expect(t.get("A")).toBe(0.5);
    expect(t.get("B")).toBe(0.5);
  });

  it("credits the opponent of a side that is on nobody's team", () => {
    /**
     * The win comes from the GAME, not from the loser's roster. A person paired
     * but no longer on either team scores nowhere — their opponent still takes
     * the match, and the tally simply has one fewer contributor.
     */
    const t = matchesWonByTeam([row({ aTeamId: null, margin: -4 })]);
    expect(t.get("B")).toBe(1);
    expect([...t.keys()]).toEqual(["B"]);
  });

  it("adds across matches, and leaves a team with nothing OUT of the map", () => {
    /**
     * Absent rather than zero, so the caller can tell "has not won one yet"
     * from "is not in this game at all" — and renders its own zero if that is
     * what it wants to say.
     */
    const t = matchesWonByTeam([
      row({ margin: 3 }),
      row({ margin: 7 }),
      row({ margin: 1, remaining: 2 }),
    ]);
    expect(t.get("A")).toBe(2);
    expect(t.has("B")).toBe(false);
  });

  it("is a COUNT, so it does not depend on what the game is worth", () => {
    /**
     * The version this replaced multiplied by the shared divisor and returned
     * cup points, which rendered "0 – 2.57" on a 6-point game over 7 matches —
     * 18/7, an artifact of the divisor rather than a number anybody thinks in.
     *
     * The points are this × `liveMatchPointsPerMatch`, composed at whatever
     * surface needs them, so there is no bespoke payment maths here for a
     * future finalize to disagree with.
     */
    const rows = [row({ margin: 3 }), row({ margin: -1 })];
    const t = matchesWonByTeam(rows);
    expect(t.get("A")).toBe(1);
    expect(t.get("B")).toBe(1);
    // Whole numbers out of an uneven pool — the whole point of the change.
    expect([...t.values()].every(Number.isInteger)).toBe(true);
  });
});
