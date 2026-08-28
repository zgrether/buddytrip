import { describe, it, expect } from "vitest";
import { matchPointsByTeam, type MatchTallyRow } from "./pickemBoard";

/**
 * The cup tally — what each team has BANKED from the matches so far.
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

describe("matchPointsByTeam", () => {
  it("pays the leader of a FINISHED match", () => {
    const t = matchPointsByTeam([row({ margin: 5 })], 2);
    expect(t.get("A")).toBe(2);
    expect(t.get("B")).toBeUndefined();
  });

  it("pays a CLINCHED match too — the winner can no longer change", () => {
    /**
     * The decisive case, and the reason the predicate is two conditions rather
     * than one. `matchStanding` reports `clinched: false` once nothing is left —
     * a finished match is DECIDED, not clinched — so a tally asking only about
     * `clinched` would drop every completed match, and one asking only about
     * `remaining === 0` would sit at zero all Saturday and jump at the end.
     */
    const t = matchPointsByTeam([row({ margin: -9, remaining: 4, clinched: true })], 2);
    expect(t.get("B")).toBe(2);
  });

  it("counts nothing for a match still in the balance", () => {
    // Banked, not projected. A leader who can still be caught has earned
    // nothing yet, and a figure labelled as points must not say otherwise.
    const t = matchPointsByTeam([row({ margin: 9, remaining: 4, clinched: false })], 2);
    expect(t.size).toBe(0);
  });

  it("splits a halved match", () => {
    const t = matchPointsByTeam([row({ margin: 0, remaining: 0 })], 3);
    expect(t.get("A")).toBe(1.5);
    expect(t.get("B")).toBe(1.5);
  });

  it("pays the opponent of a side that is on nobody's team", () => {
    /**
     * The points come from the GAME, not from the loser. A person paired but no
     * longer on either roster scores nowhere — their opponent still banks the
     * match, and the tally simply has one fewer contributor.
     */
    const t = matchPointsByTeam([row({ aTeamId: null, margin: -4 })], 2);
    expect(t.get("B")).toBe(2);
    expect(t.has("null")).toBe(false);
    expect([...t.keys()]).toEqual(["B"]);
  });

  it("adds across matches, and leaves a team with nothing OUT of the map", () => {
    /**
     * Absent rather than zero, so the caller can tell "has not won one yet"
     * from "is not in this game at all" — and renders its own zero if that is
     * what it wants to say.
     */
    const t = matchPointsByTeam(
      [row({ margin: 3 }), row({ margin: 7 }), row({ margin: 1, remaining: 2 })],
      1
    );
    expect(t.get("A")).toBe(2);
    expect(t.has("B")).toBe(false);
  });
});
