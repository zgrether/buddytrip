import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";

/**
 * Migration 092 RLS backstop (gate 1): a user may only read their OWN push
 * subscriptions. This tests the POLICY directly (via each user's authed
 * client), independent of the notifications router — so the migration PR is
 * verifiable on its own.
 */
describe("push_subscriptions RLS", () => {
  let ctx: TestContext;
  let ownerSubId: string;

  beforeAll(async () => {
    ctx = await TestContext.create();
    // Seed a subscription for the OWNER via the admin client (bypasses RLS).
    ownerSubId = genId("sub");
    const { error } = await ctx.admin.from("push_subscriptions").insert({
      id: ownerSubId,
      user_id: ctx.user.id,
      endpoint: `https://example.test/ep/${ownerSubId}`,
      p256dh: "test-p256dh",
      auth: "test-auth",
      user_agent: "vitest",
    });
    if (error) throw new Error(`seed failed: ${error.message}`);
  });

  afterAll(async () => {
    await ctx.admin.from("push_subscriptions").delete().eq("id", ownerSubId);
    await ctx.cleanup();
  });

  it("the owner can read their own subscription", async () => {
    const client = ctx.authedClient("owner");
    const { data } = await client
      .from("push_subscriptions")
      .select("id")
      .eq("id", ownerSubId);
    expect(data?.map((r) => r.id)).toContain(ownerSubId);
  });

  it("another user CANNOT read the owner's subscription (RLS)", async () => {
    const outsider = ctx.authedClient("outsider");
    const { data } = await outsider
      .from("push_subscriptions")
      .select("id")
      .eq("id", ownerSubId);
    // RLS filters it out — a non-owner sees zero rows, never an error.
    expect(data ?? []).toHaveLength(0);
  });

  it("another user CANNOT delete the owner's subscription (RLS)", async () => {
    const outsider = ctx.authedClient("outsider");
    await outsider.from("push_subscriptions").delete().eq("id", ownerSubId);
    // The row survives — RLS scoped the delete to the outsider's (empty) rows.
    const { data } = await ctx.admin
      .from("push_subscriptions")
      .select("id")
      .eq("id", ownerSubId);
    expect(data?.map((r) => r.id)).toContain(ownerSubId);
  });

  it("a user cannot insert a subscription owned by someone else (RLS WITH CHECK)", async () => {
    const outsider = ctx.authedClient("outsider");
    const { error } = await outsider.from("push_subscriptions").insert({
      id: genId("sub"),
      user_id: ctx.user.id, // owner — not the caller
      endpoint: `https://example.test/ep/${genId("ep")}`,
      p256dh: "x",
      auth: "y",
    });
    expect(error).not.toBeNull(); // WITH CHECK (user_id = auth.uid) rejects it
  });
});
