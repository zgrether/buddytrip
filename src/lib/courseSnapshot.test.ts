import { describe, it, expect } from "vitest";
import { buildComposedCourseSnapshot, buildCourseSnapshot, type CourseSnapshotInput } from "./courseSnapshot";
import type { ScorecardSchema } from "./courseIndex";

/**
 * buildCourseSnapshot — the shared "apply a course" derivation. These lock the
 * behaviours the SERVER's applyCourse relied on inline, now that the settings
 * draft runs the same function client-side: an applied course and a drafted one
 * must produce the identical snapshot, and a bad index must be refused rather
 * than frozen into a game.
 */

const PAR18 = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 3, 4, 5, 4, 4, 3, 4, 5];
const INDEX18 = [7, 3, 15, 1, 11, 5, 17, 9, 13, 8, 16, 2, 4, 12, 6, 18, 10, 14];

const COURSE: CourseSnapshotInput = {
  hole_count: 18,
  par: PAR18,
  handicap_index: INDEX18,
  has_stroke_index: true,
  tee_sets: [
    { name: "Blue", yards: Array(18).fill(400), courseRating: 72.1, slopeRating: 130 },
    { name: "White", yards: Array(18).fill(360), courseRating: 70.0, slopeRating: 125 },
  ],
};

describe("buildCourseSnapshot", () => {
  it("snapshots par + index onto the format's scorecard schema", () => {
    const res = buildCourseSnapshot(COURSE, "gtt_match_play");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.schema.units?.count).toBe(18);
  });

  it("snapshots the REQUESTED tee, not just the first", () => {
    const first = buildCourseSnapshot(COURSE, "gtt_match_play");
    const white = buildCourseSnapshot(COURSE, "gtt_match_play", "White");
    expect(first.ok && white.ok).toBe(true);
    // The two tees carry different yardage, so the snapshots must differ.
    expect(JSON.stringify(white)).not.toBe(JSON.stringify(first));
  });

  it("falls back to the first tee when the requested name is unknown", () => {
    const unknown = buildCourseSnapshot(COURSE, "gtt_match_play", "Nope");
    const first = buildCourseSnapshot(COURSE, "gtt_match_play");
    expect(JSON.stringify(unknown)).toBe(JSON.stringify(first));
  });

  it("refuses a stroke index that isn't a valid permutation", () => {
    const bad = buildCourseSnapshot({ ...COURSE, handicap_index: [1, 1, 1] }, "gtt_match_play");
    expect(bad).toEqual({ ok: false, reason: "bad_index" });
  });

  it("an index-OFF course snapshots par only (a bad index is not consulted)", () => {
    const res = buildCourseSnapshot(
      { ...COURSE, has_stroke_index: false, handicap_index: [1, 1, 1] },
      "gtt_match_play"
    );
    expect(res.ok).toBe(true);
  });

  it("reports no_base_schema for a format with no scorecard to snapshot onto", () => {
    expect(buildCourseSnapshot(COURSE, "gtt_not_a_real_format")).toEqual({ ok: false, reason: "no_base_schema" });
  });

  it("is deterministic — the same inputs give a byte-identical snapshot", () => {
    // This is the property the draft rides on: the client pre-computes the
    // snapshot and the server writes it; both must agree exactly.
    expect(JSON.stringify(buildCourseSnapshot(COURSE, "gtt_match_play", "Blue"))).toBe(
      JSON.stringify(buildCourseSnapshot(COURSE, "gtt_match_play", "Blue"))
    );
  });
});

/**
 * buildComposedCourseSnapshot — the two-nines half (W-9HOLE-01), lifted out of the
 * server's setBackNine so the draft composes the SAME 18. The subtle one is the
 * front de-interleave on a SWAP: a composed 18's first nine carries the odd ranks
 * (2·s−1), which must be mapped back to 1..9 before re-composing, or every swap
 * would corrupt the front's stroke index.
 */
const PAR9 = [4, 4, 3, 5, 4, 4, 3, 4, 5];
const INDEX9 = [7, 3, 9, 1, 5, 6, 8, 4, 2];

const BACK9: CourseSnapshotInput = {
  hole_count: 9,
  par: [4, 3, 5, 4, 4, 3, 4, 5, 4],
  handicap_index: [2, 8, 4, 6, 1, 9, 5, 3, 7],
  has_stroke_index: true,
  tee_sets: [{ name: "Blue", yards: Array(9).fill(380), courseRating: 35.5, slopeRating: 128 }],
};

