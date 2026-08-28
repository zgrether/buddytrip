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

describe("scoringFrozenReason — one input, because one thing freezes them", () => {
  /**
   * It took `(clock, now)` and branched on the phase. Migration 157 removed
   * every clock-based freeze from these settings: picks opening does not close
   * them, and neither does locking. Only a recorded result does.
   *
   * So the signature is the fix. A function that cannot see the clock cannot
   * describe a clock state wrongly — which the two previous versions of this
   * copy both did, first claiming picks were open on a locked game, then
   * warning about work lost to a reopen that had been deleted.
   */

  it("says nothing while nothing has been scored", () => {
    expect(scoringFrozenReason(false)).toBeNull();
  });

  it("explains the freeze once a result exists — a disabled control is never mute", () => {
    const reason = scoringFrozenReason(true) as string;
    expect(reason).toBeTruthy();
    expect(reason).toContain("Results are in");
  });

  it("names the CAUSE and does not invent an exit", () => {
    // Earlier versions pointed at a way out ("reopen the slate", "lock picks")
    // because there was one. There is not, once results exist — offering one
    // would be the falsehood these rewrites keep removing.
    const reason = scoringFrozenReason(true) as string;
    expect(reason).toContain("rescore");
    expect(reason).not.toContain("Reopen");
    expect(reason).not.toContain("Lock picks");
  });

  it("cannot claim a clock state, because it cannot see the clock", () => {
    // The structural version of the assertion: no phase word can appear,
    // whatever the game's clock is doing.
    const reason = scoringFrozenReason(true) as string;
    expect(reason).not.toContain("Picks are open");
    expect(reason).not.toContain("Picks are locked");
  });
});
