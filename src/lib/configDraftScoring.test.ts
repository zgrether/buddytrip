import { describe, it, expect } from "vitest";
import {
  configToStrokeDraft,
  scoringToDraft,
  strokeDraftToPayload,
  strokeDraftsEqual,
  type StrokeConfigDraft,
} from "./configDraft";
import { STABLEFORD_PRESETS, scoringOf } from "./stableford";

/**
 * The SCORING TYPE draft slice — `games.config` ⇄ the stroke settings draft.
 *
 * ── The wrong builds these exist to fail ───────────────────────────────────
 *
 *   · THE SNAPSHOT NEVER CARRIES `config`. `ConfigGameSnapshot.config` is
 *     optional, so a view that forgets to pass it compiles perfectly and every
 *     game reads Traditional forever — the settings page would show Traditional
 *     on a Stableford game and silently rewrite it on the next Save. Nothing
 *     about that is visible in a type check or a diff.
 *   · TRADITIONAL OMITS THE KEY. The RPC COALESCE-PRESERVES `config`, so a
 *     payload that drops it when the type is Traditional makes "switch back to
 *     Traditional" a no-op that reports success. The user picks Traditional,
 *     saves, and the game stays Stableford.
 *   · EQUALITY IGNORES THE RUBRIC. Editing a bucket value would leave the page
 *     saying "All changes saved" over an unsaved edit — the staged-state lie
 *     (#18) in its quietest form, since nothing on screen contradicts it.
 *   · THE STORED PRESET LABEL IS BELIEVED over the numbers, so a row whose
 *     values were edited but whose `preset` was not lights the wrong tile.
 */

const BBMI = STABLEFORD_PRESETS.bbmi_2024.rubric;
const STANDARD = STABLEFORD_PRESETS.standard.rubric;

const GAME = {
  game_type_id: "gtt_stroke_play",
  name: "Saturday Round",
  rules_for_today: null,
  scoring_enabled: false,
  points_total: 8,
  points_distribution: { type: "placement" as const, values: [6, 4, 2] },
  modifiers: {},
  course_id: "course-1",
  back_course_id: null,
  scorecard_schema: { units: { count: 18 } },
};
const draftOf = (config?: unknown) =>
  configToStrokeDraft({ ...GAME, config }, { u1: 0 }, [["u1"]], []);

describe("scoringToDraft — reading games.config", () => {
  it("an EMPTY config is Traditional with no rubric", () => {
    // Every game that exists today. Reading these as anything else would
    // rescore the app's whole history.
    expect(scoringToDraft({})).toEqual({ type: "traditional", stableford: null });
    expect(scoringToDraft(null)).toEqual({ type: "traditional", stableford: null });
    expect(scoringToDraft(undefined)).toEqual({ type: "traditional", stableford: null });
  });

  it("recognises each preset from its NUMBERS", () => {
    for (const id of ["standard", "modified", "bbmi_2024"] as const) {
      const r = STABLEFORD_PRESETS[id].rubric;
      const d = scoringToDraft({ scoringType: "stableford", stableford: { preset: id, ...r } });
      expect(d.type).toBe("stableford");
      expect(d.stableford?.preset, id).toBe(id);
    }
  });

  it("an EDITED rubric reads as Custom even when the stored label says otherwise", () => {
    // The label is a hint, never the authority. A row saved as `bbmi_2024` and
    // then hand-edited must light Custom, or the panel claims the game scores
    // by a preset it does not.
    const edited = { ...BBMI, points: [9, 6, 4, 2, 1, 1] };
    const d = scoringToDraft({ scoringType: "stableford", stableford: { preset: "bbmi_2024", ...edited } });
    expect(d.stableford?.preset).toBe("custom");
    expect(d.stableford?.points).toEqual([9, 6, 4, 2, 1, 1]);
  });

  it("recovers the preset when the LABEL is missing but the numbers match", () => {
    const d = scoringToDraft({ scoringType: "stableford", stableford: { ...BBMI } });
    expect(d.stableford?.preset).toBe("bbmi_2024");
  });

  it("a MALFORMED rubric falls back to Traditional", () => {
    const d = scoringToDraft({ scoringType: "stableford", stableford: { ceiling: -2, floor: 3, points: [9, 6] } });
    expect(d).toEqual({ type: "traditional", stableford: null });
  });
});

