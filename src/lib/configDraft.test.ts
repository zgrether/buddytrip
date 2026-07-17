import { describe, it, expect } from "vitest";
import {
  configToDraft,
  configDraftToPayload,
  configDraftsEqual,
  isDraftMatchFilled,
  splitHandicap,
  configToRackDraft,
  rackDraftToPayload,
  rackDraftsEqual,
  configToStrokeDraft,
  strokeDraftToPayload,
  strokeDraftsEqual,
  type ConfigDraft,
  type DraftMatchInput,
  type RackConfigDraft,
  type StrokeConfigDraft,
} from "./configDraft";

/**
 * configDraft — the pure core of the draft-then-save settings model. These lock
 * the two properties the whole refactor rides on: (1) the dirty check is exact
 * (so Save enables iff something really changed), and (2) the payload derives the
 * even share / handicap distribution from the FINAL draft (so nothing stale is
 * written), and only fully-filled matches are persisted.
 */

const GAME = {
  game_type_id: "gtt_match_play",
  name: "Front 9 Match",
  rules_for_today: "no gimmes",
  scoring_enabled: false,
  entry_mode: "score",
  modifiers: { glorious_holes: { holes: 3 } },
  points_total: 6,
  points_distribution: { type: "per_match", value: 3 } as const,
  course_id: "course-1",
  scorecard_schema: { units: { count: 18 } },
};

const MATCHES: DraftMatchInput[] = [
  { matchNumber: 1, playersPerSide: 1, a: ["u1"], b: ["u2"], handicap: -2, pointValue: null },
  { matchNumber: 2, playersPerSide: 2, a: ["u3", "u4"], b: ["u5", "u6"], handicap: 0, pointValue: null },
];

describe("configToDraft — baseline", () => {
  it("maps every field and is stable (equal to itself)", () => {
    const d = configToDraft(GAME, MATCHES, ["u9"]);
    expect(d.name).toBe("Front 9 Match");
    expect(d.rulesForToday).toBe("no gimmes");
    expect(d.scoringEnabled).toBe(false);
    expect(d.entryMode).toBe("score");
    expect(d.pointsTotal).toBe(6);
    expect(d.course.id).toBe("course-1");
    expect(d.delegates).toEqual(["u9"]);
    expect(d.matches).toHaveLength(2);
    expect(configDraftsEqual(d, configToDraft(GAME, MATCHES, ["u9"]))).toBe(true);
  });

  it("applies neutral defaults for an unconfigured game", () => {
    const d = configToDraft({}, [], []);
    expect(d).toMatchObject({
      name: "",
      rulesForToday: null,
      scoringEnabled: false,
      entryMode: "score",
      modifiers: {},
      pointsTotal: null,
      pointsDistribution: null,
      matches: [],
      delegates: [],
    });
    expect(d.course).toEqual({ id: null, backId: null, scorecardSchema: null });
  });

  it("sorts delegates so order-only differences aren't dirty", () => {
    expect(configToDraft({}, [], ["b", "a"]).delegates).toEqual(["a", "b"]);
    expect(configDraftsEqual(configToDraft({}, [], ["b", "a"]), configToDraft({}, [], ["a", "b"]))).toBe(true);
  });
});

