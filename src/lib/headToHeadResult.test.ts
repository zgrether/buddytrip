import { describe, it, expect } from "vitest";
import { GAME_TYPE_DEFINITIONS } from "@/lib/gameTypes";
import { resultKindInHeadToHead, headToHeadResultRefusal } from "@/lib/headToHeadResult";

/**
 * Ruling 2 (PR 4) in PR 1's terms: a head-to-head cup accepts games whose result
 * is head to head. The cases are derived from the CATALOG where they can be, so
 * a format added tomorrow is judged by the kinds it declares rather than by
 * whether somebody remembered to add a row here.
 */

const TWO_KIND = Object.values(GAME_TYPE_DEFINITIONS).filter((d) => d.resultKinds.length === 2);
const RANKED_ONLY = Object.values(GAME_TYPE_DEFINITIONS).filter(
  (d) => d.resultKinds.length === 1 && d.resultKinds[0] === "ranked",
);
const H2H_ONLY = Object.values(GAME_TYPE_DEFINITIONS).filter(
  (d) => d.resultKinds.length === 1 && d.resultKinds[0] === "head_to_head",
);

describe("resultKindInHeadToHead — what a configuration produces between two teams", () => {
  it("the catalog has each shape this reads, so no loop below is vacuous", () => {
    expect(TWO_KIND.length).toBeGreaterThan(0);
    expect(RANKED_ONLY.length).toBeGreaterThan(0);
    expect(H2H_ONLY.length).toBeGreaterThan(0);
  });

  it.each(RANKED_ONLY.map((d) => [d.id]))("%s declares only ranked — ranked, whatever the configuration", (id) => {
    expect(resultKindInHeadToHead(id, null)).toBe("ranked");
  });

  it.each(H2H_ONLY.map((d) => [d.id]))("%s declares only head to head — head to head", (id) => {
    expect(resultKindInHeadToHead(id, null)).toBe("head_to_head");
  });

  it("a two-kind non-golf format as a BRACKET is ranked — a field run down to a champion, paid by place", () => {
    expect(resultKindInHeadToHead("gtt_generic_card", "bracket")).toBe("ranked");
  });

  // Simple is head to head HERE because the container has two teams — the same
  // setup in a three-team points race pays by placement, which is why the
  // function is named for its container.
  it.each([
    ["Simple, never set", null],
    ["Simple, chosen", "head_to_head"],
    ["Matches", "matches"],
    ["Best of N", "best_of_n"],
    ["a legacy bracket value, which runs as a manual result", "bracket_se"],
  ])("a two-kind non-golf format as %s is head to head between two teams", (_label, format) => {
    expect(resultKindInHeadToHead("gtt_generic_card", format)).toBe("head_to_head");
  });

  it("pick'em is head to head between two teams, whichever roll-up it uses", () => {
    expect(resultKindInHeadToHead("gtt_pickem", null)).toBe("head_to_head");
  });

  it("an unregistered format is not answered", () => {
    expect(resultKindInHeadToHead("gtt_nope", "bracket")).toBeUndefined();
  });
});

describe("headToHeadResultRefusal — the one sentence the picker and the server share", () => {
  it("refuses a bracket, naming what to do instead", () => {
    expect(headToHeadResultRefusal("gtt_generic_card", "bracket")).toBe(
      "A Match Play cup is head to head, and a bracket pays by placement. Choose Simple or Matches for this game, or run the bracket in a points cup.",
    );
  });

  it.each(TWO_KIND.map((d) => [d.id]))("%s as a bracket is refused iff it can run as one", (id) => {
    // Engine formats (pick'em) never resolve to the bracket engine, so a
    // `bracket` format string on one is not a bracket and not refused.
    const refusal = headToHeadResultRefusal(id, "bracket");
    const isBracketCapable = GAME_TYPE_DEFINITIONS[id].resultStrategy === null;
    expect(refusal !== null).toBe(isBracketCapable);
  });

  it.each(RANKED_ONLY.map((d) => [d.id, d.name]))("%s is refused by name", (id, name) => {
    expect(headToHeadResultRefusal(id, null)).toBe(
      `A Match Play cup is head to head, and ${name} pays by placement. Choose a format that decides a winner between the two teams.`,
    );
  });

  it.each([null, "head_to_head", "matches", "best_of_n"])("admits %s on a non-golf format", (format) => {
    expect(headToHeadResultRefusal("gtt_generic_card", format)).toBeNull();
  });
});