describe("configToStrokeDraft carries the scoring slice", () => {
  it("reads a Stableford game as Stableford", () => {
    // THE SILENT CASE. `config` is optional on the snapshot, so a caller that
    // never passes it compiles and reads Traditional forever.
    const d = draftOf({ scoringType: "stableford", stableford: { preset: "bbmi_2024", ...BBMI } });
    expect(d.scoring.type).toBe("stableford");
    expect(d.scoring.stableford).toEqual({ preset: "bbmi_2024", ...BBMI });
  });

  it("reads a game with no config as Traditional", () => {
    expect(draftOf(undefined).scoring).toEqual({ type: "traditional", stableford: null });
  });

  it("is stable — the same snapshot twice is equal", () => {
    const cfg = { scoringType: "stableford", stableford: { preset: "standard", ...STANDARD } };
    expect(strokeDraftsEqual(draftOf(cfg), draftOf(cfg))).toBe(true);
  });
});

describe("strokeDraftToPayload — the scoring slice is ALWAYS sent", () => {
  it("emits the rubric for a Stableford draft", () => {
    const d = draftOf({ scoringType: "stableford", stableford: { preset: "bbmi_2024", ...BBMI } });
    const p = strokeDraftToPayload(d);
    expect(p.config).toBeDefined();
    // Round-trips through the SAME reader the server uses, so the payload and
    // the persisted meaning cannot drift.
    expect(scoringOf(p.config)).toEqual({ type: "stableford", rubric: BBMI });
  });

  it("emits an explicit Traditional rather than omitting the key", () => {
    // The RPC COALESCE-PRESERVES an absent `config`. Omitting it here would make
    // "switch back to Traditional" a save that reports success and changes
    // nothing — the user picks Traditional and the game stays Stableford.
    const p = strokeDraftToPayload(draftOf(undefined));
    expect(p.config).toEqual({ scoringType: "traditional" });
    expect(p.config).not.toBeUndefined();
  });

  it("a Stableford→Traditional switch emits Traditional", () => {
    const from = draftOf({ scoringType: "stableford", stableford: { preset: "bbmi_2024", ...BBMI } });
    const to: StrokeConfigDraft = { ...from, scoring: { type: "traditional", stableford: null } };
    expect(scoringOf(strokeDraftToPayload(to).config)).toEqual({ type: "traditional", rubric: null });
  });
});

describe("strokeDraftsEqual sees the whole scoring slice", () => {
  const base = draftOf({ scoringType: "stableford", stableford: { preset: "bbmi_2024", ...BBMI } });

  it("a TYPE change is dirty", () => {
    const next: StrokeConfigDraft = { ...base, scoring: { type: "traditional", stableford: null } };
    expect(strokeDraftsEqual(base, next)).toBe(false);
  });

  it("a RUBRIC-VALUE change is dirty", () => {
    // The case a type-only comparison misses, and the one that makes the Save
    // bar lie about an edit the user can see on screen.
    const next: StrokeConfigDraft = {
      ...base,
      scoring: { type: "stableford", stableford: { ...base.scoring.stableford!, points: [9, 6, 4, 2, 1, 1] } },
    };
    expect(strokeDraftsEqual(base, next)).toBe(false);
  });

  it("an EDGE change is dirty", () => {
    const next: StrokeConfigDraft = {
      ...base,
      scoring: { type: "stableford", stableford: { ...base.scoring.stableford!, floor: 4, points: [9, 6, 4, 2, 1, 0, 0] } },
    };
    expect(strokeDraftsEqual(base, next)).toBe(false);
  });

  it("an untouched draft is clean", () => {
    expect(strokeDraftsEqual(base, draftOf({ scoringType: "stableford", stableford: { preset: "bbmi_2024", ...BBMI } }))).toBe(true);
  });
});
