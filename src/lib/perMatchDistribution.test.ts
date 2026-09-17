import { describe, it, expect } from "vitest";
import { awardsPerMatch, projectableMatchShare } from "./pointsDistribution";
import { configToNonGolfDraft, nonGolfDraftToPayload, type NonGolfConfigDraft, type DraftMatchConfig } from "./configDraft";

/**
 * #1381 — a game that pays MATCH BY MATCH cannot carry a placement split, and a
 * game with nothing to divide must not project a division of nothing.
 *
 * The server refusals and the leaderboard's reconciliation are tested where they
 * live (`games.saveConfig.perMatchSplit.test.ts`,
 * `competitionLeaderboard.convention.test.ts`). This file pins the three pure
 * pieces everything else leans on: which games pay per match, when a share
 * cannot be known, and what the Matches payload saves.
 */

describe("awardsPerMatch — the games a split can never describe", () => {
  it("golf match play and non-golf Matches pay per match", () => {
    expect(awardsPerMatch("gtt_match_play")).toBe(true);
    expect(awardsPerMatch("gtt_generic_yard", "matches")).toBe(true);
    expect(awardsPerMatch("gtt_generic_card", "matches")).toBe(true);
  });

  it("the same non-golf type under any OTHER format does not", () => {
    expect(awardsPerMatch("gtt_generic_yard", null)).toBe(false);
    expect(awardsPerMatch("gtt_generic_yard", "head_to_head")).toBe(false);
    expect(awardsPerMatch("gtt_generic_yard", "bracket")).toBe(false);
  });

  it("pick'em and rack are NOT in it, although both divide by rows — a different question", () => {
    expect(awardsPerMatch("gtt_pickem")).toBe(false);
    expect(awardsPerMatch("gtt_rack_n_stack")).toBe(false);
    expect(awardsPerMatch("gtt_stroke_play")).toBe(false);
    expect(awardsPerMatch(null)).toBe(false);
  });
});

describe("projectableMatchShare — cannot project is not zero", () => {
  const paired = (pointValue: number | null = null) => ({ sideAId: "a", sideBId: "b", pointValue });

  it("with a total it is the even share, whatever the distribution's shape was", () => {
    expect(projectableMatchShare(8, [paired(), paired(), paired(), paired()], null)).toBe(2);
  });

  it("with only a legacy per-match value it is that value", () => {
    expect(projectableMatchShare(null, [paired()], 3)).toBe(3);
  });

  it("with NOTHING to divide it is null — the case that used to read 0-0 as 'not started'", () => {
    expect(projectableMatchShare(null, [paired(), paired()], null)).toBeNull();
  });

  it("an override on an assigned match is something to pay, so it projects", () => {
    expect(projectableMatchShare(null, [paired(4), paired()], null)).toBe(0);
  });

  it("an override on an UNPAIRED slot is not a match, so it does not count", () => {
    expect(projectableMatchShare(null, [{ sideAId: "a", sideBId: null, pointValue: 4 }], null)).toBeNull();
  });
});

describe("nonGolfDraftToPayload — a Matches game always saves per_match", () => {
  const match = (n: number): DraftMatchConfig => ({
    matchNumber: n, playersPerSide: 1, a: [`a${n}`], b: [`b${n}`], handicap: 0, pointValue: null,
  });
  const draft = (over: Partial<NonGolfConfigDraft>): NonGolfConfigDraft => ({
    ...configToNonGolfDraft({ name: "Cornhole", competition_format: "matches" }, []),
    competitionFormat: "matches",
    matches: [match(1), match(2), match(3), match(4)],
    pointsTotal: 8,
    ...over,
  });

  it("THE CORNHOLE CASE: an authored placement [8] is replaced by the per-match share", () => {
    const p = nonGolfDraftToPayload(draft({ pointsDistribution: { type: "placement", values: [8] } }));
    expect(p.pointsDistribution).toEqual({ type: "per_match", value: 2 });
  });

  it("a null distribution is minted, as before", () => {
    const p = nonGolfDraftToPayload(draft({ pointsDistribution: null }));
    expect(p.pointsDistribution).toEqual({ type: "per_match", value: 2 });
  });

  it("with no total a stale split is DROPPED, not kept — there is nothing to mint from", () => {
    const p = nonGolfDraftToPayload(draft({ pointsTotal: null, pointsDistribution: { type: "placement", values: [8] } }));
    expect(p.pointsDistribution).toBeNull();
  });

  it("outside Matches a placement is a real split and is left alone", () => {
    const p = nonGolfDraftToPayload(
      draft({ competitionFormat: null, matches: [], pointsDistribution: { type: "placement", values: [5, 3] } })
    );
    expect(p.pointsDistribution).toEqual({ type: "placement", values: [5, 3] });
  });
});
