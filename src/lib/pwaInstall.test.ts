import { describe, it, expect } from "vitest";
import {
  resolveBannerState,
  isDismissSuppressed,
  installAffordance,
  DISMISS_DECAY_MS,
  type BannerState,
} from "./pwaInstall";

const NOW = 1_800_000_000_000;

const base = {
  platform: "android" as const,
  standalone: false,
  engaged: true,
  dismissal: null,
  notificationPermission: "default" as const,
  now: NOW,
};

describe("resolveBannerState", () => {
  it("desktop / unknown platform never shows anything", () => {
    expect(resolveBannerState({ ...base, platform: "other" })).toBeNull();
    expect(
      resolveBannerState({
        ...base,
        platform: "other",
        standalone: true,
        notificationPermission: "denied",
      })
    ).toBeNull();
  });

  it("engagement gate: hidden until the session is engaged, shows once it is", () => {
    expect(resolveBannerState({ ...base, engaged: false })).toBeNull();
    expect(resolveBannerState({ ...base, engaged: true })).toEqual({
      kind: "install",
      platform: "android",
    });
  });

  it("not-installed wins over a denied permission (install first)", () => {
    expect(
      resolveBannerState({ ...base, notificationPermission: "denied" })
    ).toEqual({ kind: "install", platform: "android" });
  });

  it("iOS gets the ios install state (instructional affordance)", () => {
    expect(resolveBannerState({ ...base, platform: "ios" })).toEqual({
      kind: "install",
      platform: "ios",
    });
  });

  it("installed + denied → blocked message (must not be silent)", () => {
    expect(
      resolveBannerState({
        ...base,
        standalone: true,
        notificationPermission: "denied",
      })
    ).toEqual({ kind: "blocked" });
  });

  it("installed + default permission stays hidden (stubbed until push ships)", () => {
    expect(resolveBannerState({ ...base, standalone: true })).toBeNull();
  });

  it("installed + granted → nothing", () => {
    expect(
      resolveBannerState({
        ...base,
        standalone: true,
        notificationPermission: "granted",
      })
    ).toBeNull();
  });

  it("installed + unsupported Notification API → nothing (not 'blocked')", () => {
    expect(
      resolveBannerState({
        ...base,
        standalone: true,
        notificationPermission: "unsupported",
      })
    ).toBeNull();
  });
});

describe("dismissal decay", () => {
  it("a fresh dismissal suppresses the banner", () => {
    const dismissal = { at: NOW - 1000, count: 1 };
    expect(isDismissSuppressed(dismissal, NOW)).toBe(true);
    expect(resolveBannerState({ ...base, dismissal })).toBeNull();
  });

  it("after the decay window the banner may return once", () => {
    const dismissal = { at: NOW - DISMISS_DECAY_MS - 1, count: 1 };
    expect(isDismissSuppressed(dismissal, NOW)).toBe(false);
    expect(resolveBannerState({ ...base, dismissal })).toEqual({
      kind: "install",
      platform: "android",
    });
  });

  it("a second dismissal is final — never returns even after the window", () => {
    const dismissal = { at: NOW - DISMISS_DECAY_MS * 10, count: 2 };
    expect(isDismissSuppressed(dismissal, NOW)).toBe(true);
    expect(resolveBannerState({ ...base, dismissal })).toBeNull();
  });

  it("no dismissal record → not suppressed", () => {
    expect(isDismissSuppressed(null, NOW)).toBe(false);
  });
});

describe("installAffordance (render branch — the no-prompt fallback)", () => {
  const android: BannerState = { kind: "install", platform: "android" };
  const ios: BannerState = { kind: "install", platform: "ios" };

  it("Android WITH a captured prompt → the real Install button", () => {
    expect(installAffordance(android, true)).toBe("button");
  });

  it("Android WITHOUT a prompt → instructional fallback, NOT hidden (the common post-dismiss state)", () => {
    expect(installAffordance(android, false)).toBe("android-instructions");
  });

  it("iOS is always instructional — never a button, prompt or not", () => {
    expect(installAffordance(ios, true)).toBe("ios-instructions");
    expect(installAffordance(ios, false)).toBe("ios-instructions");
  });

  it("blocked / hidden states carry no install affordance", () => {
    expect(installAffordance({ kind: "blocked" }, true)).toBe("none");
    expect(installAffordance(null, true)).toBe("none");
  });
});
