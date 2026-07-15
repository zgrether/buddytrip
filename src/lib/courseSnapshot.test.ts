import { describe, it, expect } from "vitest";
import { buildCourseSnapshot, type CourseSnapshotInput } from "./courseSnapshot";

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
