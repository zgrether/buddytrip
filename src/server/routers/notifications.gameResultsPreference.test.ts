import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";
import { sendPushToUsers } from "../lib/sendPushToUsers";

/**
 * The `game_results` preference, end to end: the toggle writes it, and the SERVER
 * honours it.
 *
 * ── Why this test and not a UI one ──────────────────────────────────────────
 * `game_results` is the one wired category — `games.finish` and the cup clinch both
 * send under it — and until now it had no off switch anywhere. Adding one is
 * only worth doing if the preference is ENFORCED; a switch over an unenforced
 * preference is worse than no switch, because it tells someone they have opted
 * out while the pushes keep arriving. That is how people disable notifications
 * at the OS level permanently, which is unrecoverable.
 *
 * So the assertion that matters is not that the control renders. It is that
 * turning it off removes the user from the audience at SEND time, and that the
 * skip is recorded — `skipped_preference_off` in `push_send_log`, read back
 * from the table rather than inferred from a return value.
 */

let ctx: TestContext;
let userId: string;
const TRIGGER = `test:game-results-pref-${genId("t")}`;

const PAYLOAD = { title: "Final: Test", body: "Alpha 2 – Bravo 1" };

/** Set the preference through the REAL front door the toggle uses. */
async function setGameResults(enabled: boolean) {
  await ctx.caller().notifications.setPreference({ key: "game_results", enabled });
}

/** Send under `game_results` with the log context a real trigger passes. */
async function send() {
  return sendPushToUsers([userId], "game_results", PAYLOAD, {
    admin: ctx.admin,
    context: { trigger: TRIGGER, actorUserId: "someone-else" },
  });
}

/** The recorded row — the durable half, read from the table. */
async function lastRow() {
  const { data } = await ctx.admin
    .from("push_send_log")
    .select("recipients, skipped_preference_off, sent, subscriptions_found, outcome")
    .eq("trigger", TRIGGER)
    .order("created_at", { ascending: false })
    .limit(1);
  return (data ?? [])[0];
}

beforeAll(async () => {
  ctx = await TestContext.create();
  userId = ctx.getUser("owner").id;
}, 120_000);

afterAll(async () => {
  await ctx.admin.from("push_send_log").delete().eq("trigger", TRIGGER);
  // Leave no stored preference behind — the next suite's user must resolve
  // through the registry default, not this suite's leftovers.
  await ctx.admin.from("users").update({ notification_prefs: {} }).eq("id", userId);
  await ctx.cleanup();
}, 60_000);

describe("the game_results preference is enforced, not decorative", () => {
  it("UNSET resolves to the registry default (game_results is ON) — the state of every user today", async () => {
    // What the toggle must render for someone who has never touched it. If this
    // were false, every correctly-opted-in user would see a switch saying they
    // are opted out.
    await ctx.admin.from("users").update({ notification_prefs: {} }).eq("id", userId);

    const prefs = await ctx.caller().notifications.getPreferences();
    expect(prefs.game_results).toBe(true);

    const res = await send();
    expect(res.skippedPreferenceOff, "an unset preference must not skip").toBe(0);
    expect(res.recipients).toBe(1);
  }, 60_000);

  it("OFF removes the user at SEND time, and the skip is RECORDED", async () => {
    await setGameResults(false);
    expect((await ctx.caller().notifications.getPreferences()).game_results).toBe(false);

    const res = await send();

    expect(res.skippedPreferenceOff).toBe(1);
    expect(res.sent).toBe(0);
    expect(res.subscriptionsFound, "filtered out before devices are even read").toBe(0);

    // The durable half — read from the table, not from the return value.
    const row = await lastRow();
    expect(row?.skipped_preference_off, "the skip must be legible days later").toBe(1);
    expect(row?.sent).toBe(0);
  }, 60_000);

  it("ON again puts the user back in the audience", async () => {
    await setGameResults(true);
    expect((await ctx.caller().notifications.getPreferences()).game_results).toBe(true);

    const res = await send();
    expect(res.skippedPreferenceOff).toBe(0);
    expect(res.recipients).toBe(1);
  }, 60_000);

  it("toggling game_results does NOT disturb chat — the categories are independent", async () => {
    // One stored jsonb map holds both, and `setPreference` read-modify-writes
    // it. A clobbering write would silently flip a category the user never
    // touched — and since chat defaults ON, the damage runs toward NOISE:
    // someone who deliberately muted the firehose gets quietly unmuted, which
    // is the fastest route to an OS-level opt-out. (This comment used to say
    // chat defaulted OFF and reasoned the opposite direction; the default was
    // flipped and the comment was not. The test itself sets chat explicitly, so
    // it never depended on the default — only the explanation was wrong.)
    await ctx.caller().notifications.setPreference({ key: "chat", enabled: true });
    await setGameResults(false);

    const prefs = await ctx.caller().notifications.getPreferences();
    expect(prefs.chat, "chat survives a game_results write").toBe(true);
    expect(prefs.game_results).toBe(false);

    await setGameResults(true);
    expect((await ctx.caller().notifications.getPreferences()).chat).toBe(true);
  }, 60_000);
});

/**
 * ACTIVATION AND PREFERENCES ARE SEPARATE AXES — the invariant the notifications
 * modal's parent control exists to express.
 *
 * The rejected design was to DERIVE activation from the categories: no parent
 * control, check a box and it turns on, uncheck them all and it turns off. This
 * is the server-side half of why that cannot work. Muting every category must
 * leave the device SUBSCRIBED: the subscription is a browser permission plus a
 * `push_subscriptions` row, and neither is ours to drop because someone stopped
 * wanting one kind of message. Turning them all back on has to be a checkbox,
 * not a fresh permission prompt that a browser may refuse permanently.
 */
describe("muting every category leaves the device activated", () => {
  const ENDPOINT = `https://example.test/endpoint/${genId("e")}`;

  it("keeps the push_subscriptions row while sending nothing", async () => {
    // A registered device, through the same procedure the modal's toggle uses.
    await ctx.caller().notifications.subscribe({
      endpoint: ENDPOINT,
      p256dh: "test-p256dh-key",
      auth: "test-auth-key",
    });

    // Mute EVERY exposed category.
    await ctx.caller().notifications.setPreference({ key: "game_results", enabled: false });
    await ctx.caller().notifications.setPreference({ key: "chat", enabled: false });

    const res = await send();
    expect(res.skippedPreferenceOff).toBe(1);
    expect(res.sent).toBe(0);

    // THE ASSERTION THAT MATTERS: the device is still registered. Asserted on the
    // ROW rather than on a return value — a helper reporting "still subscribed"
    // is the thing being checked, so it cannot also be the evidence.
    const { data } = await ctx.admin
      .from("push_subscriptions")
      .select("endpoint")
      .eq("user_id", userId)
      .eq("endpoint", ENDPOINT);
    expect(
      (data ?? []).length,
      "muting categories must not unsubscribe the device — re-activating would need a fresh permission prompt, which a browser can refuse permanently"
    ).toBe(1);

    // And the device is still reported as registered, which is what makes the
    // modal show the category list rather than the activation prompt.
    const reg = await ctx.caller().notifications.isRegistered({ endpoint: ENDPOINT });
    expect(reg.registered).toBe(true);

    await ctx.caller().notifications.unsubscribe({ endpoint: ENDPOINT });
  });
});
