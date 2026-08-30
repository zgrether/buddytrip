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

describe("notifications router", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
  });

  afterAll(async () => {
    // Clean up any subscriptions left by these tests (admin — bypasses RLS).
    await ctx.admin.from("push_subscriptions").delete().eq("user_id", ctx.user.id);
    // Reset prefs so other suites see a clean users row.
    await ctx.admin
      .from("users")
      .update({ notification_prefs: {} })
      .eq("id", ctx.user.id);
    await ctx.cleanup();
  });

  // ── gate 2: subscribe is idempotent ──────────────────────────────────────
  it("subscribe is idempotent — same endpoint twice → ONE row", async () => {
    const caller = ctx.caller();
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
    const caller = ctx.caller();
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
    const caller = ctx.caller();
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
    const other = ctx.getUser("member");
    await ctx.admin.from("push_subscriptions").insert({
      user_id: other.id,
      endpoint,
      p256dh: "k",
      auth: "a",
    });

    expect((await ctx.caller().notifications.isRegistered({ endpoint })).registered).toBe(false);

    await ctx.admin.from("push_subscriptions").delete().eq("endpoint", endpoint);
  });

  it("unsubscribing one device leaves the caller's OTHER devices registered", async () => {
    const caller = ctx.caller();
    const a = `https://example.test/ep/${genId("a")}`;
    const b = `https://example.test/ep/${genId("b")}`;
    await caller.notifications.subscribe({ endpoint: a, p256dh: "k", auth: "a" });
    await caller.notifications.subscribe({ endpoint: b, p256dh: "k", auth: "a" });

    await caller.notifications.unsubscribe({ endpoint: a });

    expect((await caller.notifications.isRegistered({ endpoint: a })).registered).toBe(false);
    expect((await caller.notifications.isRegistered({ endpoint: b })).registered).toBe(true);
  });

  // ── gate 3: preferences default from the registry, setPreference persists ──
  it("getPreferences returns registry defaults when unset (every category ON)", async () => {
    const prefs = await ctx.caller().notifications.getPreferences();
    expect(prefs).toEqual({
      game_results: true,
      planning: true,
      invites: true,
      chat: true,
      news: true,
    });
  });

  it("setPreference persists and merges (chat ON, others untouched)", async () => {
    const caller = ctx.caller();
    await caller.notifications.setPreference({ key: "chat", enabled: true });
    const prefs = await caller.notifications.getPreferences();
    expect(prefs.chat).toBe(true);
    expect(prefs.game_results).toBe(true); // unchanged
    // reset
    await caller.notifications.setPreference({ key: "chat", enabled: false });
  });

  it("setPreference rejects a key outside the registry", async () => {
    await expect(
      ctx.caller().notifications.setPreference({ key: "score_posted", enabled: true })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("a member's subscription is theirs — a second user's getPreferences is independent", async () => {
    // Owner turns chat OFF; the member is unaffected and still resolves to the
    // registry default. Storing FALSE rather than TRUE is deliberate: every
    // category now defaults ON, so a stored TRUE would match the default and
    // this would pass whether or not preferences are per-user.
    await ctx.caller().notifications.setPreference({ key: "chat", enabled: false });
    const memberPrefs = await ctx.callerAs("member").notifications.getPreferences();
    expect(memberPrefs.chat).toBe(true);
    await ctx.caller().notifications.setPreference({ key: "chat", enabled: true });
  });

  it("testSend delivers to the caller's own devices EVEN with the category off (bypasses the gate)", async () => {
    const caller = ctx.caller();
    // Seed a device and turn scores OFF — a self-test must still fire.
    await ctx.admin.from("push_subscriptions").insert({
      id: genId("sub"),
      user_id: ctx.user.id,
      endpoint: `https://example.test/ep/${genId("ep")}`,
      p256dh: "k",
      auth: "a",
    });
    await caller.notifications.setPreference({ key: "game_results", enabled: false });
    sendMock.mockClear();
    sendMock.mockResolvedValue({ statusCode: 201 });

    const res = await caller.notifications.testSend();
    expect(res.skippedPreferenceOff).toBe(false); // gate bypassed
    expect(res.sent).toBeGreaterThanOrEqual(1);

    await caller.notifications.setPreference({ key: "game_results", enabled: true });
  });
});

// ── gates 4 + 5: send helper respects prefs; dead endpoint pruned ───────────
// web-push is mocked (top of file) so nothing hits the network. The helper
// takes an injected admin client, so we drive it directly against the local DB.
describe("sendPush helper", () => {
  let sctx: TestContext;

  beforeAll(async () => {
    sctx = await TestContext.create();
  });
  afterAll(async () => {
    await sctx.admin.from("push_subscriptions").delete().eq("user_id", sctx.user.id);
    await sctx.admin.from("users").update({ notification_prefs: {} }).eq("id", sctx.user.id);
    await sctx.cleanup();
  });

  async function seedDevice(id = genId("sub")): Promise<string> {
    await sctx.admin.from("push_subscriptions").insert({
      id,
      user_id: sctx.user.id,
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
    await sctx.admin.from("users").update({ notification_prefs: { chat: false } }).eq("id", sctx.user.id);
    sendMock.mockClear();

    const res = await sendPush(
      sctx.user.id,
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
      sctx.user.id,
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
      sctx.user.id,
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
