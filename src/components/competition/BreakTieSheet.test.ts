import { describe, expect, it } from "vitest";
import { orderToSave } from "./BreakTieSheet";
import type { SharedTie } from "@/lib/needsAttention";

const tie = (place: number, ids: string[], ordered = false): SharedTie => ({ place, ordered, units: ids.map((id) => ({ id, name: id, shortName: null, color: null })) });

describe("what Save order saves (spec §5)", () => {
  const first = tie(1, ["a", "b"]);
  const third = tie(3, ["c", "d"]);
  const orders = { 1: ["b", "a"], 3: ["d", "c"] };

  it("one tie: the order on screen, moved or not, because tapping Save says so", () => {
    expect(orderToSave([first], { 1: ["a", "b"] }, new Set())).toEqual(["a", "b"]);
  });

  it("several ties: only the ones moved, since a tie left alone stays shared", () => {
    expect(orderToSave([first, third], orders, new Set([3]))).toEqual(["d", "c"]);
  });

  it("several ties, all moved: every one, best place first", () => {
    expect(orderToSave([first, third], orders, new Set([1, 3]))).toEqual(["b", "a", "d", "c"]);
  });

  it("several ties, none moved: nothing to save, so the button holds", () => {
    expect(orderToSave([first, third], orders, new Set())).toEqual([]);
  });
});
