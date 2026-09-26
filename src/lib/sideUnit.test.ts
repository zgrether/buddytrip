import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { sideUnit, playGroupUnits, splitSideRefusal } from "@/lib/sideUnit";
import { pairingShape, slotPool } from "@/lib/pairingShape";

/**
 * PR 5: a match side is paid as ONE unit, answered once for the finalize, the
 * board projection and both game pages — and a side spanning units is refused,
 * temporarily, until split payouts exist.
 */

const TEAM: Record<string, string> = { ann: "blue", bob: "blue", cat: "red", dan: "green" };
const teamOf = (id: string) => TEAM[id];
const nameOf = (id: string) => id[0].toUpperCase() + id.slice(1);

describe("sideUnit — one unit, or none", () => {
  it("a 1v1 side is its player's team", () => {
    expect(sideUnit(["cat"], teamOf)).toBe("red");
  });

  it("a pair on one team is that team", () => {
    expect(sideUnit(["ann", "bob"], teamOf)).toBe("blue");
  });

  it("a pair across two teams is NO unit — not whichever partner came first", () => {
    // The four copies this replaced took the first member (or the first row with
    // a team) and would have said "blue" here, or "red" with the order flipped.
    expect(sideUnit(["ann", "cat"], teamOf)).toBeNull();
    expect(sideUnit(["cat", "ann"], teamOf)).toBeNull();
  });

  it("a pair with an unteamed member is no unit — that member would be a unit of their own", () => {
    expect(sideUnit(["ann", "zed"], teamOf)).toBeNull();
    expect(sideUnit(["zed", "ann"], teamOf)).toBeNull();
  });

  it("an unteamed single player and an empty side are no unit", () => {
    expect(sideUnit(["zed"], teamOf)).toBeNull();
    expect(sideUnit([], teamOf)).toBeNull();
  });
});

describe("playGroupUnits — the participant-row form both servers read", () => {
  it("resolves each group from ALL its members, not its first row", () => {
    const units = playGroupUnits(
      [
        { user_id: "ann", play_group_id: "g1" },
        { user_id: "bob", play_group_id: "g1" },
        { user_id: "ann", play_group_id: null }, // not in a group — ignored
        { user_id: "cat", play_group_id: "g2" },
        { user_id: "bob", play_group_id: "g2" },
      ],
      teamOf,
    );
    expect(units.get("g1")).toBe("blue");
    expect(units.get("g2")).toBeNull(); // red + blue — split
  });
});

describe("splitSideRefusal — the temporary structural rule, in words", () => {
  it("names the players and the condition that lifts it", () => {
    expect(splitSideRefusal([["cat"], ["ann", "cat"]], teamOf, nameOf)).toBe(
      "Ann and Cat aren't on the same team. Until split payouts are supported, each side of a match has to be one team's players — pair teammates, or play them as singles.",
    );
  });

  it("refuses a teamed + unteamed pair too", () => {
    expect(splitSideRefusal([["ann", "zed"]], teamOf, nameOf)).toContain("Ann and Zed aren't on the same team");
  });

  it("admits teammates, single players (teamed or not), and same-team OPPONENTS", () => {
    // Ruling 10 is about who plays whom: two blue pairs meeting is allowed, and
    // pays blue. This rule is only about the side that gets paid.
    expect(splitSideRefusal([["ann", "bob"], ["cat"], ["zed"], ["ann"], ["bob"]], teamOf, nameOf)).toBeNull();
  });
});

describe("pairingShape — binding keys on the cup type, identity on being in a cup", () => {
  it("a Match Play cup binds sides to its two teams", () => {
    expect(pairingShape(true, "match_play", 2)).toEqual({ headToHead: true, inCup: true });
  });

  it("a TWO-team points race binds nothing — the case the team-count gate got wrong", () => {
    expect(pairingShape(true, "points", 2)).toEqual({ headToHead: false, inCup: true });
  });

  it("a three-team points race binds nothing and keeps team identity", () => {
    expect(pairingShape(true, "points", 3)).toEqual({ headToHead: false, inCup: true });
  });

  it("a standalone game has neither, and a loading cup does not bind", () => {
    expect(pairingShape(false, undefined, 0)).toEqual({ headToHead: false, inCup: false });
    expect(pairingShape(true, undefined, 2)).toEqual({ headToHead: false, inCup: true });
  });
});

describe("slotPool — who a side's picker offers", () => {
  const ROSTER = new Map<string, string[]>([
    ["blue", ["ann", "bob"]],
    ["red", ["cat"]],
    ["green", ["dan"]],
  ]);

  it("a points race offers everyone rostered on EITHER side, team 3 included", () => {
    expect(slotPool(false, ["blue", "red", "green"], ROSTER, "a")).toEqual(["ann", "bob", "cat", "dan"]);
    expect(slotPool(false, ["blue", "red", "green"], ROSTER, "b")).toEqual(["ann", "bob", "cat", "dan"]);
  });

  it("a Match Play cup offers each side only its own team", () => {
    expect(slotPool(true, ["blue", "red"], ROSTER, "a")).toEqual(["ann", "bob"]);
    expect(slotPool(true, ["blue", "red"], ROSTER, "b")).toEqual(["cat"]);
  });
});

/** The pickers take their shape from these, not from a team count. */
describe("both pairing pages ask the cup type, not the team count", () => {
  it("the golf page uses pairingShape and keeps no count-keyed gate", () => {
    const src = readFileSync(resolve(__dirname, "../components/games/MatchGameView.tsx"), "utf8");
    expect(src).toContain("pairingShape(");
    expect(src).not.toContain("const twoTeams = !!gameCompId && teams.length === 2;");
  });

  it("the non-golf builder uses slotPool and no longer takes the first two teams", () => {
    const src = readFileSync(resolve(__dirname, "../components/games/MatchesBuilder.tsx"), "utf8");
    expect(src).toContain("slotPool(");
    expect(src).not.toContain("const [a, b] = teams;");
  });
});

/**
 * Every surface resolves a pair through the shared rule. A SOURCE check, and
 * stated as one: the copies it replaced agreed on every pair the app could
 * write in a Match Play cup, so no behavioural test there separates them — what
 * this prevents is a fifth private copy, the way the fifth one here turned up
 * in `liveProjection` after four were already known.
 */
// [file, the shared call it must make, the private copy it must not keep]
const RESOLVERS = {
  finalize: ["../server/lib/matchAwards.ts", "playGroupUnits(", "pgTeam.has(pg)"],
  "board projection": ["../server/lib/liveProjection.ts", "playGroupUnits(", "pgTeam.has(p.play_group_id)"],
  "golf game page": ["../components/games/MatchGameView.tsx", "sideUnit(", "(membersOfSide.get(sideId) ?? [])[0]"],
  "non-golf game page": ["../components/games/NonGolfGameView.tsx", "sideUnit(", "const first = members[0];"],
} as const;

describe("every pair resolver uses the shared rule", () => {
  it.each(Object.entries(RESOLVERS))("%s calls it", (_name, [rel, call]) => {
    expect(readFileSync(resolve(__dirname, rel), "utf8")).toContain(call);
  });

  // Each file's OWN old copy, verbatim — a pattern the file could actually have
  // contained, so the negative can fail (a shared pattern would be vacuous for
  // the files whose copy was written differently).
  it.each(Object.entries(RESOLVERS))("%s keeps no first-member pair map", (_name, [rel, , oldCopy]) => {
    expect(readFileSync(resolve(__dirname, rel), "utf8")).not.toContain(oldCopy);
  });
});
