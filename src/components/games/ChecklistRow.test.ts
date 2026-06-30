import { describe, it, expect } from "vitest";
import { checklistRowVisuals } from "./ChecklistRow";

// W-GAMEPAGE visual pass P-A (vocabulary §4) — the row state→treatment mapping.
// Two states + one error; the type-icon always renders (the badge is an overlay,
// never a swap), so these assert the chrome each state produces.

describe("checklistRowVisuals", () => {
  it("empty → dashed border, transparent surface, MUTED icon, NO badge", () => {
    const v = checklistRowVisuals("empty", false);
    expect(v.border).toContain("dashed");
    expect(v.surface).toBe("transparent");
    expect(v.iconColor).toBe("var(--color-bt-text-dim)");
    expect(v.badge).toBeNull();
  });

  it("resolved → solid border, card surface, WHITE icon, teal CHECK badge", () => {
    const v = checklistRowVisuals("resolved", false);
    expect(v.border).toBe("1px solid var(--color-bt-border)");
    expect(v.surface).toBe("var(--color-bt-card)");
    expect(v.iconColor).toBe("var(--color-bt-text)");
    expect(v.iconBg).toBe("var(--color-bt-card-raised)");
    expect(v.badge).toBe("check");
  });

  it("invalid → danger border, danger icon, red-X badge (not a check)", () => {
    const v = checklistRowVisuals("invalid", false);
    expect(v.border).toContain("var(--color-bt-danger)");
    expect(v.iconColor).toBe("var(--color-bt-danger)");
    expect(v.badge).toBe("x");
  });

  it("open (editing) → card surface (continuous with collapsed-resolved), solid border, NO badge", () => {
    expect(checklistRowVisuals("resolved", true).badge).toBeNull();
    expect(checklistRowVisuals("invalid", true).badge).toBeNull();
    // The panel is ONE continuous surface open or closed — open shares the
    // resolved card surface (no card-raised jump that read flat/base-like).
    expect(checklistRowVisuals("empty", true).surface).toBe("var(--color-bt-card)");
    expect(checklistRowVisuals("resolved", true).surface).toBe("var(--color-bt-card)");
    // An open empty row is no longer dashed (it's the active editor frame).
    expect(checklistRowVisuals("empty", true).border).toBe("1px solid var(--color-bt-border)");
  });

  // Readiness rework P2 — the collapse-boundary verdict: while OPEN, an invalid row
  // reads fully NEUTRAL (no red border / danger icon / X badge); the red verdict
  // only appears once COLLAPSED. Kills the mid-build red↔teal flicker.
  it("invalid is NEUTRAL while open, red only when collapsed", () => {
    const open = checklistRowVisuals("invalid", true);
    expect(open.border).not.toContain("danger"); // no red border while editing
    expect(open.iconColor).not.toContain("danger"); // no danger icon while editing
    expect(open.iconColor).toBe("var(--color-bt-text)"); // active/white, the editing look
    expect(open.badge).toBeNull();

    const collapsed = checklistRowVisuals("invalid", false);
    expect(collapsed.border).toContain("var(--color-bt-danger)"); // verdict resolves on collapse
    expect(collapsed.iconColor).toBe("var(--color-bt-danger)");
    expect(collapsed.badge).toBe("x");
  });

  it("the icon container is raised only when active (resolved/open), transparent when empty", () => {
    expect(checklistRowVisuals("empty", false).iconBg).toBe("transparent");
    expect(checklistRowVisuals("resolved", false).iconBg).toBe("var(--color-bt-card-raised)");
    expect(checklistRowVisuals("empty", true).iconBg).toBe("var(--color-bt-card-raised)");
  });
});
