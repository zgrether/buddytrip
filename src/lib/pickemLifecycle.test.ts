import { describe, it, expect } from "vitest";
import {
  msUntilDeadline,
  pickemPhase,
  picksEverOpened,
  picksOpen,
  picksRevealed,
  scoringSettingsEditable,
  slateEditable,
  type PickemClock,
  pickemClosure,
} from "./pickemLifecycle";

/**
 * The clock's semantics. Its AGREEMENT WITH SQL is a different test —
 * `pickemLifecycleParity.rls.test.ts` — because agreement can only be
 * established by running both, and this file runs neither policy nor database.
 */

const NOW = Date.UTC(2026, 8, 5, 12, 0, 0);
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();
const HOUR = 3_600_000;

const clock = (over: Partial<PickemClock> = {}): PickemClock => ({
  picksOpenedAt: null,
  picksDeadline: null,
  picksLockedAt: null,
  ...over,
});

describe("building — nothing published", () => {
  it("is neither open nor revealed", () => {
    const c = clock();
    expect(pickemPhase(c, NOW)).toBe("building");
    expect(picksOpen(c, NOW)).toBe(false);
    expect(picksRevealed(c, NOW)).toBe(false);
  });

  it("stays building even with a deadline already in the past", () => {
    // The two predicates are not inverses, and this is the case that proves it.
    // A runner who sets a deadline while still building has published nothing;
    // treating the passed deadline as a lock would reveal a slate nobody has
    // been told about.
    const c = clock({ picksDeadline: iso(-HOUR) });
    expect(pickemPhase(c, NOW)).toBe("building");
    expect(picksOpen(c, NOW)).toBe(false);
    expect(picksRevealed(c, NOW)).toBe(false);
  });

  it("the slate and the scoring settings are editable", () => {
    expect(slateEditable(clock(), NOW)).toBe(true);
    expect(scoringSettingsEditable(false)).toBe(true);
  });
});

describe("picks open", () => {
  it("open with no deadline stays open indefinitely", () => {
    const c = clock({ picksOpenedAt: iso(-HOUR) });
    expect(pickemPhase(c, NOW)).toBe("picks_open");
    expect(picksOpen(c, NOW)).toBe(true);
    expect(picksRevealed(c, NOW)).toBe(false);
  });

  it("open with a future deadline is open and not revealed", () => {
    const c = clock({ picksOpenedAt: iso(-HOUR), picksDeadline: iso(HOUR) });
    expect(picksOpen(c, NOW)).toBe(true);
    expect(picksRevealed(c, NOW)).toBe(false);
  });

  it("FREEZES the slate and the scoring settings", () => {
    // Lock point 1 (spec §4): a seventeenth game would invalidate every ranking
    // already submitted.
    const c = clock({ picksOpenedAt: iso(-HOUR) });
    expect(slateEditable(c, NOW)).toBe(false);

    // The SETTINGS are NOT frozen with it any more (migration 157). They used
    // to be, on the reasoning that flipping `use_confidence` changes what those
    // rankings were worth — true, but too early: nothing has been SCORED under
    // the old rules, so nothing is rewritten by changing them. That earlier
    // boundary is also what made a single atomic Save impossible, since
    // `points_total` had been carved out of it.
    expect(scoringSettingsEditable(false)).toBe(true);
    // Only a recorded result closes them, whatever the clock says.
    expect(scoringSettingsEditable(true)).toBe(false);
  });
});

describe("locked", () => {
  it("a hand lock locks and reveals, regardless of any deadline", () => {
    const c = clock({ picksOpenedAt: iso(-2 * HOUR), picksLockedAt: iso(-HOUR), picksDeadline: iso(HOUR) });
    expect(pickemPhase(c, NOW)).toBe("locked");
    expect(picksOpen(c, NOW)).toBe(false);
    expect(picksRevealed(c, NOW)).toBe(true);
  });

  it("a PASSED deadline locks and reveals with nothing having fired", () => {
    // The lazy lock. No scheduler ran and no column was written at the deadline
    // — the predicate reads `now` and the answer changes underneath everyone.
    const c = clock({ picksOpenedAt: iso(-2 * HOUR), picksDeadline: iso(-HOUR) });
    expect(pickemPhase(c, NOW)).toBe("locked");
    expect(picksRevealed(c, NOW)).toBe(true);
  });
});

describe("the deadline boundary", () => {
  const c = clock({ picksOpenedAt: iso(-HOUR), picksDeadline: iso(0) });

  it("AT the deadline instant: open, not revealed", () => {
    expect(picksOpen(c, NOW)).toBe(true);
    expect(picksRevealed(c, NOW)).toBe(false);
  });

  it("one millisecond later: closed and revealed", () => {
    expect(picksOpen(c, NOW + 1)).toBe(false);
    expect(picksRevealed(c, NOW + 1)).toBe(true);
  });

  it("the two are exact complements across the boundary — never both, never neither", () => {
    // The property that matters more than either value: there is no instant
    // where a sheet is simultaneously editable and readable by other people,
    // and none where it is neither.
    for (const t of [NOW - 2, NOW - 1, NOW, NOW + 1, NOW + 2]) {
      expect(picksOpen(c, t)).toBe(!picksRevealed(c, t));
    }
  });
});

