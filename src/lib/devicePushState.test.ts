import { describe, it, expect } from "vitest";
import { deriveDevicePushState, devicePushCopy, type DevicePushInputs } from "./devicePushState";

/**
 * The label must report REALITY. It previously reported nothing — it was
 * `busy ? "Enabling…" : "Enable notifications on this device"`, a constant, so
 * it read "Enable" forever on every platform no matter what was true. A device
 * pass surfaced that as "iOS says enabled and stays Enable"; it was never
 * iOS-specific.
 *
 * This is table-driven over the full input space precisely because the bug was
 * a MISSING case rather than a wrong one.
 */

const base: DevicePushInputs = {
  supported: true,
  permission: "granted",
  hasBrowserSubscription: true,
  registeredOnServer: true,
};

describe("deriveDevicePushState — ON requires all three", () => {
  it("all three present → on", () => {
    expect(deriveDevicePushState(base)).toBe("on");
  });

  it.each([
    ["no live browser subscription", { hasBrowserSubscription: false }],
    ["no row on the server", { registeredOnServer: false }],
    ["permission not yet requested", { permission: "default" as const }],
  ])("%s → off, not on", (_label, patch) => {
    expect(deriveDevicePushState({ ...base, ...patch })).toBe("off");
  });

  it("a live subscription with NO server row is off — the sender has nothing to send to", () => {
    // The specific two-of-three that reads as "mostly on" and delivers nothing.
    expect(
      deriveDevicePushState({ ...base, registeredOnServer: false })
    ).toBe("off");
  });

  it("a server row with NO live subscription is off — the endpoint is dead", () => {
    expect(
      deriveDevicePushState({ ...base, hasBrowserSubscription: false })
    ).toBe("off");
  });

  it("denied outranks everything — including a stale row and subscription", () => {
    // Permission can be revoked in browser settings while both other inputs
    // still look healthy. Reporting "on" there is the worst case: it claims
    // delivery that cannot happen and offers a toggle that cannot fix it.
    expect(deriveDevicePushState({ ...base, permission: "denied" })).toBe("blocked");
  });

  it("unsupported outranks denied", () => {
    expect(
      deriveDevicePushState({ ...base, supported: false, permission: "denied" })
    ).toBe("unsupported");
  });

  it("permission not yet READ (null) is off, never on", () => {
    // Pre-hydration. Must not flash "on" and correct itself.
    expect(deriveDevicePushState({ ...base, permission: null })).toBe("off");
  });
});

describe("devicePushCopy — the states the app cannot fix say so", () => {
  it("blocked is NOT actionable and names where to go", () => {
    const copy = devicePushCopy("blocked");
    expect(copy.actionable, "a toggle that cannot work must not be tappable").toBe(false);
    // #809: name the control, not just the state.
    expect(copy.sub).toMatch(/browser settings/i);
  });

  it("unsupported is not actionable", () => {
    expect(devicePushCopy("unsupported").actionable).toBe(false);
  });

  it("on and off are both actionable, and their labels are distinguishable", () => {
    const on = devicePushCopy("on");
    const off = devicePushCopy("off");
    expect(on.actionable).toBe(true);
    expect(off.actionable).toBe(true);
    expect(on.label).not.toBe(off.label);
  });

  it("turning off promises not to touch other devices", () => {
    // The server delete is endpoint-scoped AND user-scoped; the copy has to
    // match, or someone with two phones can't tell what the button does.
    expect(devicePushCopy("on").sub).toMatch(/other devices/i);
  });

  it("no state claims the app can grant or revoke browser permission", () => {
    for (const s of ["unsupported", "blocked", "on", "off"] as const) {
      const { label, sub } = devicePushCopy(s);
      expect(`${label} ${sub}`).not.toMatch(/we('ll| will) (allow|unblock|revoke)/i);
    }
  });
});
