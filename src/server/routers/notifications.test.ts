import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";
import { sendPush } from "../lib/sendPush";

// Mock web-push at the module boundary (top-level + hoisted so it intercepts
// before sendPush imports it). `sendMock` stands in for the network call.
const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));
vi.mock("../lib/vapid", () => ({
  pushConfigured: () => true,
  getWebPush: () => ({ sendNotification: sendMock }),
}));

let ctx: TestContext;
/** This block's own account (#1540, CLAUDE.md #6). Devices are person-scoped:
 *  registering them on the SHARED owner, and then deleting every device the
 *  owner had in afterAll, wiped devices other files had just seeded for the
 *  same owner — reproduced on clean main with notifications.gameResultsPreference. */
let me: Awaited<ReturnType<TestContext["createAccount"]>>;

describe("notifications router", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
    me = await ctx.createAccount("notif-router");
  });

  afterAll(async () => {
    // Clean up any subscriptions left by these tests (admin — bypasses RLS).
    await ctx.admin.from("push_subscriptions").delete().eq("user_id", me.id);
    // (No preference reset any more: this block no longer writes the shared
    // owner's preferences, and resetting them here ran UNDER any other file
    // that had set them — #1540.)
    await ctx.cleanup();
  });

  // ── gate 2: subscribe is idempotent ──────────────────────────────────────
  it("subscribe is idempotent — same endpoint twice → ONE row", async () => {
    const caller = me.caller();
    const endpoint = `https://example.test/ep/${genId("ep")}`;
    await caller.notifications.subscribe({ endpoint, p256dh: "k1", auth: "a1" });
    await caller.notifications.subscribe({ endpoint, p256dh: "k2", auth: "a2" });

    const { data } = await ctx.admin
      .from("push_subscriptions")
      .select("id, p256dh")
      .eq("endpoint", endpoint);
    expect(data).toHaveLength(1);
    expect(data![0].p256dh).toBe("k2"); // refreshed, not duplicated
  });

  it("unsubscribe removes the caller's device by endpoint", async () => {
    const caller = me.caller();
    const endpoint = `https://example.test/ep/${genId("ep")}`;
    await caller.notifications.subscribe({ endpoint, p256dh: "k", auth: "a" });
    await caller.notifications.unsubscribe({ endpoint });

    const { data } = await ctx.admin
      .from("push_subscriptions")
      .select("id")
      .eq("endpoint", endpoint);
    expect(data ?? []).toHaveLength(0);
  });

  /**
   * `isRegistered` is the third input the device toggle needs — permission and
   * the live browser subscription are readable client-side, this one is not.
   * Without it the label could only guess, and it guessed by not looking at all.
   */
  it("isRegistered tracks subscribe and unsubscribe for THIS endpoint", async () => {
    const caller = me.caller();
    const endpoint = `https://example.test/ep/${genId("ep")}`;

    expect((await caller.notifications.isRegistered({ endpoint })).registered).toBe(false);
    await caller.notifications.subscribe({ endpoint, p256dh: "k", auth: "a" });
    expect((await caller.notifications.isRegistered({ endpoint })).registered).toBe(true);
    await caller.notifications.unsubscribe({ endpoint });
    expect((await caller.notifications.isRegistered({ endpoint })).registered).toBe(false);
  });

  it("isRegistered is scoped to the caller — another account's endpoint reads false", async () => {
    // It must not be usable to probe whether some other user has registered a
    // given endpoint, and turning one device off must never report on another's.
    const endpoint = `https://example.test/ep/${genId("other")}`;
    // Another account of the test's own — not the shared member, whose devices
    // other files count.
    const other = await ctx.createAccount("notif-other");
    await ctx.admin.from("push_subscriptions").insert({
      user_id: other.id,
      endpoint,
      p256dh: "k",
      auth: "a",
    });

    expect((await me.caller().notifications.isRegistered({ endpoint })).registered).toBe(false);

    await ctx.admin.from("push_subscriptions").delete().eq("endpoint", endpoint);
  });

  it("unsubscribing one device leaves the caller's OTHER devices registered", async () => {
    const caller = me.caller();
    const a = `https://example.test/ep/${genId("a")}`;
    const b = `https://example.test/ep/${genId("b")}`;
    await caller.notifications.subscribe({ endpoint: a, p256dh: "k", auth: "a" });
    await caller.notifications.subscribe({ endpoint: b, p256dh: "k", auth: "a" });

    await caller.notifications.unsubscribe({ endpoint: a });

    expect((await caller.notifications.isRegistered({ endpoint: a })).registered).toBe(false);
    expect((await caller.notifications.isRegistered({ endpoint: b })).registered).toBe(true);
  });

  // ── gate 3: preferences default from the registry, setPreference persists ──
  //
  // EACH CASE USES AN ACCOUNT OF ITS OWN (#1527, found at seed 4096; and
  // CLAUDE.md #6). These used to write the SHARED owner's preferences, and the
  // persist case's "reset" set chat to FALSE — the opposite of the default — so
  // "returns registry defaults when unset" failed whenever it ran after it. A
  // shared user's preferences are person-scoped state other files read too.

  it("getPreferences returns registry defaults when unset (every category ON)", async () => {
    const account = await ctx.createAccount("prefs-defaults");
    const prefs = await account.caller().notifications.getPreferences();
    expect(prefs).toEqual({
      game_results: true,
      planning: true,
      invites: true,
      chat: true,
      news: true,
      organizer: true,
    });
  });

  it("setPreference persists and merges (chat OFF, others untouched)", async () => {
    // FALSE, not TRUE: every category defaults ON, so storing TRUE would match
    // the default and "persists" would pass whether or not anything was saved.
    // This case used to do exactly that.
    const account = await ctx.createAccount("prefs-persist");
    const caller = account.caller();
    await caller.notifications.setPreference({ key: "chat", enabled: false });
    const prefs = await caller.notifications.getPreferences();
    expect(prefs.chat).toBe(false);
    expect(prefs.game_results).toBe(true); // unchanged
    expect(prefs.news).toBe(true); // unchanged
  });

  it("setPreference rejects a key outside the registry", async () => {
    const account = await ctx.createAccount("prefs-unknown-key");
    await expect(
      account.caller().notifications.setPreference({ key: "score_posted", enabled: true })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("a member's subscription is theirs — a second user's getPreferences is independent", async () => {
    // One account turns chat OFF; another is unaffected and still resolves to
    // the registry default. Storing FALSE rather than TRUE is deliberate: every
    // category now defaults ON, so a stored TRUE would match the default and
    // this would pass whether or not preferences are per-user.
    const first = await ctx.createAccount("prefs-first");
    const second = await ctx.createAccount("prefs-second");
    await first.caller().notifications.setPreference({ key: "chat", enabled: false });
    expect((await first.caller().notifications.getPreferences()).chat).toBe(false); // premise
    const secondPrefs = await second.caller().notifications.getPreferences();
    expect(secondPrefs.chat).toBe(true);
  });

  it("testSend delivers to the caller's own devices EVEN with the category off (bypasses the gate)", async () => {
    const account = await ctx.createAccount("prefs-testsend");
    const caller = account.caller();
    // Seed a device and turn scores OFF — a self-test must still fire.
    const { error } = await ctx.admin.from("push_subscriptions").insert({
      id: genId("sub"),
      user_id: account.id,
      endpoint: `https://example.test/ep/${genId("ep")}`,
      p256dh: "k",
      auth: "a",
    });
    if (error) throw new Error(`seed device: ${error.message}`);
    await caller.notifications.setPreference({ key: "game_results", enabled: false });
    sendMock.mockClear();
    sendMock.mockResolvedValue({ statusCode: 201 });

    const res = await caller.notifications.testSend();
    expect(res.skippedPreferenceOff).toBe(false); // gate bypassed
    expect(res.sent).toBeGreaterThanOrEqual(1);
  });
});

// ── gates 4 + 5: send helper respects prefs; dead endpoint pruned ───────────
// web-push is mocked (top of file) so nothing hits the network. The helper
// takes an injected admin client, so we drive it directly against the local DB.
describe("sendPush helper", () => {
  let sctx: TestContext;
  /** Its own account, for the same reason as the router block above (#1540). */
  let target: { id: string };

  beforeAll(async () => {
    sctx = await TestContext.create();
    target = await sctx.createAccount("sendpush-target");
  });
  afterAll(async () => {
    await sctx.admin.from("push_subscriptions").delete().eq("user_id", target.id);
    await sctx.cleanup();
  });

  async function seedDevice(id = genId("sub")): Promise<string> {
    await sctx.admin.from("push_subscriptions").insert({
      id,
      user_id: target.id,
      endpoint: `https://example.test/ep/${genId("ep")}`,
      p256dh: "k",
      auth: "a",
    });
    return id;
  }

  it("gate 4: type OFF → NO send", async () => {
    await seedDevice();
    // Every category defaults ON now, so the gate must be tested with an EXPLICIT
    // opt-out — the only input that distinguishes "reads the stored value" from
    // "assumes on", and the one standing between a muted user and the push.
    await sctx.admin.from("users").update({ notification_prefs: { chat: false } }).eq("id", target.id);
    sendMock.mockClear();

    const res = await sendPush(
      target.id,
      "chat",
      { title: "t", body: "b" },
      { admin: sctx.admin }
    );
    expect(res.skippedPreferenceOff).toBe(true);
    expect(res.sent).toBe(0);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("type ON → sends to every device", async () => {
    await seedDevice();
    sendMock.mockClear();
    sendMock.mockResolvedValue({ statusCode: 201 });

    const res = await sendPush(
      target.id,
      "game_results", // default ON
      { title: "t", body: "b" },
      { admin: sctx.admin }
    );
    expect(res.sent).toBeGreaterThanOrEqual(1);
    expect(sendMock).toHaveBeenCalled();
  });

  it("gate 5: a 410 from the push service DELETES that subscription", async () => {
    const deadId = await seedDevice();
    sendMock.mockClear();
    sendMock.mockRejectedValue({ statusCode: 410 }); // Gone

    const res = await sendPush(
      target.id,
      "game_results",
      { title: "t", body: "b" },
      { admin: sctx.admin }
    );
    expect(res.removedDead).toBeGreaterThanOrEqual(1);

    const { data } = await sctx.admin
      .from("push_subscriptions")
      .select("id")
      .eq("id", deadId);
    expect(data ?? []).toHaveLength(0); // pruned
  });
});
