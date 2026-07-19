import { describe, it, expect } from "vitest";
import { allUnitsComplete } from "./gameCompleteness";

// The shared finalize gate for rack + stroke. `thrus` = per-unit scored-hole counts,
// derived LIVE by the caller from its own board (rack slot sides / stroke player rows).

describe("allUnitsComplete", () => {
  it("false when there are no units (nothing to finalize)", () => {
    expect(allUnitsComplete([], 18)).toBe(false);
  });

  it("false while any unit is short of the full round", () => {
    expect(allUnitsComplete([18, 18, 17], 18)).toBe(false); // one player thru 17
    expect(allUnitsComplete([0], 18)).toBe(false); // not started
    expect(allUnitsComplete([18, 0], 18)).toBe(false); // a late group thru 0 blocks it
  });

  it("true only when every unit is thru every hole", () => {
    expect(allUnitsComplete([18, 18, 18, 18], 18)).toBe(true);
    expect(allUnitsComplete([9], 9)).toBe(true); // 9-hole game
  });

  it("thru beyond the count still counts as complete (never a false negative)", () => {
    expect(allUnitsComplete([18, 19], 18)).toBe(true);
  });

  it("mid-round group re-blocks: complete field + a fresh thru-0 unit → false", () => {
    const complete = [18, 18, 18];
    expect(allUnitsComplete(complete, 18)).toBe(true);
    expect(allUnitsComplete([...complete, 0], 18)).toBe(false); // 4th group added
  });
});
