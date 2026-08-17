import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";
import { findOrphanBlockers, orphanRefusalMessage } from "../lib/ownerGuard";

/**
 * #957 — a sole Owner must not be able to orphan a trip.
 *
 * Losing the only Owner leaves the trip alive, populated, and permanently
 * unmanageable: every Owner-gated action fails, INCLUDING `trips.delete`
 * (`requireTripRole("Owner")`), so nothing in the app can remove it. #914 found
 * five real trips in that state.
 *
 * Two procedures could reach it, and they are DIFFERENT shapes — that is why
 * the guard is one shared predicate rather than a check bolted onto whichever
 * bug was reported first:
 *   `users.deleteMe`     — account-scoped; cascades the membership away.
 *   `ghostCrew.remove`   — trip-scoped; deletes a membership keyed on a
 *                          supplied id with no `is_guest` filter, so an Owner
 *                          passing their OWN id bypasses `tripMembers.remove`'s
 *                          "Cannot remove yourself" guard (different procedure).
 *
 * These tests exercise the PREDICATE directly rather than calling `deleteMe`,
 * because `deleteMe` destroys a shared persistent test user on success and the
 * suite's other files depend on all four existing. The predicate is the whole
 * decision — the procedure only throws on its output — and the refusal path IS
 * covered end to end via `ghostCrew.remove`, which is safely repeatable.
 */

let ctx: TestContext;

describe("#957 orphan guard — findOrphanBlockers", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
  });
  afterAll(async () => {
    await ctx.cleanup();
  });

  it("BLOCKS: sole Owner of a trip with other members", async () => {
    const tripId = await ctx.createTrip("Sole Owner Trip");
    await ctx.addTripMember(tripId, "member", "Member");

    const blockers = await findOrphanBlockers(ctx.admin, ctx.user.id, { tripId });
    expect(blockers).toHaveLength(1);
    expect(blockers[0]).toMatchObject({
      tripId,
      hasOtherMembers: true,
      hasTransferTarget: true, // `member` is real, non-guest, status "in"
    });
  }, 60_000);

  it("BLOCKS: an ORGANIZER is not an Owner — still refused", async () => {
    // The case most likely to be got wrong by a "someone else can manage it"
    // shortcut. Organizer is a real role with real rights, and none of them is
    // Owner: `trips.delete` and `transferOwnership` both require Owner.
    const tripId = await ctx.createTrip("Organizer Not Owner Trip");
    await ctx.addTripMember(tripId, "planner", "Organizer");

    const blockers = await findOrphanBlockers(ctx.admin, ctx.user.id, { tripId });
    expect(blockers).toHaveLength(1);
    expect(blockers[0].hasTransferTarget).toBe(true); // transfer IS the way out
  }, 60_000);

  it("ALLOWS: a second Owner exists — nothing would be orphaned", async () => {
    const tripId = await ctx.createTrip("Two Owners Trip");
    await ctx.addTripMember(tripId, "member", "Owner");

    expect(await findOrphanBlockers(ctx.admin, ctx.user.id, { tripId })).toEqual([]);
  }, 60_000);

  it("ALLOWS: user owns no trips at all", async () => {
    const outsiderId = ctx.getUser("outsider").id;
    expect(await findOrphanBlockers(ctx.admin, outsiderId)).toEqual([]);
  }, 60_000);

  it("BLOCKS with the DEAD-END message when the only other members are guests", async () => {
    // The case that makes "transfer ownership first" dishonest: placeholders
    // can't be transfer targets, so pointing at transfer would leave the user
    // with no move. The message must offer the real exit instead.
    const tripId = await ctx.createTrip("Guests Only Trip");
    const guest = await ctx.caller().ghostCrew.create({ tripId, name: "Placeholder Pal" });

    const blockers = await findOrphanBlockers(ctx.admin, ctx.user.id, { tripId });
    expect(blockers).toHaveLength(1);
    expect(blockers[0]).toMatchObject({ hasOtherMembers: true, hasTransferTarget: false });

    const msg = orphanRefusalMessage(blockers, "delete-account");
    expect(msg).toContain("Guests Only Trip");
    expect(msg).toMatch(/delete that trip first/i);
    // Must NOT tell them to do the impossible thing.
    expect(msg).not.toMatch(/transfer ownership to another member first/i);

    await ctx.admin.from("trip_members").delete().eq("trip_id", tripId).eq("user_id", guest.id);
  }, 60_000);

  it("CAPS the named trips instead of listing all of them", async () => {
    // Found by looking at the real surface, not by a test: an account owning
    // 19 trips produced a wall of text that repeated every title in the prose
    // AND again in the list beneath it. Naming all of them is only readable at
    // small N, and the UI list is already the full enumeration.
    const many: Parameters<typeof orphanRefusalMessage>[0] = Array.from({ length: 19 }, (_, i) => ({
      tripId: `t${i}`,
      title: `Trip ${i}`,
      hasTransferTarget: true,
      hasOtherMembers: true,
    }));
    const msg = orphanRefusalMessage(many, "delete-account");

    expect(msg).toContain("Trip 0");
    expect(msg).toContain("and 16 more"); // 19 − 3 shown
    expect(msg).not.toContain("Trip 18"); // not enumerated
    expect(msg.length).toBeLessThan(400); // stays a readable sentence
  });

  it("the normal message names the blocking trips and points at transfer", async () => {
    const tripId = await ctx.createTrip("Named In Message Trip");
    await ctx.addTripMember(tripId, "member", "Member");

    const msg = orphanRefusalMessage(
      await findOrphanBlockers(ctx.admin, ctx.user.id, { tripId }),
      "delete-account"
    );
    // §4.4 — fail loud: the user must know WHICH trip to act on.
    expect(msg).toContain("Named In Message Trip");
    expect(msg).toMatch(/transfer ownership/i);
  }, 60_000);
});

describe("#957 orphan guard — ghostCrew.remove (the sibling path)", () => {
  it("REFUSES an Owner removing their own membership via the guest-removal route", async () => {
    // Before #957 this succeeded: the delete keys on `guestUserId` with no
    // is_guest filter, and RLS permits it (`user_id = auth.uid()` matches), so
    // the Owner removed themselves and orphaned the trip — routing around
    // `tripMembers.remove`'s self-guard entirely.
    const tripId = await ctx.createTrip("Self Remove Via Ghost Path");
    await ctx.addTripMember(tripId, "member", "Member");

    await expect(
      ctx.caller().ghostCrew.remove({ tripId, guestUserId: ctx.user.id })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

    // The membership is still there — refusal wrote nothing.
    const { data } = await ctx.admin
      .from("trip_members")
      .select("user_id, role")
      .eq("trip_id", tripId)
      .eq("user_id", ctx.user.id)
      .maybeSingle();
    expect(data).toMatchObject({ role: "Owner" });
  }, 60_000);

  it("still removes an actual guest — the guard only blocks the orphaning case", async () => {
    const tripId = await ctx.createTrip("Guest Removal Still Works");
    await ctx.addTripMember(tripId, "member", "Member");
    const guest = await ctx.caller().ghostCrew.create({ tripId, name: "Removable Guest" });

    await expect(
      ctx.caller().ghostCrew.remove({ tripId, guestUserId: guest.id })
    ).resolves.toMatchObject({ success: true });

    const { data } = await ctx.admin
      .from("trip_members")
      .select("user_id")
      .eq("trip_id", tripId)
      .eq("user_id", guest.id)
      .maybeSingle();
    expect(data).toBeNull();
  }, 60_000);
});
