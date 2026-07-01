import { describe, it, expect } from "vitest";
import { addGroup, removeGroup, assignPlayer, removePlayer, assignedIds, toPersist, MAX_GROUPS } from "./rackGroupDraft";

// The manual rack group-builder rules: any 1–4 mix per group, each player in at
// most one group, empty groups droppable, and the persist shape for setFoursomes.

describe("rackGroupDraft", () => {
  it("adds and removes groups", () => {
    expect(addGroup([])).toEqual([[]]);
    expect(addGroup([["a"]])).toEqual([["a"], []]);
    expect(removeGroup([["a"], ["b"]], 0)).toEqual([["b"]]);
  });

  it("caps the number of groups at MAX_GROUPS", () => {
    const full = Array.from({ length: MAX_GROUPS }, () => [] as string[]);
    expect(addGroup(full)).toBe(full); // unchanged at the cap
  });

  it("assigns a player and keeps them in at most one group (a move, not a copy)", () => {
    let g: string[][] = [[], []];
    g = assignPlayer(g, 0, "alice"); // → group 0
    expect(g).toEqual([["alice"], []]);
    g = assignPlayer(g, 1, "alice"); // moving alice to group 1 vacates group 0
    expect(g).toEqual([[], ["alice"]]);
  });

  it("allows any mix from either team — no forced 2+2", () => {
    let g: string[][] = [[]];
    g = assignPlayer(g, 0, "a1");
    g = assignPlayer(g, 0, "a2");
    g = assignPlayer(g, 0, "b1"); // 2 from A + 1 from B in one group is fine
    expect(g).toEqual([["a1", "a2", "b1"]]);
  });

  it("refuses a 5th player (max 4 per group) — draft unchanged", () => {
    const four = [["a", "b", "c", "d"]];
    expect(assignPlayer(four, 0, "e")).toBe(four);
  });

  it("removes a player back to the pool", () => {
    expect(removePlayer([["a", "b"]], 0, "a")).toEqual([["b"]]);
  });

  it("assignedIds is everyone currently grouped (the picker excludes them)", () => {
    expect(assignedIds([["a", "b"], ["c"]])).toEqual(new Set(["a", "b", "c"]));
    expect(assignedIds([[], []])).toEqual(new Set());
  });

  it("toPersist drops empty groups and renumbers the survivors 1..N", () => {
    expect(toPersist([["a"], [], ["b", "c"]])).toEqual([
      { name: "Group 1", userIds: ["a"] },
      { name: "Group 2", userIds: ["b", "c"] },
    ]);
    expect(toPersist([[], []])).toEqual([]); // the valid empty state
  });
});
