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
  it("declares the confirmed taxonomy with chat OFF, the rest ON", () => {
    const byKey = Object.fromEntries(NOTIFICATION_TYPES.map((t) => [t.key, t]));
    expect(NOTIFICATION_KEYS).toEqual(["scores", "planning", "invites", "chat"]);
    expect(byKey.scores.defaultOn).toBe(true);
    expect(byKey.planning.defaultOn).toBe(true);
    expect(byKey.invites.defaultOn).toBe(true);
    expect(byKey.chat.defaultOn).toBe(false);
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
    expect(isNotificationKey("scores")).toBe(true);
    expect(isNotificationKey("score_posted")).toBe(false); // a call-site typo
    expect(isNotificationKey("")).toBe(false);
  });

  it("isTypeEnabled falls back to the registry default when unset", () => {
    expect(isTypeEnabled(null, "scores")).toBe(true);
    expect(isTypeEnabled({}, "chat")).toBe(false);
    expect(isTypeEnabled(undefined, "planning")).toBe(true);
  });

  it("isTypeEnabled honours a stored preference over the default", () => {
    expect(isTypeEnabled({ chat: true }, "chat")).toBe(true); // opted in
    expect(isTypeEnabled({ scores: false }, "scores")).toBe(false); // opted out
  });

  it("resolvePrefs returns every key merged with stored overrides", () => {
    expect(resolvePrefs({ chat: true, scores: false })).toEqual({
      scores: false,
      planning: true,
      invites: true,
      chat: true,
    });
  });

  it("notificationDefault matches the registry", () => {
    expect(notificationDefault("scores")).toBe(true);
    expect(notificationDefault("chat")).toBe(false);
  });
});
