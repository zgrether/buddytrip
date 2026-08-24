import { describe, it, expect } from "vitest";
import {
  quickGameSubtitle,
  quickGameUnits,
  quickGamePips,
  quickGameStandings,
  scoredParticipantIds,
  hasAnyScore,
  buildRosterFromDrafts,
  migrateQuickGameState,
  QUICK_GAME_STATE_VERSION,
  type QuickGameState,
  type QuickGameCourse,
  type DraftPlayerRow,
} from "./quickGame";
import { buildCourseSnapshot, type CourseSnapshotInput } from "./courseSnapshot";
import { netStrokeEntries, computeStrokePlayStandings, type RawStrokeEntry } from "./strokePlay";
import { strokeHoles } from "./matchPlay";
import { unitsFromSchema, strokeIndexOf } from "./strokePlayConfig";

function state(overrides: Partial<QuickGameState>): QuickGameState {
  return {
    version: QUICK_GAME_STATE_VERSION,
    players: [
      { id: "p1", name: "Zach Grether", color: "#2dd4bf" },
      { id: "p2", name: "Buddy", color: "#60a5fa" },
    ],
    values: {},
    finished: false,
    currentHole: 1,
    course: null,
    strokes: {},
    ...overrides,
  };
}

// A real 18 (Slice-C-style) course — same fixture shape as courseSnapshot.test.ts.
const PAR18 = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 3, 4, 5, 4, 4, 3, 4, 5];
const INDEX18 = [7, 3, 15, 1, 11, 5, 17, 9, 13, 8, 16, 2, 4, 12, 6, 18, 10, 14];
const COURSE18: CourseSnapshotInput = { hole_count: 18, par: PAR18, handicap_index: INDEX18, has_stroke_index: true };

// A 9-hole course — Phase 0 found Quick Game hardcoded to 18 holes; selecting a
// 9-hole course must produce a genuinely 9-hole round, not a broken 18.
const PAR9 = [4, 5, 3, 4, 4, 3, 5, 4, 4];
const INDEX9 = [3, 7, 9, 1, 5, 8, 2, 6, 4];
const COURSE9: CourseSnapshotInput = { hole_count: 9, par: PAR9, handicap_index: INDEX9, has_stroke_index: true };

function courseFrom(input: CourseSnapshotInput, id = "c1", name = "Test Links"): QuickGameCourse {
  const snap = buildCourseSnapshot(input, "gtt_stroke_play");
  if (!snap.ok) throw new Error("fixture course failed to snapshot");
  return { id, name, schema: snap.schema };
}

describe("quickGameSubtitle", () => {
  it("no saved game → the always-available pitch line", () => {
    expect(quickGameSubtitle(null)).toBe("Keep score right now — no trip needed");
  });

  it("game exists, no scores yet → hole + no-scores, names nobody", () => {
    expect(quickGameSubtitle(state({ currentHole: 3 }))).toBe("Hole 3 of 18 · no scores yet");
  });

  it("a 9-hole course → the unit count follows the course, not a hardcoded 18", () => {
    const s = state({ currentHole: 2, course: courseFrom(COURSE9) });
    expect(quickGameSubtitle(s)).toBe("Hole 2 of 9 · no scores yet");
  });

  it("in progress starts at creation, not at first score — a fresh game never names a leader", () => {
    // Players + a course, zero scores: must NOT read as "leading" or "tied".
    const s = state({ currentHole: 1, values: {} });
    expect(quickGameSubtitle(s)).not.toMatch(/leading|Tied/);
  });

  it("one player ahead → names them, to-par and thru", () => {
    // Par is [4,5,3,4,4,3,5,4,4, ...]; par 1 + par 2 = 9.
    const s = state({
      currentHole: 3,
      values: {
        p1: { "1": 4, "2": 4 }, // 8 strokes over par 9 → −1
        p2: { "1": 5, "2": 6 }, // 11 strokes over par 9 → +2
      },
    });
    expect(quickGameSubtitle(s)).toBe("Zach leading at −1 thru 2");
  });

  it("uses the player's first name only", () => {
    const s = state({
      values: {
        p1: { "1": 3 }, // par 4 → −1
        p2: { "1": 5 }, // par 4 → +1
      },
    });
    expect(quickGameSubtitle(s)).toMatch(/^Zach leading/);
  });

  it("tied leaders → no name", () => {
    const s = state({
      values: {
        p1: { "1": 4 },
        p2: { "1": 4 },
      },
    });
    expect(quickGameSubtitle(s)).toBe("Tied at E thru 1");
  });

  it("even par formats as E, not +0", () => {
    const s = state({ values: { p1: { "1": 4 } } });
    expect(quickGameSubtitle(s)).toBe("Zach leading at E thru 1");
  });

  it("agrees with the entry screen's own leader when only one player has scored", () => {
    // A late arrival (thru 0) must not appear "leading" by virtue of a 0 total —
    // computeStrokePlayStandings only ranks scoredIds, so p2 is excluded here.
    const s = state({ values: { p1: { "1": 6 } } }); // par 4 → +2
    expect(quickGameSubtitle(s)).toBe("Zach leading at +2 thru 1");
  });

  it("a handicap game reports NET, not gross — the reader Phase 0 found computing gross", () => {
    // The course's index-1 (hardest) hole is hole 4 (INDEX18[3] === 1; par 5).
    // p1 gets one stroke and lands it there; p2 gets none.
    const course = courseFrom(COURSE18);
    const s = state({
      course,
      strokes: { p1: 1 },
      values: { p1: { "4": 6 }, p2: { "4": 6 } }, // gross tied at +1 each
    });
    // Gross alone (the bug) would read "Tied at +1 thru 1" — both shot 6 on a
    // par 5. Netted, p1's stroke brings them to 5 (even); p2 stays +1.
    expect(quickGameSubtitle(s)).toBe("Zach leading at E thru 1");
  });
});

