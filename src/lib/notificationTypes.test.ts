import { describe, it, expect } from "vitest";
import {
  NOTIFICATION_TYPES,
  NOTIFICATION_KEYS,
  isNotificationKey,
  notificationDefault,
  isTypeEnabled,
  resolvePrefs,
} from "./notificationTypes";

describe("notification registry", () => {
  it("declares the confirmed taxonomy, and EVERY category defaults ON", () => {
    const byKey = Object.fromEntries(NOTIFICATION_TYPES.map((t) => [t.key, t]));
    expect(NOTIFICATION_KEYS).toEqual(["game_results", "planning", "invites", "chat"]);

    // The device toggle is the consent gate. Enabling notifications is the
    // deliberate act; the category list is a menu of what to MUTE, not a set of
    // switches to hunt for. A category defaulting OFF means someone enables
    // notifications and receives nothing, which reads as broken.
    //
    // Asserted over the whole registry rather than key-by-key so a NEW category
    // added with `defaultOn: false` fails here instead of shipping silently.
    for (const t of NOTIFICATION_TYPES) {
      expect(t.defaultOn, `${t.key} must default ON`).toBe(true);
    }
    expect(byKey.chat.defaultOn, "flipped from OFF — see the registry comment").toBe(true);
  });

  it("every entry carries a label, description and a non-empty excludes field", () => {
    for (const t of NOTIFICATION_TYPES) {
      expect(t.label.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(0);
      // excludes is load-bearing — an empty one is a firehose invitation.
      expect(t.excludes.length).toBeGreaterThan(0);
    }
  });

  it("isNotificationKey rejects anything outside the registry", () => {
    expect(isNotificationKey("game_results")).toBe(true);
    expect(isNotificationKey("score_posted")).toBe(false); // a call-site typo
    expect(isNotificationKey("")).toBe(false);
  });

  it("isTypeEnabled falls back to the registry default when unset", () => {
    expect(isTypeEnabled(null, "game_results")).toBe(true);
    expect(isTypeEnabled({}, "chat")).toBe(true);
    expect(isTypeEnabled(undefined, "planning")).toBe(true);
  });

  it("isTypeEnabled honours a stored preference over the default", () => {
    // Both assertions must OPPOSE the default, or they pass without proving the
    // stored value is consulted at all. Now that every category defaults ON, a
    // stored `true` proves nothing — only a stored `false` does.
    expect(isTypeEnabled({ chat: false }, "chat")).toBe(false); // opted out
    expect(isTypeEnabled({ game_results: false }, "game_results")).toBe(false); // opted out
  });

  it("resolvePrefs returns every key merged with stored overrides", () => {
    expect(resolvePrefs({ chat: true, game_results: false })).toEqual({
      game_results: false,
      planning: true,
      invites: true,
      chat: true,
    });
  });

  it("notificationDefault matches the registry", () => {
    expect(notificationDefault("game_results")).toBe(true);
    expect(notificationDefault("chat")).toBe(true);
  });
});