/** A lone 9-hole front, as `applyCourse` leaves it (index already 1..9). */
const front9 = (): ScorecardSchema => {
  const res = buildCourseSnapshot(
    { hole_count: 9, par: PAR9, handicap_index: INDEX9, has_stroke_index: true, tee_sets: [{ name: "Blue", yards: Array(9).fill(400), courseRating: 35.1, slopeRating: 126 }] },
    "gtt_match_play"
  );
  if (!res.ok) throw new Error("front fixture failed");
  return res.schema;
};

describe("buildComposedCourseSnapshot", () => {
  it("composes a 9-hole front + a 9-hole back into an interleaved 18", () => {
    const res = buildComposedCourseSnapshot({ frontSchema: front9(), hasBackRef: false, backCourse: BACK9 }, "gtt_match_play");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.schema.units?.count).toBe(18);
    expect(res.schema.units?.metadata?.par).toEqual([...PAR9, ...BACK9.par]);
    // Front takes the ODD ranks (2s−1), back the EVEN (2s) — a valid 1..18 permutation.
    const idx = res.schema.units?.metadata?.handicap_index ?? [];
    expect(idx.slice(0, 9)).toEqual(INDEX9.map((s) => 2 * s - 1));
    expect(idx.slice(9)).toEqual(BACK9.handicap_index!.map((s) => 2 * s));
    expect([...idx].sort((a, b) => a - b)).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));
  });

  it("a SWAP de-interleaves the front back to 1..9 — the front's index survives", () => {
    const first = buildComposedCourseSnapshot({ frontSchema: front9(), hasBackRef: false, backCourse: BACK9 }, "gtt_match_play");
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    // Swap the back on the ALREADY-composed 18 (count 18 + a back ref).
    const swapped = buildComposedCourseSnapshot({ frontSchema: first.schema, hasBackRef: true, backCourse: BACK9 }, "gtt_match_play");
    expect(swapped.ok).toBe(true);
    if (!swapped.ok) return;
    // Re-composing the same back is idempotent — proof the de-interleave inverted
    // the interleave exactly (a missing (v+1)/2 would drift the front's ranks).
    expect(swapped.schema.units?.metadata?.handicap_index).toEqual(first.schema.units?.metadata?.handicap_index);
  });

  it("the composed tee keeps the FRONT's name and spans 18 yards", () => {
    const res = buildComposedCourseSnapshot({ frontSchema: front9(), hasBackRef: false, backCourse: BACK9 }, "gtt_match_play");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.schema.units?.metadata?.tee?.name).toBe("Blue");
    expect(res.schema.units?.metadata?.tee?.yards).toEqual([...Array(9).fill(400), ...Array(9).fill(380)]);
  });

  it("records the back's chosen tee name when it differs from the front's", () => {
    const twoTee: CourseSnapshotInput = {
      ...BACK9,
      tee_sets: [{ name: "Gold", yards: Array(9).fill(300), courseRating: 33.0, slopeRating: 118 }],
    };
    // No "Blue" on the back → its first tee supplies the yards (the UI surfaces this).
    const res = buildComposedCourseSnapshot({ frontSchema: front9(), hasBackRef: false, backCourse: twoTee }, "gtt_match_play");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.schema.units?.metadata?.backTeeName).toBe("Gold");
    expect(res.schema.units?.metadata?.tee?.name).toBe("Blue"); // composed name stays the front's
  });

  it("refuses a real 18 with no back ref, a non-9 back, and a bad back index", () => {
    const real18 = buildCourseSnapshot(COURSE, "gtt_match_play");
    expect(real18.ok).toBe(true);
    if (!real18.ok) return;
    expect(buildComposedCourseSnapshot({ frontSchema: real18.schema, hasBackRef: false, backCourse: BACK9 }, "gtt_match_play"))
      .toEqual({ ok: false, reason: "not_two_nines" });
    expect(buildComposedCourseSnapshot({ frontSchema: front9(), hasBackRef: false, backCourse: COURSE }, "gtt_match_play"))
      .toEqual({ ok: false, reason: "back_not_nine" });
    expect(buildComposedCourseSnapshot({ frontSchema: front9(), hasBackRef: false, backCourse: { ...BACK9, handicap_index: [1, 1, 1] } }, "gtt_match_play"))
      .toEqual({ ok: false, reason: "bad_back_index" });
    expect(buildComposedCourseSnapshot({ frontSchema: null, hasBackRef: false, backCourse: BACK9 }, "gtt_match_play"))
      .toEqual({ ok: false, reason: "no_front" });
  });

  it("is deterministic — the draft and the server compose byte-identically", () => {
    const a = buildComposedCourseSnapshot({ frontSchema: front9(), hasBackRef: false, backCourse: BACK9 }, "gtt_match_play");
    const b = buildComposedCourseSnapshot({ frontSchema: front9(), hasBackRef: false, backCourse: BACK9 }, "gtt_match_play");
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