describe("scoredParticipantIds / hasAnyScore", () => {
  it("no scores → empty / false", () => {
    const s = state({});
    expect(scoredParticipantIds(s)).toEqual([]);
    expect(hasAnyScore(s)).toBe(false);
  });

  it("one scored cell → that player only, true", () => {
    const s = state({ values: { p1: { "1": 4 } } });
    expect(scoredParticipantIds(s)).toEqual(["p1"]);
    expect(hasAnyScore(s)).toBe(true);
  });

  it("an empty per-player object (no cells) does not count as scored", () => {
    const s = state({ values: { p1: {} } });
    expect(hasAnyScore(s)).toBe(false);
  });
});

describe("buildRosterFromDrafts", () => {
  it("a solo round still starts — the floor of 1 (#954/#955)", () => {
    const rows: DraftPlayerRow[] = [{ id: "a", name: "Zach", strokes: 0 }];
    const roster = buildRosterFromDrafts(rows);
    expect(roster).not.toBeNull();
    expect(roster!.players).toHaveLength(1);
  });

  it("zero named players → null (nothing to start)", () => {
    const rows: DraftPlayerRow[] = [{ id: "a", name: "  ", strokes: 0 }];
    expect(buildRosterFromDrafts(rows)).toBeNull();
  });

  it("blank rows are dropped, not counted toward the floor", () => {
    const rows: DraftPlayerRow[] = [
      { id: "a", name: "Zach", strokes: 0 },
      { id: "b", name: "  ", strokes: 0 },
    ];
    const roster = buildRosterFromDrafts(rows);
    expect(roster!.players.map((p) => p.id)).toEqual(["a"]);
  });

  it("caps at 4 even when more rows are drafted", () => {
    const rows: DraftPlayerRow[] = Array.from({ length: 6 }, (_, i) => ({
      id: String(i), name: `P${i}`, strokes: 0,
    }));
    const roster = buildRosterFromDrafts(rows);
    expect(roster!.players).toHaveLength(4);
  });

  it("clamps each player's strokes into 0–18", () => {
    const rows: DraftPlayerRow[] = [
      { id: "a", name: "Zach", strokes: 25 },
      { id: "b", name: "Buddy", strokes: -3 },
    ];
    const roster = buildRosterFromDrafts(rows)!;
    expect(roster.strokes["a"]).toBe(18);
    expect(roster.strokes["b"]).toBe(0);
  });
});

describe("quickGameUnits", () => {
  it("no course → the 18-hole default", () => {
    expect(quickGameUnits(state({}))).toHaveLength(18);
  });

  it("a 9-hole course → exactly 9 units, with the course's own par + index", () => {
    const s = state({ course: courseFrom(COURSE9) });
    const units = quickGameUnits(s);
    expect(units).toHaveLength(9);
    expect(units.map((u) => u.par)).toEqual(PAR9);
    expect(units.map((u) => u.strokeIndex)).toEqual(INDEX9);
  });

  it("an 18-hole course leaves the round unchanged in shape", () => {
    const s = state({ course: courseFrom(COURSE18) });
    expect(quickGameUnits(s)).toHaveLength(18);
  });
});

