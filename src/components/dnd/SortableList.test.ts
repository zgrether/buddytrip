import { describe, it, expect } from "vitest";
import { reorderOnDrop } from "./SortableList";

// The shared touch-aware reorder primitive's drop math. Every reorder surface
// (match builder, crew roster, …) routes its @dnd-kit drag-end through this, so
// the contract is pinned here once rather than per surface.

describe("reorderOnDrop", () => {
  const ids = ["a", "b", "c", "d"];

  it("moves the active id to the over id's position (forward)", () => {
    expect(reorderOnDrop(ids, "a", "c")).toEqual(["b", "c", "a", "d"]);
  });

  it("moves the active id to the over id's position (backward)", () => {
    expect(reorderOnDrop(ids, "d", "b")).toEqual(["a", "d", "b", "c"]);
  });

  it("is a no-op (null) when dropped on itself", () => {
    expect(reorderOnDrop(ids, "b", "b")).toBeNull();
  });

  it("is a no-op (null) when dropped off any target", () => {
    expect(reorderOnDrop(ids, "b", null)).toBeNull();
    expect(reorderOnDrop(ids, "b", undefined)).toBeNull();
  });

  it("is a no-op (null) when an id is unknown (stale drag)", () => {
    expect(reorderOnDrop(ids, "z", "b")).toBeNull();
    expect(reorderOnDrop(ids, "b", "z")).toBeNull();
  });

  it("does not mutate the input order", () => {
    const input = ["a", "b", "c"];
    reorderOnDrop(input, "a", "c");
    expect(input).toEqual(["a", "b", "c"]);
  });
});
