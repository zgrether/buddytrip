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

  // ── gate 3: preferences default from the registry, setPreference persists ──
  it("getPreferences returns registry defaults when unset (chat OFF)", async () => {
    const prefs = await ctx.caller().notifications.getPreferences();
    expect(prefs).toEqual({
      scores: true,
      planning: true,
      invites: true,
      chat: false,
    });
  });

  it("setPreference persists and merges (chat ON, others untouched)", async () => {
    const caller = ctx.caller();
    await caller.notifications.setPreference({ key: "chat", enabled: true });
    const prefs = await caller.notifications.getPreferences();
    expect(prefs.chat).toBe(true);
    expect(prefs.scores).toBe(true); // unchanged
    // reset
    await caller.notifications.setPreference({ key: "chat", enabled: false });
  });

  it("setPreference rejects a key outside the registry", async () => {
    await expect(
      ctx.caller().notifications.setPreference({ key: "score_posted", enabled: true })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("a member's subscription is theirs — a second user's getPreferences is independent", async () => {
    // Owner turns chat on; member still sees the default OFF (per-user prefs).
    await ctx.caller().notifications.setPreference({ key: "chat", enabled: true });
    const memberPrefs = await ctx.callerAs("member").notifications.getPreferences();
    expect(memberPrefs.chat).toBe(false);
    await ctx.caller().notifications.setPreference({ key: "chat", enabled: false });
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
    await seedDevice(); // a device exists, but chat is OFF by default
    sendMock.mockClear();

    const res = await sendPush(
      sctx.user.id,
      "chat",
      { title: "t", body: "b" },
      sctx.admin
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
      "scores", // default ON
      { title: "t", body: "b" },
      sctx.admin
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
      "scores",
      { title: "t", body: "b" },
      sctx.admin
    );
    expect(res.removedDead).toBeGreaterThanOrEqual(1);

    const { data } = await sctx.admin
      .from("push_subscriptions")
      .select("id")
      .eq("id", deadId);
    expect(data ?? []).toHaveLength(0); // pruned
  });
});
