import { describe, it, expect } from "vitest";
import { draftLostToLock } from "./pickemLifecycle";

/**
 * The draft the lock caught — the condition, not the banner.
 *
 * An effect cannot be reached by `renderToStaticMarkup`, so the sheet's wiring
 * is verified in the browser and the DECISION is pinned here. That split is the
 * honest one: this is the part that can be wrong quietly.
 */
describe("draftLostToLock", () => {
  it("fires on the EDGE — editable true→false with unsaved changes", () => {
    expect(draftLostToLock({ wasEditable: true, editable: false, dirty: true })).toBe(true);
  });

  it("does NOT fire when the sheet was already closed", () => {
    // Opening a locked sheet is not losing anything. Without this the banner
    // would greet every reader of a locked game.
    expect(draftLostToLock({ wasEditable: false, editable: false, dirty: true })).toBe(false);
  });

  it("does NOT fire when there was nothing unsaved", () => {
    // The common case by far: the deadline lands on a sheet already saved.
    // Reporting a loss there would be a false alarm, which teaches people to
    // ignore the true one.
    expect(draftLostToLock({ wasEditable: true, editable: false, dirty: false })).toBe(false);
  });

  it("does NOT fire while the sheet is still open", () => {
    // Dirty and editable is the normal state of someone mid-edit.
    expect(draftLostToLock({ wasEditable: true, editable: true, dirty: true })).toBe(false);
  });
});
