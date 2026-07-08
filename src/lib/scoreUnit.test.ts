import { describe, it, expect } from "vitest";
import { memberCanScoreUnit, type ScoreUnitMatch } from "./scoreUnit";

// The MEMBER tier only — owner/co-admin/delegate bypass this via canEditGame.
// Covers each format × in-unit / out-of-unit / non-participant.

const userSide = (id: string) => ({ type: "user" as const, id });
const pgSide = (id: string) => ({ type: "play_group" as const, id });

describe("memberCanScoreUnit — stroke (unit = the individual)", () => {
  const base = { matches: [] as ScoreUnitMatch[], myPlayGroupId: null, targetPlayGroupId: null };

  it("a member scores their OWN row", () => {
    expect(
      memberCanScoreUnit({ ...base, meId: "u1", participantId: "u1", participantType: "user", meIsParticipant: true }),
    ).toBe(true);
  });

  it("a member CANNOT score another player's row", () => {
    expect(
      memberCanScoreUnit({ ...base, meId: "u1", participantId: "u2", participantType: "user", meIsParticipant: true }),
    ).toBe(false);
  });

  it("a non-participant cannot score even their own id", () => {
    expect(
      memberCanScoreUnit({ ...base, meId: "u1", participantId: "u1", participantType: "user", meIsParticipant: false }),
    ).toBe(false);
  });
});

describe("memberCanScoreUnit — 1v1 match (unit = the match's two players)", () => {
  // Two separate 1v1 matches (a cart, but no data link between them).
  const matches: ScoreUnitMatch[] = [
    { side_a: userSide("u1"), side_b: userSide("u2") }, // my match
    { side_a: userSide("u3"), side_b: userSide("u4") }, // cart-mate's match
  ];
  const base = { matches, myPlayGroupId: null, targetPlayGroupId: null, meIsParticipant: true };

  it("a player scores their OWN score in their match", () => {
    expect(memberCanScoreUnit({ ...base, meId: "u1", participantId: "u1", participantType: "user" })).toBe(true);
  });

  it("a player scores their OPPONENT in the same match (one card per match)", () => {
    expect(memberCanScoreUnit({ ...base, meId: "u1", participantId: "u2", participantType: "user" })).toBe(true);
  });

  it("DEFERRED: a player CANNOT score the other 1v1 match in the cart", () => {
    expect(memberCanScoreUnit({ ...base, meId: "u1", participantId: "u3", participantType: "user" })).toBe(false);
    expect(memberCanScoreUnit({ ...base, meId: "u1", participantId: "u4", participantType: "user" })).toBe(false);
  });

  it("a non-participant of any match cannot score", () => {
    expect(memberCanScoreUnit({ ...base, meId: "u9", participantId: "u1", participantType: "user" })).toBe(false);
  });
});

describe("memberCanScoreUnit — rack (unit = the play_group / cart)", () => {
  // Rack has no game_matches; grouping is via play_group_id.
  const base = { matches: [] as ScoreUnitMatch[] };

  it("a member scores a cart-mate in the SAME group", () => {
    expect(
      memberCanScoreUnit({ ...base, meId: "u1", participantId: "u2", participantType: "user", myPlayGroupId: "g1", targetPlayGroupId: "g1", meIsParticipant: true }),
    ).toBe(true);
  });

  it("a member scores their OWN row in their group", () => {
    expect(
      memberCanScoreUnit({ ...base, meId: "u1", participantId: "u1", participantType: "user", myPlayGroupId: "g1", targetPlayGroupId: "g1", meIsParticipant: true }),
    ).toBe(true);
  });

  it("a member CANNOT score a player in a DIFFERENT group", () => {
    expect(
      memberCanScoreUnit({ ...base, meId: "u1", participantId: "u3", participantType: "user", myPlayGroupId: "g1", targetPlayGroupId: "g2", meIsParticipant: true }),
    ).toBe(false);
  });

  it("a member with no group cannot score a grouped player", () => {
    expect(
      memberCanScoreUnit({ ...base, meId: "u9", participantId: "u2", participantType: "user", myPlayGroupId: null, targetPlayGroupId: "g1", meIsParticipant: false }),
    ).toBe(false);
  });
});

describe("memberCanScoreUnit — 2v2 match (unit = the match's two side groups)", () => {
  // side_a = group ga (u1,u2), side_b = group gb (u3,u4). Score entries are per side (play_group).
  const matches: ScoreUnitMatch[] = [
    { side_a: pgSide("ga"), side_b: pgSide("gb") },
    { side_a: pgSide("gc"), side_b: pgSide("gd") }, // another match
  ];
  const base = { matches, targetPlayGroupId: null, meIsParticipant: true };

  it("a member scores their OWN side", () => {
    expect(memberCanScoreUnit({ ...base, meId: "u1", participantId: "ga", participantType: "play_group", myPlayGroupId: "ga" })).toBe(true);
  });

  it("a member scores the OPPONENT side of their match (one card per match)", () => {
    expect(memberCanScoreUnit({ ...base, meId: "u1", participantId: "gb", participantType: "play_group", myPlayGroupId: "ga" })).toBe(true);
  });

  it("a member CANNOT score a side in a DIFFERENT match", () => {
    expect(memberCanScoreUnit({ ...base, meId: "u1", participantId: "gc", participantType: "play_group", myPlayGroupId: "ga" })).toBe(false);
  });

  it("a non-participant (no side group) cannot score", () => {
    expect(memberCanScoreUnit({ ...base, meId: "u9", participantId: "ga", participantType: "play_group", myPlayGroupId: null })).toBe(false);
  });

  it("an unknown play_group id is rejected", () => {
    expect(memberCanScoreUnit({ ...base, meId: "u1", participantId: "gZ", participantType: "play_group", myPlayGroupId: "ga" })).toBe(false);
  });
});
