import { describe, it, expect } from "vitest";
import {
  quickGameSubtitle,
  quickGameTitle,
  quickGameUnits,
  quickGamePips,
  quickGameStandings,
  quickMatchState,
  quickMatchDecided,
  quickMatchGloriousAvailable,
  quickRackResult,
  buildQuickMatchSides,
  quickFormatPlayerCountError,
  scoredParticipantIds,
  hasAnyScore,
  buildRosterFromDrafts,
  migrateQuickGameState,
  QUICK_GAME_STATE_VERSION,
  QUICK_GAME_LABEL,
  type QuickGameState,
  type QuickStrokeState,
  type QuickMatchState,
  type QuickRackState,
  type QuickGameCourse,
  type DraftPlayerRow,
} from "./quickGame";
import { buildCourseSnapshot, type CourseSnapshotInput } from "./courseSnapshot";
import { netStrokeEntries, computeStrokePlayStandings, type RawStrokeEntry } from "./strokePlay";
import { strokeHoles, buildDecided, matchState } from "./matchPlay";
import { unitsFromSchema, strokeIndexOf } from "./strokePlayConfig";

function state(overrides: Partial<QuickStrokeState> = {}): QuickStrokeState {
  return {
    version: QUICK_GAME_STATE_VERSION,
    format: "stroke",
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

const P4 = [
  { id: "p1", name: "Zach Grether", color: "#2dd4bf" },
  { id: "p2", name: "Buddy", color: "#60a5fa" },
  { id: "p3", name: "Mike", color: "#f59e0b" },
  { id: "p4", name: "Ryan", color: "#a855f7" },
];

function matchGame(overrides: Partial<QuickMatchState> = {}): QuickMatchState {
  return {
    version: QUICK_GAME_STATE_VERSION,
    format: "match",
    players: P4.slice(0, 2),
    values: {},
    finished: false,
    currentHole: 1,
    course: null,
    entryMode: "score",
    sideA: { id: "sA", playerIds: ["p1"], strokes: 0 },
    sideB: { id: "sB", playerIds: ["p2"], strokes: 0 },
    outcomes: {},
    modifiers: {},
    ...overrides,
  };
}

function rackGame(overrides: Partial<QuickRackState> = {}): QuickRackState {
  return {
    version: QUICK_GAME_STATE_VERSION,
    format: "rack",
    players: P4,
    values: {},
    finished: false,
    currentHole: 1,
    course: null,
    strokes: {},
    teams: { p1: "A", p2: "A", p3: "B", p4: "B" },
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
    expect((migrated as QuickStrokeState).strokes).toEqual({});
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

// ── Match play ───────────────────────────────────────────────────────────────

describe("quickFormatPlayerCountError — 2 or 4, never 3", () => {
  it("2 players → a 1v1 is legal", () => {
    expect(quickFormatPlayerCountError("match", 2)).toBeNull();
  });
  it("4 players → a 2v2 is legal", () => {
    expect(quickFormatPlayerCountError("match", 4)).toBeNull();
  });
  it("3 players → REFUSED, with a sentence naming both ways out", () => {
    const err = quickFormatPlayerCountError("match", 3);
    expect(err).toBeTruthy();
    // Not a bare "invalid": it must say what to do. Asserting the exact copy so
    // a future reword cannot silently degrade it to a shrug.
    expect(err).toBe("Match play needs 2 or 4 players. Add one or drop one.");
  });
  it("1 player → also refused (there is no solo match)", () => {
    expect(quickFormatPlayerCountError("match", 1)).toBeTruthy();
  });
  it("stroke still allows a solo round — the #954/#955 floor is not touched", () => {
    expect(quickFormatPlayerCountError("stroke", 1)).toBeNull();
  });
  it("rack needs two to rack against", () => {
    expect(quickFormatPlayerCountError("rack", 1)).toBeTruthy();
    expect(quickFormatPlayerCountError("rack", 2)).toBeNull();
  });
});

describe("buildQuickMatchSides", () => {
  it("2 players → a 1v1, one player per side", () => {
    const sides = buildQuickMatchSides(["p1", "p2"], null)!;
    expect(sides.sideA.playerIds).toEqual(["p1"]);
    expect(sides.sideB.playerIds).toEqual(["p2"]);
  });
  it("4 players → a 2v2 partnered on the chosen player, the rest opposing", () => {
    const sides = buildQuickMatchSides(["p1", "p2", "p3", "p4"], "p3")!;
    expect(sides.sideA.playerIds).toEqual(["p1", "p3"]);
    expect(sides.sideB.playerIds).toEqual(["p2", "p4"]);
  });
  it("4 players with no partner chosen → defaults to the next player", () => {
    const sides = buildQuickMatchSides(["p1", "p2", "p3", "p4"], null)!;
    expect(sides.sideA.playerIds).toEqual(["p1", "p2"]);
    expect(sides.sideB.playerIds).toEqual(["p3", "p4"]);
  });
  it("sides get distinct ids — they are separate score columns", () => {
    const sides = buildQuickMatchSides(["p1", "p2"], null)!;
    expect(sides.sideA.id).not.toBe(sides.sideB.id);
  });
  it("3 players → null (no 3-way match exists)", () => {
    expect(buildQuickMatchSides(["p1", "p2", "p3"], null)).toBeNull();
  });
});

describe("quickMatchState — score mode, against an independent control", () => {
  it("net match state matches what the trip-side path produces for identical inputs", () => {
    // Re-derive through the raw primitives the trip-side view composes
    // (buildDecided → matchState), WITHOUT calling any quickGame helper.
    // Comparing quickMatchState against its own internals would prove nothing.
    const course = courseFrom(COURSE18);
    const units = unitsFromSchema(course.schema);
    const scIndex = strokeIndexOf(units);
    const grossA = { "1": 5, "2": 4, "3": 4, "4": 6 };
    const grossB = { "1": 4, "2": 4, "3": 5, "4": 5 };
    const s = matchGame({
      course,
      sideA: { id: "sA", playerIds: ["p1"], strokes: 3 },
      sideB: { id: "sB", playerIds: ["p2"], strokes: 0 },
      values: { sA: grossA, sB: grossB },
    });

    const expected = matchState(
      buildDecided(grossA, grossB, 3, 0, scIndex, units.length),
      units.length
    );
    expect(quickMatchState(s)).toEqual(expected);
    // And the handicap must actually be load-bearing here, or this proves
    // nothing: the same holes scored SCRATCH must give a different match state.
    const scratch = matchState(buildDecided(grossA, grossB, 0, 0, scIndex, units.length), units.length);
    expect(expected.diff).not.toBe(scratch.diff);
  });

  it("a 2v2 side is ONE score column, keyed by the side id", () => {
    const s = matchGame({
      players: P4,
      sideA: { id: "sA", playerIds: ["p1", "p3"], strokes: 0 },
      sideB: { id: "sB", playerIds: ["p2", "p4"], strokes: 0 },
      values: { sA: { "1": 4 }, sB: { "1": 5 } },
    });
    // One entry per SIDE decides the hole — not one per player.
    expect(quickMatchDecided(s)).toEqual([{ hole: 1, result: "W" }]);
  });
});

describe("quickMatchState — outcome mode", () => {
  it("outcomes drive the match state with no scores at all", () => {
    const s = matchGame({
      entryMode: "outcome",
      outcomes: { "1": "side_a", "2": "side_a", "3": "halved", "4": "side_b" },
    });
    const st = quickMatchState(s);
    expect(st.thru).toBe(4);
    expect(st.diff).toBe(1); // 2 won, 1 lost, 1 halved
    expect(st.leader).toBe("A");
  });

  it("pips still render in outcome mode — nothing is computed from them, and that IS the point", () => {
    const s = matchGame({
      entryMode: "outcome",
      course: courseFrom(COURSE18),
      sideA: { id: "sA", playerIds: ["p1"], strokes: 4 },
      sideB: { id: "sB", playerIds: ["p2"], strokes: 0 },
      outcomes: { "1": "side_a" },
    });
    const pips = quickGamePips(s);
    expect(pips.sA.size).toBe(4); // four stroke holes shown so players settle it
    expect(pips.sB.size).toBe(0);
    // ...and the match state is decided purely by the recorded outcome.
    expect(quickMatchState(s).diff).toBe(1);
  });

  it("an outcome match reports as STARTED — it has zero values its whole life", () => {
    const s = matchGame({ entryMode: "outcome", outcomes: { "1": "side_a" } });
    expect(Object.keys(s.values)).toHaveLength(0); // the trap
    expect(hasAnyScore(s)).toBe(true); // ...which must not read as "not started"
    expect(scoredParticipantIds(s)).toHaveLength(0); // the values-only view sees nothing
  });
});

describe("Glorious Finishing Holes availability", () => {
  it("HIDDEN in score mode — the trip side refuses the combination", () => {
    expect(quickMatchGloriousAvailable({ entryMode: "score", course: courseFrom(COURSE18) })).toBe(false);
  });
  it("HIDDEN on a 9-hole round — ROUND_HOLES is 18, so it could only be inert", () => {
    expect(quickMatchGloriousAvailable({ entryMode: "outcome", course: courseFrom(COURSE9) })).toBe(false);
  });
  it("offered on an 18-hole outcome round", () => {
    expect(quickMatchGloriousAvailable({ entryMode: "outcome", course: courseFrom(COURSE18) })).toBe(true);
  });
  it("offered with no course — the default layout is 18 holes", () => {
    expect(quickMatchGloriousAvailable({ entryMode: "outcome", course: null })).toBe(true);
  });

  it("applied on 18-hole outcome: a won closing hole swings 2, not 1", () => {
    const plain = matchGame({ entryMode: "outcome", outcomes: { "1": "side_b", "18": "side_a" } });
    const glorious = matchGame({
      entryMode: "outcome",
      outcomes: { "1": "side_b", "18": "side_a" },
      modifiers: { glorious_holes: { holes: 3 } },
    });
    // Unweighted: 1 win + 1 loss = all square. Weighted: the 18th counts double.
    expect(quickMatchState(plain).diff).toBe(0);
    expect(quickMatchState(glorious).diff).toBe(1);
  });

  it("and ONLY that — an early hole is unaffected by the modifier", () => {
    const plain = matchGame({ entryMode: "outcome", outcomes: { "1": "side_a" } });
    const glorious = matchGame({
      entryMode: "outcome",
      outcomes: { "1": "side_a" },
      modifiers: { glorious_holes: { holes: 3 } },
    });
    expect(quickMatchState(glorious).diff).toBe(quickMatchState(plain).diff);
  });

  it("is INERT in score mode even if the modifier key is somehow set", () => {
    const course = courseFrom(COURSE18);
    const withMod = matchGame({
      course,
      modifiers: { glorious_holes: { holes: 3 } },
      values: { sA: { "18": 4 }, sB: { "18": 5 } },
    });
    const without = matchGame({ course, values: { sA: { "18": 4 }, sB: { "18": 5 } } });
    expect(quickMatchState(withMod)).toEqual(quickMatchState(without));
  });
});

// ── Rack n Stack ─────────────────────────────────────────────────────────────

describe("quickRackResult", () => {
  it("racks the two teams slot-by-slot and awards team points", () => {
    const s = rackGame({
      course: courseFrom(COURSE18),
      // Team A both beat their opposite number on hole 1 → A takes both slots.
      values: { p1: { "1": 3 }, p2: { "1": 3 }, p3: { "1": 5 }, p4: { "1": 5 } },
    });
    const res = quickRackResult(s);
    expect(res.slots).toHaveLength(2);
    expect(res.points.A).toBe(2);
    expect(res.points.B).toBe(0);
  });

  it("handicaps are ABSOLUTE per player here (net stroke play), unlike match's relative model", () => {
    const par1 = PAR18[0];
    const s = rackGame({
      course: courseFrom(COURSE18),
      strokes: { p3: 18 }, // a stroke on every hole
      values: { p1: { "1": par1 }, p2: { "1": par1 }, p3: { "1": par1 }, p4: { "1": par1 } },
    });
    const res = quickRackResult(s);
    // p3's stroke nets them under par, so team B takes the slot p3 lands in.
    expect(res.points.B).toBeGreaterThan(0);
  });

  it("uneven teams sit the surplus players out rather than mis-racking", () => {
    const s = rackGame({
      course: courseFrom(COURSE18),
      teams: { p1: "A", p2: "B", p3: "B", p4: "B" },
      values: { p1: { "1": 4 }, p2: { "1": 4 }, p3: { "1": 4 }, p4: { "1": 4 } },
    });
    const res = quickRackResult(s);
    expect(res.slots).toHaveLength(1);
    expect(res.sitOut).toHaveLength(2);
  });
});

// ── The format discriminator + its readers ───────────────────────────────────

describe("quickGameTitle — the string five readers used to hardcode", () => {
  it("names the format, not always stroke play", () => {
    expect(quickGameTitle(state())).toBe(QUICK_GAME_LABEL.stroke);
    expect(quickGameTitle(matchGame())).toBe(QUICK_GAME_LABEL.match);
    expect(quickGameTitle(rackGame())).toBe(QUICK_GAME_LABEL.rack);
  });
  it("no saved game → the stroke label (what the entry point offers first)", () => {
    expect(quickGameTitle(null)).toBe(QUICK_GAME_LABEL.stroke);
  });
});

describe("quickGameSubtitle — format-aware", () => {
  it("a match reports in MATCH vocabulary, never stroke standings", () => {
    const s = matchGame({ entryMode: "outcome", outcomes: { "1": "side_a", "2": "side_a" } });
    const sub = quickGameSubtitle(s);
    expect(sub).toBe("Zach 2 up thru 2");
    // The old stroke reader's vocabulary must not appear.
    expect(sub).not.toMatch(/leading at|Tied at/);
  });

  it("an all-square match says so", () => {
    const s = matchGame({ entryMode: "outcome", outcomes: { "1": "side_a", "2": "side_b" } });
    expect(quickGameSubtitle(s)).toBe("All square thru 2");
  });

  it("a 2v2 side is named by both partners", () => {
    const s = matchGame({
      players: P4,
      entryMode: "outcome",
      sideA: { id: "sA", playerIds: ["p1", "p3"], strokes: 0 },
      sideB: { id: "sB", playerIds: ["p2", "p4"], strokes: 0 },
      outcomes: { "1": "side_a" },
    });
    expect(quickGameSubtitle(s)).toBe("Zach & Mike 1 up thru 1");
  });

  it("a rack reports team points", () => {
    const s = rackGame({
      course: courseFrom(COURSE18),
      values: { p1: { "1": 3 }, p2: { "1": 3 }, p3: { "1": 5 }, p4: { "1": 5 } },
    });
    expect(quickGameSubtitle(s)).toBe("Team A leads 2–0 thru 1");
  });

  it("an unscored round of ANY format reads the same way and names nobody", () => {
    for (const s of [state(), matchGame(), rackGame()] as QuickGameState[]) {
      expect(quickGameSubtitle(s)).toBe("Hole 1 of 18 · no scores yet");
    }
  });
});

describe("migrateQuickGameState — the format is READ, never inferred", () => {
  it("a MATCH payload does not load as a stroke round", () => {
    const m = matchGame({ entryMode: "outcome", outcomes: { "1": "side_a" } });
    const loaded = migrateQuickGameState(JSON.parse(JSON.stringify(m)));
    expect(loaded).not.toBeNull();
    expect(loaded!.format).toBe("match");
    // The decisive part: it must not be readable AS stroke. A shape-sniffing
    // validator would have accepted it (it has players and values) and the
    // stroke subtitle would have described a match in the wrong vocabulary.
    expect(quickGameSubtitle(loaded)).not.toMatch(/leading at|Tied at/);
    expect(quickGameTitle(loaded)).toBe(QUICK_GAME_LABEL.match);
  });

  it("a rack payload round-trips with its teams", () => {
    const r = rackGame({ strokes: { p1: 4 }, teams: { p1: "A", p2: "B", p3: "A", p4: "B" } });
    const loaded = migrateQuickGameState(JSON.parse(JSON.stringify(r)));
    expect(loaded).toEqual(r);
  });

  it("a pre-format (v2) stroke payload still loads and the round continues", () => {
    const v2 = {
      version: 2,
      players: [{ id: "p1", name: "Zach", color: "#2dd4bf" }],
      values: { p1: { "1": 4, "2": 5 } },
      finished: false,
      currentHole: 3,
      course: null,
      strokes: { p1: 6 },
    };
    const loaded = migrateQuickGameState(v2);
    expect(loaded).not.toBeNull();
    expect(loaded!.format).toBe("stroke"); // a fact about the old writer, not a guess
    expect(loaded!.version).toBe(QUICK_GAME_STATE_VERSION);
    expect(loaded!.currentHole).toBe(3);
    expect((loaded as QuickStrokeState).strokes).toEqual({ p1: 6 });
    expect(loaded!.values).toEqual(v2.values);
  });

  it("an UNRECOGNIZED format is rejected, not coerced to stroke", () => {
    expect(migrateQuickGameState({ ...state(), format: "skins" })).toBeNull();
  });

  it("a half-written match (one side) is rejected rather than half-populated", () => {
    expect(migrateQuickGameState({ ...matchGame(), sideB: undefined })).toBeNull();
  });
});
