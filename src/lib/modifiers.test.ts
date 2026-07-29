import { describe, it, expect } from "vitest";
import {
  MODIFIER_REGISTRY,
  modifierDef,
  isModifierEnabled,
  setModifierEnabled,
  gloriousHolesCount,
  setGloriousHoles,
  clampGloriousHoles,
  enabledCount,
  modifiersSummary,
  GLORIOUS_HOLES_DEFAULT,
  GLORIOUS_HOLES_MIN,
  GLORIOUS_HOLES_MAX,
  type ModifiersMap,
} from "./modifiers";
import { GAME_TYPES } from "./gameTypes";

// W-GAMEPAGE-01 §6.5 — config-only modifiers. Presence-model jsonb, snake_case
// keys, applicability from gameTypes.ts (NOT the deprecated DB column). These
// lock the registry + the crossed test-matrix (Task 0) + the legacy-tolerant
// read so existing production rows don't break.
//
// A NOTE ON THE PLACEHOLDER KEY BELOW. Several of these tests are about the
// GENERIC presence-model mechanism, not about any particular modifier, and used
// to use `moving_tees` as their second key. That modifier has been removed (see
// the regression block), so they use an obviously-fictional key instead — using
// a real-looking name for a modifier that doesn't exist is how a removed concept
// reads its way back into the codebase.
const OTHER_KEY = "placeholder_modifier";

describe("registry", () => {
  it("keys are snake_case with the expected control types", () => {
    expect(MODIFIER_REGISTRY.glorious_holes.controlType).toBe("checkbox+stepper");
  });
  it("modifierDef soft-falls-back for an unknown key (fail soft, not crash)", () => {
    expect(modifierDef("not_a_real_key")).toEqual({ key: "not_a_real_key", label: "not_a_real_key", description: "", controlType: "checkbox" });
  });
  // P-E (§10): titles are the card wording; descriptions are Zach's mock copy with
  // NO "not-auto-scored" disclaimer (deliberate reversal of #469) — locked so it
  // can't silently drift back.
  it("labels match the card titles", () => {
    expect(MODIFIER_REGISTRY.glorious_holes.label).toBe("Glorious finishing holes");
  });
  it("descriptions carry NO auto-scored / config-only disclaimer", () => {
    for (const def of Object.values(MODIFIER_REGISTRY)) {
      expect(def.description.length).toBeGreaterThan(0);
      expect(def.description.toLowerCase()).not.toMatch(/auto-scored|config-only|rule of the day/);
    }
  });
});

// REGRESSION — `moving_tees` was removed. It was never specified and nothing ever
// read the key it wrote (no compute path, unlike glorious_holes' gloriousHoles.ts),
// yet it was offered as a selectable checkbox on all three golf formats: UI with no
// backing. The feature itself stays a nomination in DEFERRED.md; if it comes back it
// comes back WITH a compute path, and these assertions are what should be updated
// then — deliberately, not by accident.
describe("moving_tees is gone (unbacked UI, removed)", () => {
  it("is not in the registry", () => {
    expect(MODIFIER_REGISTRY).not.toHaveProperty("moving_tees");
  });
  it("is offered by no game type", () => {
    for (const t of GAME_TYPES) {
      expect(t.compatibleModifiers ?? []).not.toContain("moving_tees");
    }
  });
  it("a game row that still stores the key is simply not shown it (fail soft)", () => {
    // The one production row carrying `moving_tees` keeps the jsonb key until its
    // next settings Save clean-replaces the column. Every consumer filters by the
    // APPLICABLE set, so a stored-but-unoffered key contributes nothing.
    const stored: ModifiersMap = { moving_tees: {}, glorious_holes: { holes: 1 } };
    const available = GAME_TYPES.find((t) => t.id === "gtt_match_play")!.compatibleModifiers ?? [];
    expect(enabledCount(stored, available)).toBe(1);
    expect(modifiersSummary(stored, available)).toBe("Glorious finishing holes (last 1)");
  });
});

// The modifier matrix (gameTypes.ts) mapped through the registry to the control types
// each format renders — locking applicability + registry together. Both render branches
// are still exercised: HIDE (non-golf, stroke, rack — all now `[]`) and the
// checkbox+stepper card (match play, the one format with a modifier left).
describe("render-branch matrix (gameTypes.ts → registry)", () => {
  const controlsFor = (id: string) =>
    (GAME_TYPES.find((t) => t.id === id)?.compatibleModifiers ?? []).map((k) => modifierDef(k).controlType);

  it("non-golf (gtt_manual) → [] (HIDE branch — no modifiers apply)", () => {
    expect(controlsFor("gtt_manual")).toEqual([]);
  });
  it("rack_n_stack → [] (HIDE — moving_tees removed was its only one)", () => {
    expect(controlsFor("gtt_rack_n_stack")).toEqual([]);
  });
  it("stroke_play → [] (HIDE — glorious is match-play only; moving_tees removed)", () => {
    expect(controlsFor("gtt_stroke_play")).toEqual([]);
  });
  it("match_play → [checkbox+stepper] (the one live Modifiers row — glorious)", () => {
    expect(controlsFor("gtt_match_play")).toEqual(["checkbox+stepper"]);
  });
});

