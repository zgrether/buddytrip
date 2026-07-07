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

describe("registry", () => {
  it("keys are snake_case with the expected control types", () => {
    expect(MODIFIER_REGISTRY.moving_tees.controlType).toBe("checkbox");
    expect(MODIFIER_REGISTRY.glorious_holes.controlType).toBe("checkbox+stepper");
  });
  it("modifierDef soft-falls-back for an unknown key (fail soft, not crash)", () => {
    expect(modifierDef("not_a_real_key")).toEqual({ key: "not_a_real_key", label: "not_a_real_key", description: "", controlType: "checkbox" });
  });
  // P-E (§10): titles are the card wording; descriptions are Zach's mock copy with
  // NO "not-auto-scored" disclaimer (deliberate reversal of #469) — locked so it
  // can't silently drift back.
  it("labels match the card titles", () => {
    expect(MODIFIER_REGISTRY.moving_tees.label).toBe("Moving tee boxes");
    expect(MODIFIER_REGISTRY.glorious_holes.label).toBe("Glorious finishing holes");
  });
  it("descriptions carry NO auto-scored / config-only disclaimer", () => {
    for (const def of Object.values(MODIFIER_REGISTRY)) {
      expect(def.description.length).toBeGreaterThan(0);
      expect(def.description.toLowerCase()).not.toMatch(/auto-scored|config-only|rule of the day/);
    }
  });
});

// The four render branches the crossed test-matrix exercises (Task 0). Maps each
// golf format's compatibleModifiers (from gameTypes.ts) through the registry to
// the control types it would render — locking the matrix + registry together.
describe("render-branch matrix (gameTypes.ts → registry)", () => {
  const controlsFor = (id: string) =>
    (GAME_TYPES.find((t) => t.id === id)?.compatibleModifiers ?? []).map((k) => modifierDef(k).controlType);

  it("gtt_manual → [] (HIDE branch — a format with no modifiers)", () => {
    // Rack (net stroke play) now carries the stroke modifier set, so the
    // HIDE-the-row branch is exercised by a modifier-less format instead.
    expect(controlsFor("gtt_manual")).toEqual([]);
  });
  it("rack_n_stack → [checkbox, checkbox+stepper] (BOTH branch — net stroke play, like stroke)", () => {
    expect(controlsFor("gtt_rack_n_stack")).toEqual(["checkbox", "checkbox+stepper"]);
  });
  it("match_play_singles → [checkbox] (CHECKBOX-only branch)", () => {
    expect(controlsFor("gtt_match_play_singles")).toEqual(["checkbox"]);
  });
  it("match_play_doubles → [checkbox+stepper] (STEPPER-only branch)", () => {
    expect(controlsFor("gtt_match_play_doubles")).toEqual(["checkbox+stepper"]);
  });
  it("stroke_play → [checkbox, checkbox+stepper] (BOTH branch)", () => {
    expect(controlsFor("gtt_stroke_play")).toEqual(["checkbox", "checkbox+stepper"]);
  });
});

describe("presence-model read/write", () => {
  it("isModifierEnabled: presence = enabled", () => {
    expect(isModifierEnabled({ moving_tees: {} }, "moving_tees")).toBe(true);
    expect(isModifierEnabled({}, "moving_tees")).toBe(false);
  });

  it("setModifierEnabled round-trips, immutably, with correct default value", () => {
    const base: ModifiersMap = {};
    const onTees = setModifierEnabled(base, "moving_tees", true);
    expect(onTees).toEqual({ moving_tees: {} });
    expect(base).toEqual({}); // immutable

    const onGlorious = setModifierEnabled(base, "glorious_holes", true);
    expect(onGlorious).toEqual({ glorious_holes: { holes: GLORIOUS_HOLES_DEFAULT } });

    const off = setModifierEnabled(onTees, "moving_tees", false);
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
    expect(setGloriousHoles({ moving_tees: {} }, 2)).toEqual({ moving_tees: {}, glorious_holes: { holes: 2 } });
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
  const available = ["moving_tees", "glorious_holes"];

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
    expect(enabledCount({ moving_tees: {}, glorious_holes: { holes: 2 } }, available)).toBe(2);
    expect(modifiersSummary({ moving_tees: {}, glorious_holes: { holes: 2 } }, available)).toBe(
      "Moving tee boxes · Glorious finishing holes (last 2)"
    );
  });
  it("ignores enabled keys that are not in the applicable set", () => {
    expect(enabledCount({ some_other: {} }, available)).toBe(0);
  });
});