describe("configDraftsEqual — dirty check", () => {
  const base = configToDraft(GAME, MATCHES, ["u9"]);
  const clone = (fn: (d: ConfigDraft) => void): ConfigDraft => {
    const d: ConfigDraft = JSON.parse(JSON.stringify(base));
    fn(d);
    return d;
  };

  it("trailing whitespace on name / rules is NOT dirty", () => {
    expect(configDraftsEqual(base, clone((d) => { d.name = "Front 9 Match  "; }))).toBe(true);
    expect(configDraftsEqual(base, clone((d) => { d.rulesForToday = "no gimmes\n"; }))).toBe(true);
  });

  it("catches a changed name / total / scoring flag / entry mode", () => {
    expect(configDraftsEqual(base, clone((d) => { d.name = "Back 9"; }))).toBe(false);
    expect(configDraftsEqual(base, clone((d) => { d.pointsTotal = 8; }))).toBe(false);
    expect(configDraftsEqual(base, clone((d) => { d.scoringEnabled = true; }))).toBe(false);
    expect(configDraftsEqual(base, clone((d) => { d.entryMode = "outcome"; }))).toBe(false);
  });

  it("catches a match edit — roster, handicap, override, add/remove", () => {
    expect(configDraftsEqual(base, clone((d) => { d.matches[0].a = ["uX"]; }))).toBe(false);
    expect(configDraftsEqual(base, clone((d) => { d.matches[0].handicap = 3; }))).toBe(false);
    expect(configDraftsEqual(base, clone((d) => { d.matches[0].pointValue = 4; }))).toBe(false);
    expect(configDraftsEqual(base, clone((d) => { d.matches.pop(); }))).toBe(false);
  });

  it("modifier presence is key-order-independent but content-sensitive", () => {
    expect(configDraftsEqual(base, clone((d) => { d.modifiers = { glorious_holes: { holes: 3 } }; }))).toBe(true);
    expect(configDraftsEqual(base, clone((d) => { d.modifiers = { glorious_holes: { holes: 5 } }; }))).toBe(false);
    expect(configDraftsEqual(base, clone((d) => { d.modifiers = {}; }))).toBe(false);
  });

  it("a delegate add/remove is dirty", () => {
    expect(configDraftsEqual(base, clone((d) => { d.delegates = ["u9", "u10"]; }))).toBe(false);
    expect(configDraftsEqual(base, clone((d) => { d.delegates = []; }))).toBe(false);
  });

  // W-9HOLE-01: composing / swapping / dropping a back nine moves ONLY back_course_id
  // when the two nines happen to share a schema shape — so the dirty check has to
  // compare it, or Save would stay disabled on a real back-nine edit.
  it("a back-nine compose / swap / drop is dirty", () => {
    expect(configDraftsEqual(base, clone((d) => { d.course.backId = "back-1"; }))).toBe(false);
    const composed = clone((d) => { d.course.backId = "back-1"; });
    expect(configDraftsEqual(composed, clone((d) => { d.course.backId = "back-2"; }))).toBe(false);
    expect(configDraftsEqual(composed, base)).toBe(false);
  });
});

