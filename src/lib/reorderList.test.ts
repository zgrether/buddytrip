import { describe, it, expect } from "vitest";
import { canMoveBy, moveBy, moveItem } from "./reorderList";

/**
 * The arrow arithmetic, tested where it can actually be exercised.
 *
 * The suite's environment is `node`, so `ReorderableList` can be RENDERED but
 * never clicked. If this logic lived in the component the only reachable
 * assertion would be "an up arrow exists" — true of an arrow wired to the wrong
 * index, or to no index at all. Hence the split.
 */

describe("moveItem", () => {
  it("moves forwards and backwards, returning a new array", () => {
    const a = ["a", "b", "c", "d"];
    expect(moveItem(a, 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveItem(a, 3, 1)).toEqual(["a", "d", "b", "c"]);
    expect(a).toEqual(["a", "b", "c", "d"]); // input untouched
  });

  it("returns the SAME REFERENCE for a no-op, which callers branch on", () => {
    // `ReorderableList.move` uses reference equality to decide whether to emit
    // `onReorder` at all. A defensive `slice()` here would look harmless and
    // would make every arrow tap at the end of the list report a change,
    // lighting up a draft-dirty flag for a tap that moved nothing.
    const a = ["a", "b"];
    expect(moveItem(a, 1, 1)).toBe(a);
    expect(moveItem(a, -1, 0)).toBe(a);
    expect(moveItem(a, 0, 9)).toBe(a);
  });

  it("does not splice undefined in when an index is out of range", () => {
    // The reason this is not just `arrayMove`: out-of-range there is inherited
    // behaviour rather than stated behaviour.
    expect(moveItem(["a", "b"], 0, 5)).toEqual(["a", "b"]);
    expect(moveItem(["a", "b"], 5, 0)).toEqual(["a", "b"]);
  });
});

describe("canMoveBy", () => {
  it("is false at each end in the direction that would leave the list", () => {
    expect(canMoveBy(0, -1, 3)).toBe(false);
    expect(canMoveBy(0, 1, 3)).toBe(true);
    expect(canMoveBy(2, 1, 3)).toBe(false);
    expect(canMoveBy(2, -1, 3)).toBe(true);
  });

  it("is false for every direction in a one-item list", () => {
    expect(canMoveBy(0, -1, 1)).toBe(false);
    expect(canMoveBy(0, 1, 1)).toBe(false);
  });

  it("is false for an empty list", () => {
    expect(canMoveBy(0, 1, 0)).toBe(false);
  });
});

describe("moveBy", () => {
  it("nudges one position in each direction", () => {
    expect(moveBy(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
    expect(moveBy(["a", "b", "c"], 1, 1)).toEqual(["a", "c", "b"]);
  });

  it("DOES NOT WRAP at either end — it no-ops", () => {
    // The load-bearing case. Wrapping is the tempting "nice" behaviour and is
    // wrong for a confidence ranking: the top row is the pick you are surest
    // about, and one extra tap on its up arrow must not silently make it the
    // one you are least sure about.
    const a = ["a", "b", "c"];
    expect(moveBy(a, 0, -1)).toBe(a);
    expect(moveBy(a, 2, 1)).toBe(a);
  });

  it("agrees with canMoveBy at every position — one bound, not two", () => {
    // The disabled state and the click handler read the same predicate. This
    // asserts they cannot disagree: wherever canMoveBy says no, moveBy is inert,
    // and wherever it says yes, the array actually changes.
    const items = ["a", "b", "c", "d", "e"];
    for (let i = 0; i < items.length; i++) {
      for (const delta of [-1, 1]) {
        const moved = moveBy(items, i, delta);
        expect(moved !== items).toBe(canMoveBy(i, delta, items.length));
      }
    }
  });

  it("a full pass of up-nudges walks an item to the front and then stops", () => {
    // End-to-end over the arithmetic, which is what a person actually does with
    // the arrows on a 16-row sheet.
    let items = ["a", "b", "c", "d"];
    for (let i = 3; i > 0; i--) items = moveBy(items, i, -1);
    expect(items).toEqual(["d", "a", "b", "c"]);
    const settled = moveBy(items, 0, -1);
    expect(settled).toBe(items);
  });
});
