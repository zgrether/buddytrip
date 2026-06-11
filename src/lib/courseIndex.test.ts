import { describe, it, expect } from "vitest";
import {
  validateStrokeIndex,
  applyStrokeIndexSwap,
  buildScorecardSchema,
  type ScorecardSchema,
  type IndexEntry,
} from "./courseIndex";

describe("validateStrokeIndex", () => {
  it("accepts a complete permutation of 1..N", () => {
    const idx = [7, 3, 15, 1, 11, 5, 17, 9, 13, 8, 4, 16, 2, 12, 6, 18, 10, 14];
    expect(validateStrokeIndex(idx, 18).valid).toBe(true);
  });

  it("flags unset holes", () => {
    const idx = [1, 2, null, 4];
    const r = validateStrokeIndex(idx, 4);
    expect(r.valid).toBe(false);
    expect(r.unsetHoles).toEqual([3]);
  });

  it("flags duplicates (both holes that share the value)", () => {
    const idx = [1, 2, 2, 4]; // 3 missing, 2 duped
    const r = validateStrokeIndex(idx, 4);
    expect(r.valid).toBe(false);
    expect(r.duplicateHoles).toEqual([2, 3]);
    expect(r.unsetHoles).toEqual([]);
  });

  it("flags out-of-range values", () => {
    const idx = [1, 2, 3, 9];
    const r = validateStrokeIndex(idx, 4);
    expect(r.valid).toBe(false);
    expect(r.outOfRangeHoles).toEqual([4]);
  });

  it("validates a 9-hole permutation of 1..9", () => {
    expect(validateStrokeIndex([1, 2, 3, 4, 5, 6, 7, 8, 9], 9).valid).toBe(true);
    expect(validateStrokeIndex([1, 2, 3, 4, 5, 6, 7, 8, 8], 9).valid).toBe(false);
  });
});

describe("applyStrokeIndexSwap", () => {
  it("swaps with the hole that currently holds the value", () => {
    // Hole 4 (idx 3) has index 1; set hole 1 (idx 0, currently 7) to 1.
    const idx = [7, 3, 15, 1];
    const next = applyStrokeIndexSwap(idx, 0, 1);
    expect(next[0]).toBe(1); // hole 1 now 1
    expect(next[3]).toBe(7); // hole 4 took hole 1's old value
    expect(idx[0]).toBe(7); // input not mutated
  });

  it("swaps null in when the edited hole was unset", () => {
    const idx = [null, 3, 15, 1];
    const next = applyStrokeIndexSwap(idx, 0, 1);
    expect(next[0]).toBe(1);
    expect(next[3]).toBeNull(); // hole 4 took hole 1's (null) previous value
  });

  it("plain-sets when no hole holds the value yet", () => {
    const idx = [null, null, null, null];
    const next = applyStrokeIndexSwap(idx, 2, 3);
    expect(next).toEqual([null, null, 3, null]);
  });

  it("a sequence of swaps keeps the set a permutation", () => {
    let idx: IndexEntry[] = [1, 2, 3, 4];
    idx = applyStrokeIndexSwap(idx, 0, 4); // [4,2,3,1]
    idx = applyStrokeIndexSwap(idx, 1, 3); // [4,3,2,1]
    expect(validateStrokeIndex(idx, 4).valid).toBe(true);
    expect([...idx].sort((a, b) => (a! - b!))).toEqual([1, 2, 3, 4]);
  });
});

describe("buildScorecardSchema", () => {
  const template: ScorecardSchema = {
    units: {
      type: "holes",
      count: 18,
      labels: Array.from({ length: 18 }, (_, i) => String(i + 1)),
      metadata: { par: Array(18).fill(4), handicap_index: Array(18).fill(1) },
    },
    scoring: {
      strategy: "stroke_total",
      direction: "low_wins",
      sections: [
        { name: "Front 9", units: ["1"] },
        { name: "Back 9", units: ["10"] },
      ],
    },
  };

  it("snapshots par + handicap_index into units.metadata (18 holes)", () => {
    const par = [4, 5, 3, 4, 4, 3, 5, 4, 4, 4, 3, 5, 4, 4, 3, 4, 5, 4];
    const idx = [7, 3, 15, 1, 11, 5, 17, 9, 13, 8, 4, 16, 2, 12, 6, 18, 10, 14];
    const s = buildScorecardSchema(template, par, idx, 18);
    expect(s.units.metadata?.par).toEqual(par);
    expect(s.units.metadata?.handicap_index).toEqual(idx);
    expect(s.units.count).toBe(18);
    expect(s.units.labels).toHaveLength(18);
    expect(s.scoring?.sections).toEqual([
      { name: "Front 9", units: ["1", "2", "3", "4", "5", "6", "7", "8", "9"] },
      { name: "Back 9", units: ["10", "11", "12", "13", "14", "15", "16", "17", "18"] },
    ]);
  });

  it("produces a single Front section for a 9-hole course", () => {
    const par = [4, 5, 3, 4, 4, 3, 5, 4, 4];
    const idx = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    const s = buildScorecardSchema(template, par, idx, 9);
    expect(s.units.count).toBe(9);
    expect(s.units.labels).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9"]);
    expect(s.scoring?.sections).toHaveLength(1);
    expect(s.scoring?.sections?.[0].units).toHaveLength(9);
  });

  it("does not mutate the template", () => {
    buildScorecardSchema(template, Array(18).fill(3), Array.from({ length: 18 }, (_, i) => i + 1), 18);
    expect(template.units.metadata?.par).toEqual(Array(18).fill(4));
  });
});
