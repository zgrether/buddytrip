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
    expect(scoringSettingsEditable(clock(), NOW)).toBe(true);
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
    // already submitted, and flipping `use_confidence` would change what those
    // rankings were worth.
    const c = clock({ picksOpenedAt: iso(-HOUR) });
    expect(slateEditable(c, NOW)).toBe(false);
    expect(scoringSettingsEditable(c, NOW)).toBe(false);
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
