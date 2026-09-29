import { describe, it, expect } from "vitest";
import { deriveSaveState } from "./configDraft";
import { saveHintFor, STALE_HINT } from "@/components/games/SettingsSaveBar";

/**
 * PR 8 prerequisite A — the settings draft says the game changed under it BEFORE
 * Save, instead of the Save being refused as a CONFLICT after the tap.
 *
 * The rule under test: touched + a frozen base + a live hash that no longer
 * matches it = stale. Each "not stale" case sits beside a stale one that differs
 * in exactly one input, so a derivation that ignores that input fails a case.
 */

const base = { anyTouched: true, dirty: true, baselineHash: "aaaa1111", serverHash: "aaaa1111", committing: false };

describe("deriveSaveState — the server moved under the draft", () => {
  it("is STALE when the live hash has moved off the frozen base", () => {
    expect(deriveSaveState({ ...base, serverHash: "bbbb2222" })).toBe("stale");
  });

  it("…outranks ready: an edited draft that would be refused is not 'ready'", () => {
    // Same inputs as a ready draft except the hash. Save must not be offered.
    expect(deriveSaveState(base)).toBe("ready");
    expect(deriveSaveState({ ...base, serverHash: "bbbb2222" })).toBe("stale");
  });

  it("is NOT stale during our own commit — our write moves the hash first", () => {
    expect(deriveSaveState({ ...base, serverHash: "bbbb2222", committing: true })).not.toBe("stale");
  });

  it("is NOT stale when nothing was touched — the baseline self-heals then", () => {
    expect(deriveSaveState({ ...base, anyTouched: false, dirty: false, serverHash: "bbbb2222" })).toBe("clean");
  });

  it("is NOT stale before either hash is known — that is not-ready, not a conflict", () => {
    expect(deriveSaveState({ ...base, dirty: false, baselineHash: null, serverHash: "bbbb2222" })).toBe("not-ready");
    expect(deriveSaveState({ ...base, serverHash: undefined })).toBe("ready");
  });

  it("is stale even when the edit was reverted — the base itself is out of date", () => {
    // dirty=false (the draft equals the frozen base again) but the base is stale:
    // Save is off either way, and the bar should still explain the page.
    expect(deriveSaveState({ ...base, dirty: false, serverHash: "bbbb2222" })).toBe("stale");
  });
});

describe("the save bar's sentence for a stale draft", () => {
  it("is a warning that names the action — Cancel loads the latest", () => {
    const hint = saveHintFor("stale", null, false);
    expect(hint).toEqual({ text: STALE_HINT, tone: "warning" });
    expect(STALE_HINT).toMatch(/Cancel to load the latest/);
  });

  it("shows immediately — no grace period, unlike not-ready", () => {
    expect(saveHintFor("stale", null, false)).not.toBeNull();
    expect(saveHintFor("not-ready", null, false)).toBeNull();
  });
});
