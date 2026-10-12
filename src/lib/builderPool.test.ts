import { describe, it, expect } from "vitest";
import { builderAddTargets, builderPool, notOnATeamIds, pairsFromRosters, type BuilderTeam } from "./builderPool";

const RED: BuilderTeam = { id: "red", name: "Red", color: "#ef4444" };
const BLUE: BuilderTeam = { id: "blue", name: "Blue", color: "#3b82f6" };
const GREEN: BuilderTeam = { id: "green", name: "Green", color: "#22c55e" };
const CREW = ["ann", "bob", "cat", "dan"];

describe("pairsFromRosters — a cup with teams, and nothing else", () => {
  it("a side game does not", () => expect(pairsFromRosters({ inCup: false, teamCount: 0 })).toBe(false));
  it("a teamless race does not — its units are people", () =>
    expect(pairsFromRosters({ inCup: true, teamCount: 0 })).toBe(false));
  it("a cup with teams does, even with nobody assigned", () =>
    expect(pairsFromRosters({ inCup: true, teamCount: 2 })).toBe(true));
});

describe("builderPool — the zero-assignments fallback is gone", () => {
  const rosters: Record<string, string[]> = { red: [], blue: [] };
  const base = { rosterOfTeam: (t: string) => rosters[t] ?? [], rosterIds: [] as string[], crewIds: CREW };

  /**
   * THE BUG: a cup with teams and no assignments used to offer the whole crew,
   * which a Match Play cup then refused one by one. The pool is the (empty)
   * roster now; the crew appears under "Not on a team" instead.
   */
  it("a cup with teams and NO assignments offers nobody — not the crew", () => {
    expect(builderPool({ ...base, rostersApply: true })).toEqual([]);
    expect(builderPool({ ...base, rostersApply: true, slotTeamId: "red" })).toEqual([]);
  });

  it("a side game or a teamless race offers the whole crew, by design", () => {
    expect(builderPool({ ...base, rostersApply: false })).toEqual(CREW);
  });

  it("head to head offers the slot's own team", () => {
    expect(builderPool({ ...base, rosterOfTeam: (t) => (t === "red" ? ["ann"] : ["bob"]), rostersApply: true, slotTeamId: "blue" })).toEqual(["bob"]);
  });
});

describe("notOnATeamIds", () => {
  const teamOf = (id: string) => ({ ann: "red", bob: "blue" } as Record<string, string>)[id];
  it("lists the crew on no team of this cup", () => {
    expect(notOnATeamIds({ rostersApply: true, crewIds: CREW, teamOf })).toEqual(["cat", "dan"]);
  });
  it("is EMPTY where there is no team to be not on", () => {
    expect(notOnATeamIds({ rostersApply: false, crewIds: CREW, teamOf })).toEqual([]);
  });
});

describe("builderAddTargets — whoever the server allows, by a path it accepts", () => {
  const none = () => false;
  const base = { teams: [RED, BLUE, GREEN], staff: false, captainOf: none, hasResults: false, previewAvailable: true };

  it("Owner and Organizers may add to any team", () => {
    expect(builderAddTargets({ ...base, staff: true }).map((t) => t.id)).toEqual(["red", "blue", "green"]);
  });

  it("head to head, only the slot's own team — even for staff", () => {
    expect(builderAddTargets({ ...base, staff: true, slotTeamId: "blue" }).map((t) => t.id)).toEqual(["blue"]);
  });

  it("a captain, their own team only", () => {
    expect(builderAddTargets({ ...base, captainOf: (t) => t === "green" }).map((t) => t.id)).toEqual(["green"]);
  });

  it("a captain of the OTHER team gets nothing from this side's picker", () => {
    expect(builderAddTargets({ ...base, slotTeamId: "red", captainOf: (t) => t === "blue" })).toEqual([]);
  });

  it("anyone else — a delegate, a member — gets nothing", () => {
    expect(builderAddTargets(base)).toEqual([]);
  });

  it("after results a captain gets nothing (the server's lock)", () => {
    expect(builderAddTargets({ ...base, hasResults: true, captainOf: (t) => t === "green" })).toEqual([]);
  });

  it("after results staff still add — through the preview", () => {
    expect(builderAddTargets({ ...base, staff: true, hasResults: true, slotTeamId: "red" }).map((t) => t.id)).toEqual(["red"]);
  });

  /** Never a bare add after results: without the preview mounted, no offer. */
  it("after results with NO preview mounted, staff get nothing", () => {
    expect(builderAddTargets({ ...base, staff: true, hasResults: true, previewAvailable: false })).toEqual([]);
  });

  it("before results the preview is irrelevant", () => {
    expect(builderAddTargets({ ...base, staff: true, previewAvailable: false }).map((t) => t.id)).toEqual(["red", "blue", "green"]);
  });
});
