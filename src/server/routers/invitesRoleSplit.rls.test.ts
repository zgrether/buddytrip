import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";

/**
 * Migration 103 — `invites_insert` reads the ROLE, not just the caller.
 *
 * Tested at the POLICY layer through each role's own authenticated client,
 * deliberately bypassing tRPC. A tRPC test proves nothing about a policy (#720),
 * and this is exactly the gap that caused #790's revert: the tRPC guard was
 * Owner-only, so the DB-layer hole was invisible from the procedure's tests.
 *
 * ── What this pins ──────────────────────────────────────────────────────────
 * Migration 101 widened `invites_insert` to `is_trip_planner` on the reasoning
 * that an invite "does not change who is TRUSTED … accepting one creates a
 * trip_members row through the signup path, not through this policy."
 *
 * The signup trigger does NOT create that row — it only sets
 * `invites.accepted_at`. The membership is written by the invitee's own client
 * (`src/app/invite/page.tsx`) copying `invite.role` into `trip_members`, which
 * passes RLS through the self-insert arm of `trip_members_insert`
 * (`user_id = auth.uid()::text`) — an arm with no role predicate.
 *
 * So `invites.role` DOES reach `trip_members`, and an Organizer able to write
 * `role: 'Organizer'` here could mint an Organizer. These tests fail if that
 * ever becomes possible again.
 *
 * "planner" is the shared test user holding the trip role `Organizer` (the
 * fixture name predates migration 029's rename).
 */
describe("migration 103 — invites_insert role split", () => {
  let ctx: TestContext;
  let tripId: string;

  beforeAll(async () => {
    ctx = await TestContext.create();
    tripId = await ctx.createTrip("Invite Role Split Trip");
    // Sequential, never Promise.all — these race (CLAUDE.md, learned ~6x).
    await ctx.addTripMember(tripId, "planner", "Organizer");
    await ctx.addTripMember(tripId, "member", "Member");
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  const invite = (role: "Organizer" | "Member", by: string) => ({
    trip_id: tripId,
    email: `role-split-${genId("e")}@example.test`,
    role,
    created_by: by,
  });

  // ── The rule: an Organizer may invite a Member, not an Organizer ──────────

  it("an Organizer CAN create a Member invite", async () => {
    const { error } = await ctx
      .authedClient("planner")
      .from("invites")
      .insert(invite("Member", ctx.getUser("planner").id));
    expect(error).toBeNull();
  });

  it("an Organizer CANNOT create an ORGANIZER invite", async () => {
    // The bypass this migration closes. Before 103 this succeeded, and the
    // invitee's own client then copied 'Organizer' into trip_members.
    const { error } = await ctx
      .authedClient("planner")
      .from("invites")
      .insert(invite("Organizer", ctx.getUser("planner").id));
    expect(error).not.toBeNull();
  });

  it("an Organizer omitting role gets the 'Member' default, and it is allowed", async () => {
    // `invites.role` is NOT NULL DEFAULT 'Member', so an omitted role can never
    // be NULL — the policy's `role = 'Member'` arm can't be defeated by null
    // three-valued logic.
    const { error } = await ctx
      .authedClient("planner")
      .from("invites")
      .insert({
        trip_id: tripId,
        email: `role-split-default-${genId("e")}@example.test`,
        created_by: ctx.getUser("planner").id,
      });
    expect(error).toBeNull();
  });

  // ── The Owner is unaffected in BOTH directions (#786's both-directions rule) ──

  it("the Owner CAN create a Member invite", async () => {
    const { error } = await ctx
      .authedClient("owner")
      .from("invites")
      .insert(invite("Member", ctx.getUser("owner").id));
    expect(error).toBeNull();
  });

  it("the Owner CAN create an ORGANIZER invite", async () => {
    const { error } = await ctx
      .authedClient("owner")
      .from("invites")
      .insert(invite("Organizer", ctx.getUser("owner").id));
    expect(error).toBeNull();
  });

  // ── A Member still cannot invite at all (101's behaviour, unchanged) ───────

  it("a Member CANNOT create an invite of either role", async () => {
    const asMember = ctx.authedClient("member");
    const memberId = ctx.getUser("member").id;
    const { error: e1 } = await asMember.from("invites").insert(invite("Member", memberId));
    const { error: e2 } = await asMember.from("invites").insert(invite("Organizer", memberId));
    expect(e1).not.toBeNull();
    expect(e2).not.toBeNull();
  });

  it("an outsider CANNOT create an invite", async () => {
    const { error } = await ctx
      .authedClient("outsider")
      .from("invites")
      .insert(invite("Member", ctx.getUser("outsider").id));
    expect(error).not.toBeNull();
  });
});
