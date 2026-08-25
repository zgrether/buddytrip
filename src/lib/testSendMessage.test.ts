import { describe, it, expect } from "vitest";
import { testSendMessage, type TestSendOutcome } from "./devicePushState";

/**
 * The self-test's copy.
 *
 * ── What these assertions are actually guarding ─────────────────────────────
 * Not "does it produce a string" — every branch does that, and a test that only
 * checks for a substring like "device" passes on all five. What matters is that
 * the five outcomes stay DISTINGUISHABLE (they have five different fixes) and
 * that the success case never claims delivery it cannot know about.
 */

const clean: TestSendOutcome = {
  sent: 0,
  subscriptionsFound: 0,
  failed: 0,
  removedDead: 0,
  notConfigured: false,
};
const out = (o: Partial<TestSendOutcome>) => testSendMessage({ ...clean, ...o });

describe("testSendMessage — the success case does not overclaim", () => {
  /**
   * THE ASSERTION THIS FILE EXISTS FOR.
   *
   * A 2xx from a push service is not a notification on a screen, and the whole
   * chat investigation turned on that gap: 14 sends, zero failures, and a phone
   * that stayed silent. If this string ever reads "push is working", the button
   * becomes the fourth thing in this subsystem that reports success while the
   * device shows nothing.
   */
  it("names the device as the remaining suspect rather than declaring success", () => {
    const { message, tone } = out({ sent: 2, subscriptionsFound: 2 });
    expect(tone).toBe("success");
    // It must point at THIS device as where a silent failure would now live.
    expect(message).toMatch(/this device/i);
    // And it must not assert the thing it cannot observe.
    expect(message).not.toMatch(/\b(is working|it worked|delivered successfully|success)\b/i);
  });

  it("counts devices, and gets the singular right", () => {
    expect(out({ sent: 1, subscriptionsFound: 1 }).message).toContain("1 device.");
    expect(out({ sent: 3, subscriptionsFound: 3 }).message).toContain("3 devices.");
  });

  /**
   * A two-device account with one dead endpoint reported as a clean pass is how
   * "it says it sent" and "my phone is silent" coexist without anyone noticing
   * half of it is broken.
   */
  it("names partial failure instead of reporting a clean pass", () => {
    const { message } = out({ sent: 1, subscriptionsFound: 2, failed: 1 });
    expect(message).toContain("1 device.");
    expect(message).toMatch(/1 other send failed/i);
  });
});

describe("testSendMessage — the zero-delivered cases stay separable", () => {
  /**
   * Four ways to deliver nothing, four different fixes: configure the server,
   * activate push, re-register this device, or investigate the push service.
   * A single "nothing was sent" string for all four is what migration 106 split
   * `no_clincher` from `already_claimed` to avoid, one layer down.
   */
  const cases: Array<[string, TestSendOutcome]> = [
    ["not configured", { ...clean, notConfigured: true }],
    ["no devices", { ...clean, subscriptionsFound: 0 }],
    ["all endpoints dead", { ...clean, subscriptionsFound: 2, removedDead: 2 }],
    ["all rejected", { ...clean, subscriptionsFound: 2, failed: 2 }],
  ];

  it("gives each a different message", () => {
    const messages = cases.map(([, o]) => testSendMessage(o).message);
    expect(new Set(messages).size).toBe(cases.length);
  });

  it.each(cases)("reports %s as an error, not a success", (_label, o) => {
    expect(testSendMessage(o).tone).toBe("error");
  });

  /** The one a person can fix in ten seconds — so it must say HOW. */
  it("tells an expired registration to re-activate", () => {
    const { message } = out({ subscriptionsFound: 1, removedDead: 1 });
    expect(message).toMatch(/expired/i);
    expect(message).toMatch(/off and on/i);
  });

  /** Points at the control directly above it on the same screen. */
  it("sends a device-less account to the activation control", () => {
    expect(out({ subscriptionsFound: 0 }).message).toMatch(/activate push above/i);
  });

  /**
   * `notConfigured` outranks everything: with no VAPID keys the send never ran,
   * so "no devices registered" would be a claim about a query that never
   * happened. Ordering, asserted rather than assumed.
   */
  it("reports a missing server config even when other counters look empty", () => {
    expect(out({ notConfigured: true, subscriptionsFound: 0 }).message).toMatch(
      /configured/i
    );
  });
});
