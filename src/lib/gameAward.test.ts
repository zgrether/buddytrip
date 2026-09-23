import { describe, it, expect } from "vitest";
import { awardMatches, type AwardableMatch } from "./gameAward";
import { tallyMatchAwards, tallyMatchAwardsDetailed, type SideRef } from "./matchAwards";
import { rollupMatchPlay, rollupMatchPlayDetailed, type ProjMatch } from "./gameProjection";

/**
 * ONE AWARD DECISION — and the parity that proves it is one.
 *
 * The finalize and the projection used to answer "who gets this match's points"
 * separately. They agreed on every case anyone had written a test for, and
 * disagreed on one nobody had: a match with ONE unteamed side, where the
 * projection credited the side that had a team and the finalize paid nobody.
 *
 * So the test that matters here is not "the rule is right" — it is "there is
 * only one rule". The parity block below builds the SAME slate twice, once in
 * each caller's input shape, and asserts the two paths land on the same map.
 * That is the assertion the old code could not have passed.
 */

const A = "team-a";
const B = "team-b";

/** The finalize's shape: raw `game_matches` rows plus a side→team resolver. */
function finalizeSide(teamOf: Record<string, string>) {
  return (s: SideRef) => teamOf[s.id];
}

describe("the rule itself", () => {
  it("pays the winner, splits a halve, and skips what is not decided", () => {
    const m = (outcome: AwardableMatch["outcome"], value = 2): AwardableMatch => ({
      aTeamId: A, bTeamId: B, outcome, value,
    });
    expect(awardMatches([m("a")]).byTeam).toEqual({ [A]: 2 });
    expect(awardMatches([m("b")]).byTeam).toEqual({ [B]: 2 });
    expect(awardMatches([m("split")]).byTeam).toEqual({ [A]: 1, [B]: 1 });
    expect(awardMatches([m(null)]).byTeam).toEqual({});
  });

  it("uses each match's OWN value, so a counts-double match doubles", () => {
    const out = awardMatches([
      { aTeamId: A, bTeamId: B, outcome: "a", value: 2 },
      { aTeamId: A, bTeamId: B, outcome: "a", value: 4 },
    ]);
    // 6, not 4: a per-match override is not a multiplier applied afterwards.
    expect(out.byTeam).toEqual({ [A]: 6 });
  });

  it("pays NOBODY when a side has no cup team, and counts it as unpayable", () => {
    // The decisive case. Side A wins and is on a team; B is not on one. The old
    // projection paid A; the finalize paid nobody. Nobody is the rule.
    const out = awardMatches([{ aTeamId: A, bTeamId: null, outcome: "a", value: 2 }]);
    expect(out.byTeam).toEqual({});
    expect(out.unpayable).toBe(1);
  });

  it("separates 'paid nobody' from 'not played' — they are not the same fact", () => {
    // An undecided match is not a forfeit. A caller that folded these together
    // could not tell a game with nothing played from one whose points cannot
    // land, which is the distinction the board needs in order to say so.
    expect(awardMatches([{ aTeamId: A, bTeamId: null, outcome: null, value: 2 }]).unpayable).toBe(0);
    expect(awardMatches([{ aTeamId: null, bTeamId: null, outcome: "split", value: 2 }]).unpayable).toBe(1);
  });
});

describe("PARITY — the finalize and the projection reach the same map", () => {
  /** One slate, expressed both ways. `leader`/`started` is the projection's
   *  reading of the same match `result` the finalize records. */
  const SLATE = [
    { id: "m1", winner: "a" as const, value: 2 },
    { id: "m2", winner: "b" as const, value: 2 },
    { id: "m3", winner: "halve" as const, value: 4 },
  ];

  const finalizeRows = SLATE.map((m) => ({
    side_a: { type: "user", id: `${m.id}-a` },
    side_b: { type: "user", id: `${m.id}-b` },
    result: m.winner === "a" ? "a_win" : m.winner === "b" ? "b_win" : "halve",
    point_value: m.value,
  }));

  const projRows: ProjMatch[] = SLATE.map((m) => ({
    aTeamId: A,
    bTeamId: B,
    leader: m.winner === "a" ? "A" : m.winner === "b" ? "B" : null,
    started: true,
    points: m.value,
  }));

  const teamOf = Object.fromEntries(SLATE.flatMap((m) => [[`${m.id}-a`, A], [`${m.id}-b`, B]]));

  it("agrees on a fully teamed slate", () => {
    const fromFinalize = tallyMatchAwards(finalizeRows, finalizeSide(teamOf), 1);
    const fromProjection = rollupMatchPlay(projRows, 1);
    // 2 + 2 halved = A:4, B:4. Asserted as a value as well as a comparison, so
    // that two paths agreeing on the WRONG answer still fails.
    expect(fromFinalize).toEqual({ [A]: 4, [B]: 4 });
    expect(fromProjection).toEqual(fromFinalize);
  });

  it("agrees when a side has NO TEAM — the case they used to disagree on", () => {
    // m2's B side is unassigned. Old behaviour: the finalize dropped m2
    // entirely (A:2 from m1, +2 split from m3 → A:4, B:2); the projection paid
    // m2 to... nobody on B, but still credited A elsewhere, and on an a_win
    // with an unteamed opponent it credited the winner. The two maps differed.
    const holed = { ...teamOf, "m2-b": undefined as unknown as string };
    delete (holed as Record<string, string>)["m2-b"];

    const fromFinalize = tallyMatchAwardsDetailed(finalizeRows, finalizeSide(holed), 1);
    const fromProjection = rollupMatchPlayDetailed(
      projRows.map((p, i) => (i === 1 ? { ...p, bTeamId: null } : p)),
      1
    );
    expect(fromProjection.byTeam).toEqual(fromFinalize.byTeam);
    expect(fromProjection.unpayable).toBe(fromFinalize.unpayable);
    // And the exact values, so the parity cannot be satisfied by both returning
    // nothing: m1 pays A 2, m3 splits 4, m2 pays nobody.
    expect(fromFinalize.byTeam).toEqual({ [A]: 4, [B]: 2 });
    expect(fromFinalize.unpayable).toBe(1);
  });

  it("an UNPAIRED slot is not a forfeit — it is a match that does not exist yet", () => {
    // The finalize sees `side_b: null`. That must not be counted as a match
    // whose points cannot land, or a half-built game would report its empty
    // slots as forfeits and the board would say its points are unpayable.
    const withEmptySlot = [{ side_a: { type: "user", id: "x" }, side_b: null, result: null, point_value: 2 }];
    const out = tallyMatchAwardsDetailed(withEmptySlot, finalizeSide({ x: A }), 1);
    expect(out.byTeam).toEqual({});
    expect(out.unpayable).toBe(0);
  });
});
