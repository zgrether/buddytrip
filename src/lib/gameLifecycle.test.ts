import { describe, it, expect } from "vitest";
import { gameLifecycle } from "./gameLifecycle";

/**
 * The regression this file exists for: stroke and rack each carried their own
 * copy of these conditions, and stroke's copy had silently lost the correction
 * arm entirely (#769) — a finalized stroke game was a dead end with no reopen.
 * Table-driven over the full state space so a format can't be given a different
 * answer by accident; the shared function is now the only place to change one.
 */

const base = { canEdit: true, status: "active", correctionsOpen: false, allComplete: true };

describe("gameLifecycle", () => {
  it("offers finalize only when the role, the status and completeness all agree", () => {
    expect(gameLifecycle(base).canFinalize).toBe(true);
    expect(gameLifecycle({ ...base, canEdit: false }).canFinalize).toBe(false);
    expect(gameLifecycle({ ...base, allComplete: false }).canFinalize).toBe(false);
    expect(gameLifecycle({ ...base, status: "complete" }).canFinalize).toBe(false);
  });

  it("treats every pre-complete status the same", () => {
    // The finalize gate keys on "not complete", NOT on an enumeration of the
    // statuses that precede it — a new pre-complete status must not silently
    // become un-finalizable.
    for (const status of ["pending", "active", null, undefined]) {
      expect(gameLifecycle({ ...base, status }).isFinal).toBe(false);
      expect(gameLifecycle({ ...base, status }).canFinalize).toBe(true);
    }
  });

  it("splits complete into locked and correcting on corrections_open", () => {
    const locked = gameLifecycle({ ...base, status: "complete", correctionsOpen: false });
    expect(locked).toMatchObject({ isFinal: true, isLocked: true, isCorrecting: false });
    expect(locked.canCorrect).toBe(true);
    expect(locked.canRelock).toBe(false);

    const correcting = gameLifecycle({ ...base, status: "complete", correctionsOpen: true });
    expect(correcting).toMatchObject({ isFinal: true, isLocked: false, isCorrecting: true });
    expect(correcting.canCorrect).toBe(false);
    expect(correcting.canRelock).toBe(true);
  });

  it("ignores corrections_open while the game is not complete", () => {
    // A stray true on a live game must not conjure a correction CTA.
    const live = gameLifecycle({ ...base, status: "active", correctionsOpen: true });
    expect(live).toMatchObject({ isFinal: false, isLocked: false, isCorrecting: false });
    expect(live.canCorrect).toBe(false);
    expect(live.canRelock).toBe(false);
    expect(live.canFinalize).toBe(true);
  });

  it("does NOT gate correcting or re-locking on completeness", () => {
    // The deliberate asymmetry. A correction exists precisely because the
    // recorded result is wrong; requiring `allComplete` would strand a game
    // whose scores were cleared or whose roster grew after the lock — which is
    // the same dead end #769 is about, reintroduced one level down.
    const s = { ...base, status: "complete", allComplete: false };
    expect(gameLifecycle({ ...s, correctionsOpen: false }).canCorrect).toBe(true);
    expect(gameLifecycle({ ...s, correctionsOpen: true }).canRelock).toBe(true);
  });

  it("hides every action from a non-editor, in every state", () => {
    // Hidden, not disabled — a member has no business seeing a control they
    // cannot use, and the server refuses it regardless.
    for (const status of ["active", "complete"]) {
      for (const correctionsOpen of [false, true]) {
        const s = gameLifecycle({ ...base, canEdit: false, status, correctionsOpen });
        expect([s.canFinalize, s.canCorrect, s.canRelock]).toEqual([false, false, false]);
      }
    }
  });

  it("never offers two primary actions at once", () => {
    // Finalize / correct / re-lock are mutually exclusive by construction; if
    // that ever stops holding, the scoreboard grows two stacked CTAs.
    for (const status of ["pending", "active", "complete"]) {
      for (const correctionsOpen of [false, true]) {
        for (const allComplete of [false, true]) {
          const s = gameLifecycle({ canEdit: true, status, correctionsOpen, allComplete });
          const shown = [s.canFinalize, s.canCorrect, s.canRelock].filter(Boolean).length;
          expect(shown).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});