describe("presence-model read/write", () => {
  it("isModifierEnabled: presence = enabled", () => {
    expect(isModifierEnabled({ [OTHER_KEY]: {} }, OTHER_KEY)).toBe(true);
    expect(isModifierEnabled({}, OTHER_KEY)).toBe(false);
  });

  it("setModifierEnabled round-trips, immutably, with correct default value", () => {
    const base: ModifiersMap = {};
    const onOther = setModifierEnabled(base, OTHER_KEY, true);
    expect(onOther).toEqual({ [OTHER_KEY]: {} }); // no config → {}
    expect(base).toEqual({}); // immutable

    const onGlorious = setModifierEnabled(base, "glorious_holes", true);
    expect(onGlorious).toEqual({ glorious_holes: { holes: GLORIOUS_HOLES_DEFAULT } });

    const off = setModifierEnabled(onOther, OTHER_KEY, false);
    expect(off).toEqual({}); // absence = disabled
  });
});

describe("gloriousHolesCount — legacy-tolerant", () => {
  it("legacy production shape glorious_holes:{} reads as the default 3", () => {
    expect(gloriousHolesCount({ glorious_holes: {} })).toBe(GLORIOUS_HOLES_DEFAULT);
  });
  it("reads an explicit holes value", () => {
    expect(gloriousHolesCount({ glorious_holes: { holes: 5 } })).toBe(5);
  });
  it("clamps an out-of-range stored value", () => {
    expect(gloriousHolesCount({ glorious_holes: { holes: 99 } })).toBe(GLORIOUS_HOLES_MAX);
    expect(gloriousHolesCount({ glorious_holes: { holes: 0 } })).toBe(GLORIOUS_HOLES_MIN);
  });
  it("defaults for a disabled key (the value the stepper opens at)", () => {
    expect(gloriousHolesCount({})).toBe(GLORIOUS_HOLES_DEFAULT);
  });
});

describe("setGloriousHoles", () => {
  it("enables the key and sets a clamped holes value", () => {
    expect(setGloriousHoles({}, 4)).toEqual({ glorious_holes: { holes: 4 } });
    expect(setGloriousHoles({}, 99)).toEqual({ glorious_holes: { holes: GLORIOUS_HOLES_MAX } });
  });
  it("preserves other modifiers", () => {
    expect(setGloriousHoles({ [OTHER_KEY]: {} }, 2)).toEqual({ [OTHER_KEY]: {}, glorious_holes: { holes: 2 } });
  });
});

describe("clampGloriousHoles", () => {
  it("rounds, bounds, and guards NaN", () => {
    expect(clampGloriousHoles(3.4)).toBe(3);
    expect(clampGloriousHoles(-5)).toBe(GLORIOUS_HOLES_MIN);
    expect(clampGloriousHoles(1000)).toBe(GLORIOUS_HOLES_MAX);
    expect(clampGloriousHoles(NaN)).toBe(GLORIOUS_HOLES_DEFAULT);
  });
});

describe("summary + count (row resolved/unresolved drivers)", () => {
  const available = [OTHER_KEY, "glorious_holes"];

  it("none enabled → count 0, 'None added' (row stays unresolved — no false check)", () => {
    expect(enabledCount({}, available)).toBe(0);
    expect(modifiersSummary({}, available)).toBe("None added");
  });
  it("glorious_holes shows its trailing-hole count", () => {
    expect(modifiersSummary({ glorious_holes: { holes: 4 } }, available)).toBe("Glorious finishing holes (last 4)");
  });
  it("legacy glorious_holes:{} summarizes with the default", () => {
    expect(modifiersSummary({ glorious_holes: {} }, available)).toBe("Glorious finishing holes (last 3)");
  });
  it("multiple enabled join in the available order", () => {
    expect(enabledCount({ [OTHER_KEY]: {}, glorious_holes: { holes: 2 } }, available)).toBe(2);
    // An unregistered key falls back to its own name as the label (modifierDef's
    // fail-soft), which is exactly what the multi-key join is being checked for.
    expect(modifiersSummary({ [OTHER_KEY]: {}, glorious_holes: { holes: 2 } }, available)).toBe(
      `${OTHER_KEY} · Glorious finishing holes (last 2)`
    );
  });
  it("ignores enabled keys that are not in the applicable set", () => {
    expect(enabledCount({ some_other: {} }, available)).toBe(0);
  });
});
