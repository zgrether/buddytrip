import { describe, it, expect } from "vitest";
import {
  activationCopy,
  deriveDevicePushState,
  devicePushCopy,
  notificationsRowSummary,
  type DevicePushInputs,
} from "./devicePushState";

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

  it("on and off are both actionable, and are a fixed NAME plus a distinguishable STATE", () => {
    // Replaces an earlier assertion that the two LABELS were distinguishable.
    // That was true under the old copy ("Notifications are on for this
    // device" vs "Enable notifications on this device") and is now false on
    // purpose — the control's identity ("Notifications") doesn't change
    // between on and off, only its state does, matching the shape of the
    // static "Idea archive" row beside it ("Idea archive" / a description).
    const on = devicePushCopy("on");
    const off = devicePushCopy("off");
    expect(on.actionable).toBe(true);
    expect(off.actionable).toBe(true);
    expect(on.label).toBe("Notifications");
    expect(off.label).toBe("Notifications");
    expect(on.sub).not.toBe(off.sub);
  });

  it("on/off copy doesn't explain the tap or disclaim scope", () => {
    // Replaces an earlier assertion that pinned "Your other devices are
    // unaffected" as REQUIRED copy. That disclaimer told people the scope
    // MIGHT not have been what they expected, which is the opposite of
    // reassuring — removed on purpose, not lost by accident.
    for (const copy of [devicePushCopy("on"), devicePushCopy("off")]) {
      expect(copy.sub).not.toMatch(/tap/i);
      expect(copy.sub).not.toMatch(/other device/i);
    }
  });

  it("no state claims the app can grant or revoke browser permission", () => {
    for (const s of ["unsupported", "blocked", "on", "off"] as const) {
      const { label, sub } = devicePushCopy(s);
      expect(`${label} ${sub}`).not.toMatch(/we('ll| will) (allow|unblock|revoke)/i);
    }
  });
});

// ---------------------------------------------------------------------------
// The activation control + the settings-row summary (notifications modal).
// ---------------------------------------------------------------------------

describe("activationCopy — the parent control inside the modal", () => {
  /**
   * THE STATE THAT WAS MISSING, and the reason the parent control exists.
   *
   * A person who blocked the prompt six months ago has no way to discover why
   * nothing arrives — the app cannot re-prompt (browsers will not show the
   * prompt again after a denial), so the copy IS the entire fix. Asserted on
   * both halves: it must SAY blocked, and it must name where to go.
   */
  it("says blocked plainly, and names the settings to go and change", () => {
    const c = activationCopy("blocked");
    expect(c.label.toLowerCase()).toContain("blocked");
    expect(c.sub.toLowerCase()).toContain("browser settings");
    expect(c.actionable).toBe(false);
  });

  it("explains an unsupported device rather than offering a dead switch", () => {
    const c = activationCopy("unsupported");
    expect(c.label.toLowerCase()).toContain("support");
    expect(c.actionable).toBe(false);
  });

  /**
   * Only the two reachable states are actionable — the other two are
   * EXPLANATIONS. This is the property the modal's render branches on to decide
   * whether to draw a checkbox at all, so a control that cannot work is never
   * put on screen next to text saying it cannot work.
   */
  it("is actionable in exactly the two states a tap can change", () => {
    expect(activationCopy("off").actionable).toBe(true);
    expect(activationCopy("on").actionable).toBe(true);
    expect(activationCopy("blocked").actionable).toBe(false);
    expect(activationCopy("unsupported").actionable).toBe(false);
  });

  it("names the ACT when off, and the resulting state when on", () => {
    expect(activationCopy("off").label.toLowerCase()).toContain("activate");
    expect(activationCopy("on").label.toLowerCase()).toContain("activated");
  });

  /**
   * The permission prompt is the browser's and can be refused permanently, so
   * no state may promise the app will grant, unblock, or re-ask for it. The
   * blocked state in particular must not read as "tap again to retry" — that is
   * a button that cannot work, which is the defect the parent control replaced.
   */
  it("never promises to grant permission or to re-ask after a denial", () => {
    for (const s of ["unsupported", "blocked", "on", "off"] as const) {
      const { label, sub } = activationCopy(s);
      const text = `${label} ${sub}`;
      expect(text).not.toMatch(/we('ll| will) (allow|unblock|revoke|ask again)/i);
      expect(text).not.toMatch(/try again|tap again|retry/i);
    }
  });

  /**
   * The modal control and the settings row describe the same state in two
   * registers, and must not be collapsed into one string: the row is a value
   * read at a glance from a list, the control is an act with room to explain
   * itself. Pinned because the obvious "tidy-up" is to make one call the other.
   */
  it("does not duplicate the settings row's copy", () => {
    for (const s of ["off", "on", "blocked", "unsupported"] as const) {
      expect(activationCopy(s).label).not.toBe(devicePushCopy(s).label);
    }
  });
});

describe("notificationsRowSummary — state readable without opening the modal", () => {
  it("reports the non-actionable states so you know before you tap", () => {
    expect(notificationsRowSummary("blocked", [])).toBe("Blocked in browser settings");
    expect(notificationsRowSummary("unsupported", [])).toBe("Not supported on this device");
    expect(notificationsRowSummary("off", [])).toBe("Off");
  });

  it("lists what is currently on, in the order given", () => {
    expect(notificationsRowSummary("on", ["Game events", "Chat"])).toBe("Game events, Chat");
    expect(notificationsRowSummary("on", ["Chat"])).toBe("Chat");
  });

  /**
   * ACTIVATED-BUT-EVERYTHING-MUTED IS NOT "OFF", and this is the case the
   * summary exists as a function to handle rather than a template.
   *
   * The device is subscribed and the sender is being turned away at the
   * preference gate — a different state with a different fix. Saying "Off"
   * would send someone to re-activate a device that is already activated, and
   * they would find the switch already on and learn nothing. Asserted as
   * "not Off" as well as on the exact string, so a future rewording cannot
   * quietly collapse the two.
   */
  it("distinguishes activated-with-everything-muted from off", () => {
    const muted = notificationsRowSummary("on", []);
    expect(muted).not.toBe(notificationsRowSummary("off", []));
    expect(muted.toLowerCase()).toContain("muted");
  });
});