describe("quickGameStandings — the net control", () => {
  it("nets against the SAME independently-derived control the trip-side stroke game produces", () => {
    // Independently re-derive net standings from the raw primitives — the exact
    // composition `computeStrokePlayResults` (server) runs, minus the DB I/O —
    // WITHOUT calling any quickGame.ts helper. If quickGameStandings agrees with
    // this, it agrees with the trip-side path for identical inputs; comparing it
    // against itself would prove nothing.
    const course = courseFrom(COURSE18);
    const players = [
      { id: "p1", name: "Zach", color: "#2dd4bf" },
      { id: "p2", name: "Buddy", color: "#60a5fa" },
    ];
    // strokes=3 lands on the course's 3 hardest holes — INDEX18 value 1,2,3 are
    // holes "4", "12", "2" respectively. Score exactly those so all 3 strokes
    // land on played holes.
    const strokes = { p1: 3, p2: 0 };
    const values = {
      p1: { "2": 5, "4": 6, "12": 5 }, // gross 16, net 13 (−1 on every hole here)
      p2: { "2": 4, "4": 5, "12": 5 }, // gross 14, unchanged (no strokes)
    };
    const s = state({ players, course, strokes, values });

    const units = unitsFromSchema(course.schema);
    const scIndex = strokeIndexOf(units);
    const strokedByPlayer: Record<string, Set<string>> = {};
    for (const [pid, n] of Object.entries(strokes)) {
      strokedByPlayer[pid] = new Set([...strokeHoles(n, scIndex)].map(String));
    }
    const raw: RawStrokeEntry[] = [];
    for (const [pid, byLabel] of Object.entries(values)) {
      for (const [label, v] of Object.entries(byLabel)) raw.push({ participant_id: pid, unit_label: label, value: v });
    }
    const expected = computeStrokePlayStandings(
      players.map((p) => p.id),
      netStrokeEntries(raw, strokedByPlayer)
    );

    expect(quickGameStandings(s)).toEqual(expected);
    // And netting must actually matter here, or this test proves nothing: p1's
    // GROSS (16) is worse than p2's (14), but p1's 3 strokes net them ahead —
    // a gross-only computation (the bug) would rank p2 first, backwards.
    const p1 = expected.find((r) => r.entityId === "p1")!;
    const p2 = expected.find((r) => r.entityId === "p2")!;
    expect(p1.rawScore).toBe(13);
    expect(p2.rawScore).toBe(14);
    expect(p1.rawScore).toBeLessThan(p2.rawScore);
  });

  it("no handicaps, no course → net ≡ gross (unchanged behavior)", () => {
    const s = state({ values: { p1: { "1": 4 }, p2: { "1": 5 } } });
    const standings = quickGameStandings(s);
    expect(standings.find((r) => r.entityId === "p1")!.rawScore).toBe(4);
    expect(standings.find((r) => r.entityId === "p2")!.rawScore).toBe(5);
  });
});

describe("quickGamePips", () => {
  it("no strokes → every player's pip set is empty", () => {
    const s = state({ course: courseFrom(COURSE18) });
    const pips = quickGamePips(s);
    expect(pips.p1.size).toBe(0);
    expect(pips.p2.size).toBe(0);
  });

  it("strokes allocate against the course's real index, not sequential order", () => {
    const s = state({ course: courseFrom(COURSE18), strokes: { p1: 1 } });
    const pips = quickGamePips(s);
    // INDEX18[3] === 1 → hole "4" is the course's hardest hole, not hole "1".
    expect(pips.p1.has("4")).toBe(true);
    expect(pips.p1.has("1")).toBe(false);
  });
});

describe("migrateQuickGameState", () => {
  it("a pre-course-selection (v1) payload loads and the round continues", () => {
    // The exact shape `readQuickGameState` had to handle before course/strokes
    // existed: no version, no course, no strokes.
    const v1 = {
      players: [{ id: "p1", name: "Zach", color: "#2dd4bf" }],
      values: { p1: { "1": 4, "2": 5 } },
      finished: false,
      currentHole: 3,
    };
    const migrated = migrateQuickGameState(v1);
    expect(migrated).not.toBeNull();
    expect(migrated!.version).toBe(QUICK_GAME_STATE_VERSION);
    expect(migrated!.players).toEqual(v1.players);
    expect(migrated!.values).toEqual(v1.values);
    expect(migrated!.currentHole).toBe(3);
    expect(migrated!.course).toBeNull();
    expect(migrated!.strokes).toEqual({});
  });

  it("a current-shape payload round-trips unchanged", () => {
    const s = state({ strokes: { p1: 4 }, course: courseFrom(COURSE9) });
    const migrated = migrateQuickGameState(JSON.parse(JSON.stringify(s)));
    expect(migrated).toEqual(s);
  });

  it("not an object → null", () => {
    expect(migrateQuickGameState("not an object")).toBeNull();
    expect(migrateQuickGameState(null)).toBeNull();
    expect(migrateQuickGameState(42)).toBeNull();
  });

  it("missing players / values → null (a wrong shape, not a valid empty state)", () => {
    expect(migrateQuickGameState({ values: {}, finished: false, currentHole: 1 })).toBeNull();
    expect(migrateQuickGameState({ players: [], finished: false, currentHole: 1 })).toBeNull();
  });
});