describe("msUntilDeadline", () => {
  it("counts down while open", () => {
    const c = clock({ picksOpenedAt: iso(-HOUR), picksDeadline: iso(2 * HOUR) });
    expect(msUntilDeadline(c, NOW)).toBe(2 * HOUR);
  });

  it("is null when there is nothing to count down to", () => {
    expect(msUntilDeadline(clock({ picksOpenedAt: iso(-HOUR) }), NOW)).toBeNull(); // no deadline
    expect(msUntilDeadline(clock(), NOW)).toBeNull(); // not open
    expect(
      msUntilDeadline(clock({ picksOpenedAt: iso(-2 * HOUR), picksLockedAt: iso(-HOUR) }), NOW)
    ).toBeNull(); // hand-locked
  });
});

describe("a malformed timestamp is ABSENT, never 1970", () => {
  it("does not read an unparseable picks_opened_at as long-since-opened", () => {
    // `new Date("nonsense").getTime()` is NaN; a naive `Number(...) || 0` would
    // make this 1970 and publish a slate nobody opened.
    const c = clock({ picksOpenedAt: "not-a-date" });
    expect(picksEverOpened(c)).toBe(false);
    expect(pickemPhase(c, NOW)).toBe("building");
  });

  it("does not read an unparseable deadline as already passed", () => {
    const c = clock({ picksOpenedAt: iso(-HOUR), picksDeadline: "not-a-date" });
    expect(picksOpen(c, NOW)).toBe(true);
    expect(picksRevealed(c, NOW)).toBe(false);
  });
});


describe("pickemClosure — §8.4's one sentence", () => {
  const NOW = Date.UTC(2026, 10, 8, 12, 0);
  const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();
  const HOUR = 3_600_000;

  it("is NULL while picks are open — nothing has closed", () => {
    expect(pickemClosure(
      { picksOpenedAt: iso(-HOUR), picksDeadline: iso(HOUR), picksLockedAt: null }, NOW
    )).toBeNull();
  });

  it("is NULL for a game that never opened — it is not 'closed', it has not started", () => {
    // A caller rendering this must not invent a closure for a building game.
    expect(pickemClosure(
      { picksOpenedAt: null, picksDeadline: iso(-HOUR), picksLockedAt: null }, NOW
    )).toBeNull();
  });

  it("names the DEADLINE when the clock ran out", () => {
    const c = pickemClosure(
      { picksOpenedAt: iso(-2 * HOUR), picksDeadline: iso(-HOUR), picksLockedAt: null }, NOW
    );
    expect(c).toEqual({ at: NOW - HOUR, reason: "deadline" });
  });

  it("names the HAND LOCK when the runner ended it early", () => {
    const c = pickemClosure(
      { picksOpenedAt: iso(-2 * HOUR), picksDeadline: null, picksLockedAt: iso(-HOUR) }, NOW
    );
    expect(c).toEqual({ at: NOW - HOUR, reason: "locked" });
  });

  it("when BOTH apply, reports whichever happened FIRST", () => {
    // Reporting the later one would name a cause that arrived after the thing
    // it supposedly caused — telling someone picks closed at 11:00 when the
    // runner had already closed them at 10:30, leaving the half hour they
    // remember being locked out unexplained.
    const lockedFirst = pickemClosure(
      { picksOpenedAt: iso(-4 * HOUR), picksDeadline: iso(-HOUR), picksLockedAt: iso(-3 * HOUR) },
      NOW
    );
    expect(lockedFirst).toEqual({ at: NOW - 3 * HOUR, reason: "locked" });

    const deadlineFirst = pickemClosure(
      { picksOpenedAt: iso(-4 * HOUR), picksDeadline: iso(-3 * HOUR), picksLockedAt: iso(-HOUR) },
      NOW
    );
    expect(deadlineFirst).toEqual({ at: NOW - 3 * HOUR, reason: "deadline" });
  });

  it("AGREES WITH picksOpen — a closure exists exactly when picks are not open", () => {
    // The two must never disagree: a sheet that is read-only with no closure
    // would be the silent-disable §8.4 forbids, and a closure on an open sheet
    // would announce a closure that has not happened.
    const clocks = [
      { picksOpenedAt: iso(-HOUR), picksDeadline: null, picksLockedAt: null },
      { picksOpenedAt: iso(-HOUR), picksDeadline: iso(HOUR), picksLockedAt: null },
      { picksOpenedAt: iso(-2 * HOUR), picksDeadline: iso(-HOUR), picksLockedAt: null },
      { picksOpenedAt: iso(-2 * HOUR), picksDeadline: null, picksLockedAt: iso(-HOUR) },
      { picksOpenedAt: iso(-4 * HOUR), picksDeadline: iso(-HOUR), picksLockedAt: iso(-3 * HOUR) },
    ];
    for (const c of clocks) {
      const open = picksOpen(c, NOW);
      const closure = pickemClosure(c, NOW);
      expect(closure == null, JSON.stringify(c)).toBe(open);
    }
  });
});
