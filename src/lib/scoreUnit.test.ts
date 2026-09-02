import { describe, it, expect } from "vitest";
import { memberCanScoreUnit, memberCanScoreMatch, type ScoreUnitMatch } from "./scoreUnit";

// The MEMBER tier only — owner/co-admin/delegate bypass this via canEditGame.
// Covers each format × in-unit / out-of-unit / non-participant.

const userSide = (id: string) => ({ type: "user" as const, id });
const pgSide = (id: string) => ({ type: "play_group" as const, id });

describe("memberCanScoreUnit — stroke (unit = the individual)", () => {
  const base = { matches: [] as ScoreUnitMatch[], myPlayGroupId: null, targetPlayGroupId: null, groupScoped: false };

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

  it("GROUPED stroke players do NOT cross-score — a shared play_group is ignored (089/groupScoped=false)", () => {
    // Since stroke groupings are mandatory now, two stroke players share a play_group. But
    // stroke's unit stays the INDIVIDUAL: u1 (grouped with u2) still can't score u2's row.
    expect(
      memberCanScoreUnit({ matches: [], meId: "u1", participantId: "u2", participantType: "user", myPlayGroupId: "g1", targetPlayGroupId: "g1", meIsParticipant: true, groupScoped: false }),
    ).toBe(false);
    // ...but still scores their OWN row within that group.
    expect(
      memberCanScoreUnit({ matches: [], meId: "u1", participantId: "u1", participantType: "user", myPlayGroupId: "g1", targetPlayGroupId: "g1", meIsParticipant: true, groupScoped: false }),
    ).toBe(true);
  });
});

describe("memberCanScoreUnit — 1v1 match (unit = the match's two players)", () => {
  // Two separate 1v1 matches (a cart, but no data link between them).
  const matches: ScoreUnitMatch[] = [
    { side_a: userSide("u1"), side_b: userSide("u2") }, // my match
    { side_a: userSide("u3"), side_b: userSide("u4") }, // cart-mate's match
  ];
  const base = { matches, myPlayGroupId: null, targetPlayGroupId: null, meIsParticipant: true, groupScoped: false };

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
  // Rack has no game_matches; grouping is via play_group_id. groupScoped=true (cart-scoped).
  const base = { matches: [] as ScoreUnitMatch[], groupScoped: true };

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
  const base = { matches, targetPlayGroupId: null, meIsParticipant: true, groupScoped: false };

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

// ── memberCanScoreMatch — the CLIENT entry point, on a MIXED game ────────────
//
// The regression this pins (prod, BBMI 2023 "Singles"): a game holding six 1v1
// matches AND one 2v2 match. The view branched on a GAME-level `sided` flag
// derived as `matches.some(side is a play_group)` — true for the whole game
// because of the one doubles match — and then looked the 1v1 matches' USER ids
// up in a map keyed by play_group id. Both sides missed, `inThisMatch` was
// false, and a member opening their own singles match got the read-only
// scorecard with no entry surface at all. The server would have accepted it.
//
// So the cases that matter are the SINGLES ones inside a mixed game: every
// assertion marked "the regression" passes under a per-side discriminator and
// fails under a game-level one. The doubles case is here because it is what the
// old code got right — a fix that breaks it has traded one bug for another.
describe("memberCanScoreMatch — MIXED game (1v1 and 2v2 matches in one game)", () => {
  // m1: 1v1 u1 vs u2   m2: 1v1 u3 vs u4   m3: 2v2 ga(u5,u6) vs gb(u7,u8)
  const matches: ScoreUnitMatch[] = [
    { side_a: userSide("u1"), side_b: userSide("u2") },
    { side_a: userSide("u3"), side_b: userSide("u4") },
    { side_a: pgSide("ga"), side_b: pgSide("gb") },
  ];
  // Keyed by play_group id — NOT by user id. This is the map the old code
  // wrongly consulted for the 1v1 sides.
  const membersOfSide = new Map<string, string[]>([
    ["ga", ["u5", "u6"]],
    ["gb", ["u7", "u8"]],
  ]);
  const base = { matches, membersOfSide, myPlayGroupId: null, meIsParticipant: true };

  it("the regression: a 1v1 player CAN score their own singles match", () => {
    expect(memberCanScoreMatch({ ...base, meId: "u2", sideAId: "u1", sideBId: "u2" })).toBe(true);
  });

  it("the regression: a 1v1 player CAN score their opponent (one card per match)", () => {
    expect(memberCanScoreMatch({ ...base, meId: "u1", sideAId: "u1", sideBId: "u2" })).toBe(true);
  });

  it("a 1v1 player still CANNOT score the OTHER singles match", () => {
    expect(memberCanScoreMatch({ ...base, meId: "u1", sideAId: "u3", sideBId: "u4" })).toBe(false);
  });

  it("a 1v1 player still CANNOT score the doubles match in the same game", () => {
    expect(memberCanScoreMatch({ ...base, meId: "u1", sideAId: "ga", sideBId: "gb" })).toBe(false);
  });

  it("a 2v2 player CAN score their doubles match (what the old code got right)", () => {
    expect(
      memberCanScoreMatch({ ...base, meId: "u5", sideAId: "ga", sideBId: "gb", myPlayGroupId: "ga" }),
    ).toBe(true);
  });

  it("a 2v2 player CANNOT score a singles match they are not in", () => {
    expect(
      memberCanScoreMatch({ ...base, meId: "u5", sideAId: "u1", sideBId: "u2", myPlayGroupId: "ga" }),
    ).toBe(false);
  });

  it("a non-participant cannot score anything", () => {
    expect(
      memberCanScoreMatch({ ...base, meId: "u9", sideAId: "u1", sideBId: "u2", meIsParticipant: false }),
    ).toBe(false);
  });

  it("no viewer id → no access (a signed-out / unresolved reader never scores)", () => {
    expect(memberCanScoreMatch({ ...base, meId: null, sideAId: "u1", sideBId: "u2" })).toBe(false);
  });

  it("an unpaired match (both sides empty) authorizes nobody", () => {
    expect(memberCanScoreMatch({ ...base, meId: "u1", sideAId: null, sideBId: null })).toBe(false);
  });

  it("side A empty falls through to side B — either side resolves the same unit", () => {
    expect(memberCanScoreMatch({ ...base, meId: "u1", sideAId: null, sideBId: "u2" })).toBe(true);
  });
});

// A PURE 1v1 game and a PURE 2v2 game both worked before this fix — the bug
// needed the mixture. Pinned so the per-side discriminator is checked on the
// shapes it must not regress, not only on the shape that was broken.
describe("memberCanScoreMatch — unmixed games still resolve", () => {
  it("pure 1v1: a player scores their match", () => {
    const matches: ScoreUnitMatch[] = [{ side_a: userSide("u1"), side_b: userSide("u2") }];
    expect(
      memberCanScoreMatch({
        meId: "u1", sideAId: "u1", sideBId: "u2",
        matches, membersOfSide: new Map(), myPlayGroupId: null, meIsParticipant: true,
      }),
    ).toBe(true);
  });

  it("pure 2v2: a side member scores their match", () => {
    const matches: ScoreUnitMatch[] = [{ side_a: pgSide("ga"), side_b: pgSide("gb") }];
    expect(
      memberCanScoreMatch({
        meId: "u5", sideAId: "ga", sideBId: "gb",
        matches, membersOfSide: new Map([["ga", ["u5"]], ["gb", ["u7"]]]),
        myPlayGroupId: "ga", meIsParticipant: true,
      }),
    ).toBe(true);
  });
});