describe("configDraftToPayload — derived write", () => {
  it("writes only fully-filled matches", () => {
    const d = configToDraft(GAME, [
      ...MATCHES,
      { matchNumber: 3, playersPerSide: 1, a: ["u7"], b: [], handicap: 0, pointValue: null }, // half-filled
    ], []);
    const p = configDraftToPayload(d);
    expect(p.matches!.map((m) => m.matchNumber)).toEqual([1, 2]); // #3 dropped
  });

  it("distributes the signed handicap onto the winning side", () => {
    const p = configDraftToPayload(configToDraft(GAME, MATCHES, []));
    expect(p.matches![0]).toMatchObject({ strokesA: 2, strokesB: 0 }); // -2 → A gets 2
    expect(p.matches![1]).toMatchObject({ strokesA: 0, strokesB: 0 }); // even
  });

  it("recomputes the even share from the FINAL filled-match count", () => {
    // total 6, one match overridden to 4 → other match takes the 2 remainder
    const d = configToDraft(GAME, [
      { ...MATCHES[0], pointValue: 4 },
      { ...MATCHES[1], pointValue: null },
    ], []);
    const p = configDraftToPayload(d);
    expect(p.pointsDistribution).toEqual({ type: "per_match", value: 2 });
  });

  it("even share reflects match COUNT, not the stale server denominator", () => {
    // total 6 across 3 non-overridden matches → 2 each (the landmine: a stale
    // matchCount of 2 would have written 3).
    const three: DraftMatchInput[] = [
      { matchNumber: 1, playersPerSide: 1, a: ["u1"], b: ["u2"], handicap: 0, pointValue: null },
      { matchNumber: 2, playersPerSide: 1, a: ["u3"], b: ["u4"], handicap: 0, pointValue: null },
      { matchNumber: 3, playersPerSide: 1, a: ["u5"], b: ["u6"], handicap: 0, pointValue: null },
    ];
    const p = configDraftToPayload(configToDraft(GAME, three, []));
    expect(p.pointsDistribution).toEqual({ type: "per_match", value: 2 });
  });

  it("passes a placement distribution through untouched", () => {
    const d = configToDraft(
      { ...GAME, points_distribution: { type: "placement", values: [5, 3, 1] } },
      MATCHES,
      []
    );
    expect(configDraftToPayload(d).pointsDistribution).toEqual({ type: "placement", values: [5, 3, 1] });
  });

  it("ESTABLISHES the per_match share on first setup (distribution still null)", () => {
    // The reconcile effect that used to seed this is gone; without establishing it
    // here a first Save would write a total with nothing to award against
    // (`point_value ?? points_distribution.value` → null).
    const d = configToDraft({ ...GAME, points_distribution: null }, MATCHES, []);
    expect(configDraftToPayload(d).pointsDistribution).toEqual({ type: "per_match", value: 3 });
  });

  it("does NOT invent a per_match share for a non-match-play format", () => {
    const d = configToDraft(
      { ...GAME, game_type_id: "gtt_stroke_play", points_distribution: null },
      MATCHES,
      []
    );
    expect(configDraftToPayload(d).pointsDistribution).toBeNull();
  });

  it("matchesStructureDirty is false when the match SET is untouched", () => {
    const base = configToDraft(GAME, MATCHES, []);
    const same = configToDraft(GAME, MATCHES, []);
    expect(configDraftToPayload(same, base).matchesStructureDirty).toBe(false);
    // An edit elsewhere (points) still leaves the MATCH set clean.
    same.pointsTotal = 12;
    expect(configDraftToPayload(same, base).matchesStructureDirty).toBe(false);
  });

  it("matchesStructureDirty is true on a SET change, and when no baseline is given", () => {
    const base = configToDraft(GAME, MATCHES, []);
    const edited = configToDraft(GAME, MATCHES, []);
    edited.matches[0].a = ["uX"]; // roster changed = structure
    expect(configDraftToPayload(edited, base).matchesStructureDirty).toBe(true);
    // No baseline → conservatively claim dirty (the RPC then clean-replaces).
    expect(configDraftToPayload(base).matchesStructureDirty).toBe(true);
  });

  // THE SPLIT: a field-only edit (handicap / point override) is NOT structure-dirty —
  // it persists in place, allowed with scores (warned tier). This is what unblocks
  // Handicaps + Point Distribution from the HAS_SCORES refusal.
  it("a handicap or point-override edit is NOT structure-dirty (same set, field differs)", () => {
    const base = configToDraft(GAME, MATCHES, []);
    const hcap = configToDraft(GAME, MATCHES, []);
    hcap.matches[0].handicap = 5; // was -2
    expect(configDraftToPayload(hcap, base).matchesStructureDirty).toBe(false);

    const pts = configToDraft(GAME, MATCHES, []);
    pts.matches[0].pointValue = 9;
    expect(configDraftToPayload(pts, base).matchesStructureDirty).toBe(false);

    // ...but the whole-page dirty check (Save-enabled) STILL sees them as changes.
    expect(configDraftsEqual(base, hcap)).toBe(false);
    expect(configDraftsEqual(base, pts)).toBe(false);

    // And the payload still carries the new field values for the in-place write.
    // handicap = 5 (positive → side B gets the strokes; splitHandicap).
    expect(configDraftToPayload(hcap, base).matches![0].strokesB).toBe(5);
    expect(configDraftToPayload(hcap, base).matches![0].strokesA).toBe(0);
    expect(configDraftToPayload(pts, base).matches![0].pointValue).toBe(9);
  });

  it("trims name / rules and passes course snapshot through", () => {
    const d = configToDraft({ ...GAME, name: "  Trim Me  ", rules_for_today: "  " }, MATCHES, []);
    const p = configDraftToPayload(d);
    expect(p.name).toBe("Trim Me");
    expect(p.rulesForToday).toBe(null); // whitespace-only → null
    expect(p.scorecardSchema).toEqual({ units: { count: 18 } });
  });

  // The back ref rides the payload in lockstep with courseId: a composed two-nines
  // 18 has to round-trip it (else the back-nine identity is stranded), and clearing
  // the course has to null it (else a stale ref renders a phantom back nine).
  it("carries the back-nine ref alongside the course", () => {
    const composed = configToDraft({ ...GAME, back_course_id: "back-1" }, MATCHES, []);
    expect(composed.course.backId).toBe("back-1");
    expect(configDraftToPayload(composed).backCourseId).toBe("back-1");

    const cleared = configToDraft({ ...GAME, course_id: null, back_course_id: null, scorecard_schema: null }, MATCHES, []);
    const p = configDraftToPayload(cleared);
    expect(p.courseId).toBe(null);
    expect(p.backCourseId).toBe(null);
    expect(p.scorecardSchema).toBe(null);
  });
});

