import { describe, it, expect } from "vitest";
import { gameLifecycle, gameLockState, isPreScoring } from "./gameLifecycle";

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

  it("opens a correction on an incomplete game, but won't relock one (#1431)", () => {
    // Correcting stays ungated: a correction exists because the recorded result
    // is wrong, and refusing to open one would be #769's dead end again.
    //
    // Relocking is gated, which REVERSES what this case asserted from #800
    // until #1431. The reason it gave was that the gate would strand a game
    // whose scores were cleared or whose roster grew after the lock. It
    // doesn't: a correction reopens score entry, and every format's
    // `allComplete` is derived from what is entered, so the cleared score or
    // the new player's holes are entered the same way the game was first
    // completed. Ungated, the relock (`games.finish` again) recorded a
    // half-round as final through the one door the first finalize guards.
    const s = { ...base, status: "complete", allComplete: false };
    expect(gameLifecycle({ ...s, correctionsOpen: false }).canCorrect).toBe(true);
    expect(gameLifecycle({ ...s, correctionsOpen: true }).canRelock).toBe(false);
  });

  it("relocks a complete correction — pick'em's revealed clock counts as complete", () => {
    // The control for the case above: the gate refuses an incomplete relock, not
    // every relock. Pick'em passes `picksRevealed` as `allComplete`, which stays
    // true through a correction, so its relock is offered as before.
    const s = { ...base, status: "complete", correctionsOpen: true, allComplete: true };
    expect(gameLifecycle(s).canRelock).toBe(true);
    expect(gameLifecycle({ ...s, canEdit: false }).canRelock).toBe(false);
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

describe("gameLockState — the piece each view kept re-implementing", () => {
  it("is the same three flags gameLifecycle exposes, for the same inputs", () => {
    // The split exists so views can read the lock state EARLY (a group tap is
    // gated on it, before the finalize CTA's completeness input exists). If the
    // two ever disagreed, rack and match would keep their behaviour and stroke
    // would silently get a different one — which is the failure being fixed.
    for (const status of ["pending", "active", "complete", null, undefined]) {
      for (const correctionsOpen of [false, true]) {
        const full = gameLifecycle({ canEdit: true, status, correctionsOpen, allComplete: true });
        expect(gameLockState({ status, correctionsOpen })).toEqual({
          isFinal: full.isFinal,
          isLocked: full.isLocked,
          isCorrecting: full.isCorrecting,
        });
      }
    }
  });

  it("locks a posted game and unlocks it for a correction", () => {
    // What the group tap reads: locked → the read-only scorecard, correcting →
    // the keypad again. `scores.upsertEntry` refuses exactly the locked case, so
    // this predicate and the server gate are the same condition.
    expect(gameLockState({ status: "complete", correctionsOpen: false })).toMatchObject({
      isLocked: true,
      isCorrecting: false,
    });
    expect(gameLockState({ status: "complete", correctionsOpen: true })).toMatchObject({
      isLocked: false,
      isCorrecting: true,
    });
    expect(gameLockState({ status: "active", correctionsOpen: false })).toMatchObject({
      isLocked: false,
      isCorrecting: false,
    });
  });
});

/**
 * `isPreScoring` — the start-of-life axis, extracted because it was being asked
 * in two places in two shapes that are exact inverses of each other:
 *
 *   GameRow       `!(complete || active || scoringEnabled)`  → setupMode
 *   MatchGameView  `complete || active || scoringEnabled`    → show the overview
 *
 * The table below is the full truth table for both call sites, so "the two agree"
 * is asserted rather than assumed.
 */
describe("isPreScoring — has setup ended?", () => {
  const cases: [string, boolean, boolean][] = [
    // status,    scoringEnabled, isPreScoring
    ["pending", false, true], // untouched — the only true setup state
    ["pending", true, false], // ARMED but unscored: setup is over (#25 — the flag moves first)
    ["active", false, false], // under way
    ["active", true, false],
    ["complete", false, false], // finished
    ["complete", true, false], // finished + still armed (finish keeps the flag — #882)
  ];

  it.each(cases)("status=%s scoringEnabled=%s → %s", (status, scoringEnabled, expected) => {
    expect(isPreScoring({ status, scoringEnabled })).toBe(expected);
  });

  it("an unknown or absent status reads as pre-scoring unless armed", () => {
    // Defensive: a row that hasn't loaded shouldn't claim the game is under way.
    expect(isPreScoring({ status: undefined, scoringEnabled: false })).toBe(true);
    expect(isPreScoring({ status: null, scoringEnabled: true })).toBe(false);
  });
});
