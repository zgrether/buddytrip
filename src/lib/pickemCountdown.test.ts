import { describe, it, expect } from "vitest";
import {
  formatCountdown,
  msUntilDeadline,
  picksOpen,
  pickemClosure,
  scoringFrozenReason,
  type PickemClock,
} from "./pickemLifecycle";

const iso = (ms: number) => new Date(ms).toISOString();
const T0 = Date.UTC(2026, 8, 5, 17, 0, 0);

const withDeadline = (deadline: number): PickemClock => ({
  picksOpenedAt: iso(deadline - 86_400_000),
  picksDeadline: iso(deadline),
  picksLockedAt: null,
});

describe("formatCountdown", () => {
  it("shows SECONDS under an hour — the minute the countdown exists for", () => {
    // The reported bug in miniature: the first version rendered whole minutes
    // at every distance, so the last 59 seconds displayed a motionless "0m".
    // These two are one second apart and MUST differ on screen.
    expect(formatCountdown(30_000)).toBe("0:30");
    expect(formatCountdown(29_000)).toBe("0:29");
    expect(formatCountdown(30_000)).not.toBe(formatCountdown(29_000));
  });

  it("shows hours and minutes above an hour, where seconds are noise", () => {
    expect(formatCountdown(3 * 3_600_000 + 5 * 60_000)).toBe("3h 05m");
    expect(formatCountdown(3_600_000)).toBe("1h 00m");
  });

  it("switches format exactly at the hour, and only once", () => {
    expect(formatCountdown(3_600_000)).toBe("1h 00m");
    expect(formatCountdown(3_599_000)).toBe("59:59");
  });

  it("never renders a negative clock", () => {
    // A caller that hands over a stale value must not produce "-1:-30".
    expect(formatCountdown(0)).toBe("0:00");
    expect(formatCountdown(-5_000)).toBe("0:00");
  });
});

describe("crossing zero — the invariant that makes the tick SAFE", () => {
  /**
   * The point of this block, and why it is not a display test.
   *
   * "A countdown reaching 0:00 while the sheet stays editable is the worst
   * version of this." Making the timer tick is what creates that risk: before
   * the fix nothing moved, so nothing could disagree. Now two answers are
   * derived every second — how long is left, and whether picks are open — and
   * the whole design rests on them coming from one clock.
   *
   * So this asserts the RELATIONSHIP rather than either value. A test that only
   * checked `formatCountdown` would stay green through exactly the bug this
   * guards.
   */
  it("a countdown exists ONLY while picks are open — swept across the deadline", () => {
    const clock = withDeadline(T0);
    let sawOpen = false;
    let sawClosed = false;

    for (let offset = -5_000; offset <= 5_000; offset += 250) {
      const now = T0 + offset;
      const open = picksOpen(clock, now);
      const ms = msUntilDeadline(clock, now);
      // The one assertion that matters: never a countdown on a closed sheet,
      // never a closed sheet still showing one.
      expect(ms != null).toBe(open);
      // And the closed message is the exact complement — no gap where the sheet
      // is neither editable nor explained.
      expect(pickemClosure(clock, now) != null).toBe(!open);
      if (open) sawOpen = true;
      else sawClosed = true;
    }

    // Guards the sweep itself: a range that never crossed would pass the loop
    // above trivially.
    expect(sawOpen && sawClosed).toBe(true);
  });

  it("the LAST open instant still counts down, and the next one is closed", () => {
    const clock = withDeadline(T0);
    // At exactly the deadline picks are open (`now <= deadline`) — the boundary
    // `pickemLifecycle`'s header states and `pickemLifecycleParity.rls.test.ts`
    // pins against the SQL. So 0:00 is legal for that one instant and the save
    // that lands on it really would be accepted.
    expect(picksOpen(clock, T0)).toBe(true);
    expect(formatCountdown(msUntilDeadline(clock, T0) as number)).toBe("0:00");

    expect(picksOpen(clock, T0 + 1)).toBe(false);
    expect(msUntilDeadline(clock, T0 + 1)).toBeNull();
    expect(pickemClosure(clock, T0 + 1)).toEqual({ at: T0, reason: "deadline" });
  });

  it("a hand-locked game has no countdown even before its deadline", () => {
    const clock: PickemClock = { ...withDeadline(T0), picksLockedAt: iso(T0 - 60_000) };
    expect(msUntilDeadline(clock, T0 - 30_000)).toBeNull();
    expect(picksOpen(clock, T0 - 30_000)).toBe(false);
  });
});

describe("scoringFrozenReason — copy derived from the phase, not assumed", () => {
  const openClock = withDeadline(T0);
  const lockedClock: PickemClock = { ...openClock, picksLockedAt: iso(T0 - 60_000) };
  const buildingClock: PickemClock = {
    picksOpenedAt: null,
    picksDeadline: null,
    picksLockedAt: null,
  };

  it("says nothing while the settings are editable", () => {
    expect(scoringFrozenReason(buildingClock, T0)).toBeNull();
  });

  it("explains the freeze while picks are open — a disabled control is never mute", () => {
    // Finding 3: a disabled control with no reason teaches nobody why.
    expect(scoringFrozenReason(openClock, T0 - 60_000)).toBeTruthy();
  });

  it("says NOTHING on a locked game, because nothing is frozen there any more", () => {
    // The originally-reported bug was this sentence claiming "Picks are open"
    // on a locked game. Migration 156 removed the second frozen phase outright
    // — the slate and its settings are editable whenever picks are not open —
    // so the false sentence is now unreachable rather than merely corrected.
    //
    // Asserting null is the STRONGER version of the old assertion: any build
    // that renders a frozen-reason here at all fails, including one that
    // renders the correct wording for a state that is not frozen.
    expect(scoringFrozenReason(lockedClock, T0)).toBeNull();
  });

  it("DOES say picks are open while they are", () => {
    const open = scoringFrozenReason(openClock, T0 - 60_000) as string;
    expect(open).toContain("Picks are open");
  });

  it("names the way out, and it is the one that costs nothing", () => {
    // Finding 3's other half: hiding the control would hide an available
    // action, so the reason has to point at the exit. It must point at LOCK,
    // not at the deleted reopen — and must not warn about losing work, because
    // locking does not clear anything. Only a slate change does.
    const open = scoringFrozenReason(openClock, T0 - 60_000) as string;
    expect(open).toContain("Lock picks");
    expect(open).toContain("nobody loses anything");
    expect(open).not.toContain("Reopen");
  });
});