describe("small pure helpers", () => {
  it("isDraftMatchFilled requires both sides at full strength", () => {
    expect(isDraftMatchFilled({ matchNumber: 1, playersPerSide: 2, a: ["x", "y"], b: ["z", "w"], handicap: 0, pointValue: null })).toBe(true);
    expect(isDraftMatchFilled({ matchNumber: 1, playersPerSide: 2, a: ["x", "y"], b: ["z"], handicap: 0, pointValue: null })).toBe(false);
  });

  it("splitHandicap directs strokes by sign", () => {
    expect(splitHandicap(-3)).toEqual({ strokesA: 3, strokesB: 0 });
    expect(splitHandicap(3)).toEqual({ strokesA: 0, strokesB: 3 });
    expect(splitHandicap(0)).toEqual({ strokesA: 0, strokesB: 0 });
  });
});

// ── Rack variant (P2) ──────────────────────────────────────────────────────────
const RACK_GAME = {
  game_type_id: "gtt_rack_n_stack",
  name: "Team Rack",
  rules_for_today: null,
  scoring_enabled: false,
  points_total: 6,
  points_distribution: { type: "per_match", value: 1.2 } as const,
  course_id: "course-1",
  back_course_id: null,
  scorecard_schema: { units: { count: 18 } },
};
const GROUPS = [["u1", "u2"], ["u3", "u4"]];
const STROKES = { u1: 3, u3: 0 };

describe("configToRackDraft — baseline", () => {
  it("folds groups + strokes + course over the base and is stable", () => {
    const d = configToRackDraft(RACK_GAME, GROUPS, STROKES, ["u9"]);
    expect(d.groups).toEqual(GROUPS);
    expect(d.strokes).toEqual(STROKES);
    expect(d.course).toEqual({ id: "course-1", backId: null, scorecardSchema: { units: { count: 18 } } });
    expect(d.pointsTotal).toBe(6);
    expect(d.delegates).toEqual(["u9"]);
    expect(rackDraftsEqual(d, configToRackDraft(RACK_GAME, GROUPS, STROKES, ["u9"]))).toBe(true);
  });
});

describe("rackDraftToPayload — derived per-slot + structure flag", () => {
  const base = configToRackDraft(RACK_GAME, GROUPS, STROKES, []);

  it("derives the per-slot share from total ÷ slotCount (NOT roster size)", () => {
    // 2 carts, 4 players, but slotCount = min(A,B) = 2 → 6/2 = 3 (passed in, not roster).
    const p = rackDraftToPayload(base, 2, base);
    expect(p.pointsDistribution).toEqual({ type: "per_match", value: 3 });
  });

  it("emits every grouped participant's strokes (default 0) + names the carts", () => {
    const p = rackDraftToPayload(base, 2, base);
    expect(p.groups).toEqual([
      { name: "Group 1", userIds: ["u1", "u2"] },
      { name: "Group 2", userIds: ["u3", "u4"] },
    ]);
    expect(p.participants).toEqual([
      { userId: "u1", strokes: 3 }, { userId: "u2", strokes: 0 },
      { userId: "u3", strokes: 0 }, { userId: "u4", strokes: 0 },
    ]);
  });

  it("groupsStructureDirty is false vs an identical baseline, true on a membership change", () => {
    expect(rackDraftToPayload(base, 2, base).groupsStructureDirty).toBe(false);
    const moved: RackConfigDraft = { ...base, groups: [["u1", "u3"], ["u2", "u4"]] };
    expect(rackDraftToPayload(moved, 2, base).groupsStructureDirty).toBe(true);
  });

  it("drops empty carts (an unfinished add) from the payload", () => {
    const withEmpty: RackConfigDraft = { ...base, groups: [["u1", "u2"], []] };
    expect(rackDraftToPayload(withEmpty, 1, base).groups).toEqual([{ name: "Group 1", userIds: ["u1", "u2"] }]);
  });
});

describe("rackDraftsEqual — dirty check", () => {
  const base = configToRackDraft(RACK_GAME, GROUPS, STROKES, []);
  it("equal to itself; player order WITHIN a cart doesn't matter (a cart is a set)", () => {
    expect(rackDraftsEqual(base, base)).toBe(true);
    expect(rackDraftsEqual(base, { ...base, groups: [["u2", "u1"], ["u3", "u4"]] })).toBe(true);
  });
  it("dirty on a membership move, a stroke change, a points change, or a course change", () => {
    expect(rackDraftsEqual(base, { ...base, groups: [["u1", "u3"], ["u2", "u4"]] })).toBe(false);
    expect(rackDraftsEqual(base, { ...base, strokes: { ...STROKES, u1: 5 } })).toBe(false);
    expect(rackDraftsEqual(base, { ...base, pointsTotal: 8 })).toBe(false);
    expect(rackDraftsEqual(base, { ...base, course: { ...base.course, id: "course-2" } })).toBe(false);
  });
});

// ── Stroke variant (P2) ────────────────────────────────────────────────────────
const STROKE_GAME = {
  game_type_id: "gtt_stroke_play",
  name: "Saturday Round",
  rules_for_today: null,
  scoring_enabled: false,
  points_total: 8,
  points_distribution: { type: "placement" as const, values: [6, 4, 2] },
  modifiers: { moving_tees: {} },
  course_id: "course-1",
  back_course_id: null,
  scorecard_schema: { units: { count: 18 } },
};
const STROKE_STROKES = { u1: 4, u2: 0 };

describe("configToStrokeDraft — baseline", () => {
  it("folds strokes + modifiers + course over the base and is stable", () => {
    const d = configToStrokeDraft(STROKE_GAME, STROKE_STROKES, ["u9"]);
    expect(d.strokes).toEqual(STROKE_STROKES);
    expect(d.modifiers).toEqual({ moving_tees: {} });
    expect(d.course).toEqual({ id: "course-1", backId: null, scorecardSchema: { units: { count: 18 } } });
    expect(strokeDraftsEqual(d, configToStrokeDraft(STROKE_GAME, STROKE_STROKES, ["u9"]))).toBe(true);
  });
});

describe("strokeDraftToPayload — placement passthrough, explicit modifiers, no groups", () => {
  const base = configToStrokeDraft(STROKE_GAME, STROKE_STROKES, []);
  it("passes placement points through untouched (owner-authored, not derived)", () => {
    expect(strokeDraftToPayload(base).pointsDistribution).toEqual({ type: "placement", values: [6, 4, 2] });
    expect(strokeDraftToPayload(base).pointsTotal).toBe(8);
  });
  it("sends modifiers EXPLICITLY (the RPC wipes a missing key to {})", () => {
    expect(strokeDraftToPayload(base).modifiers).toEqual({ moving_tees: {} });
  });
  it("emits every participant's strokes and NO groups/matches keys", () => {
    const p = strokeDraftToPayload(base);
    expect(p.participants).toEqual([{ userId: "u1", strokes: 4 }, { userId: "u2", strokes: 0 }]);
    expect(p).not.toHaveProperty("groups");
    expect(p).not.toHaveProperty("matches");
    expect(p.courseId).toBe("course-1");
  });
});

describe("strokeDraftsEqual — dirty check", () => {
  const base = configToStrokeDraft(STROKE_GAME, STROKE_STROKES, []);
  it("equal to itself; dirty on a stroke, modifier, points, or course change", () => {
    expect(strokeDraftsEqual(base, base)).toBe(true);
    expect(strokeDraftsEqual(base, { ...base, strokes: { ...STROKE_STROKES, u1: 6 } })).toBe(false);
    expect(strokeDraftsEqual(base, { ...base, modifiers: {} })).toBe(false);
    expect(strokeDraftsEqual(base, { ...base, pointsTotal: 10 } as StrokeConfigDraft)).toBe(false);
    expect(strokeDraftsEqual(base, { ...base, course: { ...base.course, id: "course-2" } })).toBe(false);
  });
});
