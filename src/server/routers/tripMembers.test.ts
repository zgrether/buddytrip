import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";
import { sendInvitationBlast } from "@/lib/email";

vi.mock("@/lib/email", () => ({
  sendInvitationBlast: vi.fn().mockResolvedValue({ id: "mock-email-id" }),
  sendInviteExistingUser: vi.fn().mockResolvedValue({}),
  sendInviteNewUser: vi.fn().mockResolvedValue({}),
}));

/**
 * EVERY TEST BUILDS THE TRIP IT USES (#1527). The first block used to share one
 * trip: "add — owner can add" put the outsider on it, and the duplicate,
 * promote and remove cases depended on that, while "list" expected exactly
 * three members — so the order of the cases decided the results. The travel
 * block's "departure leg is independent" relied on the case before it having
 * set a departure. Shuffled order surfaced 5 such dependencies.
 */

let ctx: TestContext;

/** Owner = primary user; planner = Organizer; member = Member. */
async function crewTrip(label: string): Promise<string> {
  const tripId = await ctx.createTrip(`Members ${label}`);
  await ctx.addTripMember(tripId, "planner", "Organizer");
  await ctx.addTripMember(tripId, "member", "Member");
  return tripId;
}

async function roleOf(tripId: string, userId: string): Promise<string | null> {
  const { data, error } = await ctx.admin
    .from("trip_members")
    .select("role")
    .eq("trip_id", tripId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`read role: ${error.message}`);
  return (data?.role as string | undefined) ?? null;
}

async function nicknameOf(tripId: string, userId: string): Promise<string | null> {
  const { data, error } = await ctx.admin
    .from("trip_members")
    .select("nickname")
    .eq("trip_id", tripId)
    .eq("user_id", userId)
    .single();
  if (error) throw new Error(`read nickname: ${error.message}`);
  return (data?.nickname as string | null) ?? null;
}

describe("tripMembers router", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
  }, 30_000);

  afterAll(async () => {
    await ctx.cleanup();
  }, 30_000);

  it("list — any member can view crew roster", async () => {
    const tripId = await crewTrip("list");
    const members = await ctx.callerAs("member").tripMembers.list({ tripId });
    expect(members.length).toBe(3);
    expect(members[0].user).toBeTruthy();
  });

  it("add — owner can add a member", async () => {
    const tripId = await crewTrip("add-owner");
    const outsider = ctx.getUser("outsider");
    expect(await roleOf(tripId, outsider.id)).toBeNull(); // premise: not on it yet
    const added = await ctx.caller().tripMembers.add({ tripId, userId: outsider.id });
    expect(added.user_id).toBe(outsider.id);
    expect(added.role).toBe("Member");
    expect(await roleOf(tripId, outsider.id)).toBe("Member");
  });

  // #786/#824 — this asserted the OLD rule ("planner cannot add"). Adding crew
  // is helping run the trip, and moved to Organizer once migration 122 defended
  // the role column. What stays Owner-only is GRANTING a role, pinned below.
  it("add — planner CAN add a Member", async () => {
    const tripId = await crewTrip("add-organizer");
    const uid = genId("addable-user");
    const { error } = await ctx.admin.from("users").insert({ id: uid, name: "Addable", is_guest: true });
    if (error) throw new Error(`seed user: ${error.message}`);
    await expect(ctx.callerAs("planner").tripMembers.add({ tripId, userId: uid })).resolves.toBeTruthy();
    expect(await roleOf(tripId, uid)).toBe("Member");
    await ctx.admin.from("trip_members").delete().eq("trip_id", tripId).eq("user_id", uid);
    await ctx.admin.from("users").delete().eq("id", uid);
  });

  it("add — planner CANNOT grant Organizer (changing who is trusted stays Owner-only)", async () => {
    const tripId = await crewTrip("add-organizer-grant");
    await expect(
      ctx.callerAs("planner").tripMembers.add({ tripId, userId: genId("fake-user"), role: "Organizer" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("add — member cannot add", async () => {
    const tripId = await crewTrip("add-member");
    // A made-up id: the FORBIDDEN check fires before any user lookup.
    await expect(
      ctx.callerAs("member").tripMembers.add({ tripId, userId: genId("fake-user") })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("add — duplicate throws CONFLICT", async () => {
    const tripId = await crewTrip("add-duplicate");
    const member = ctx.getUser("member");
    expect(await roleOf(tripId, member.id)).toBe("Member"); // premise: already on the trip
    await expect(ctx.caller().tripMembers.add({ tripId, userId: member.id })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("updateRole — owner can promote member to planner", async () => {
    const tripId = await crewTrip("promote");
    const member = ctx.getUser("member");
    const updated = await ctx.caller().tripMembers.updateRole({ tripId, userId: member.id, role: "Organizer" });
    expect(updated.role).toBe("Organizer");
    expect(await roleOf(tripId, member.id)).toBe("Organizer");
  });

  it("updateRole — promotion posts a system line in the Organizers chat", async () => {
    // Regression: the messages_insert RLS policy only allows a member to insert
    // their own message_type='user' rows, so system lines (user_id=null,
    // message_type='system') must go through the service-role admin client.
    // This proves the promotion announcement actually lands in the channel.
    const tripId = await ctx.createTrip("Promote Announce Trip");
    await ctx.addTripMember(tripId, "member", "Member");
    const owner = ctx.caller();
    await owner.tripMembers.updateRole({ tripId, userId: ctx.getUser("member").id, role: "Organizer" });
    const planning = await owner.messages.list({ tripId, visibility: "planning" });
    expect(planning.some((m) => m.message_type === "system" && /is now an organizer/.test(m.text))).toBe(true);
  });

  it("updateRole — owner cannot change own role", async () => {
    const tripId = await crewTrip("own-role");
    await expect(
      ctx.caller().tripMembers.updateRole({ tripId, userId: ctx.user.id, role: "Member" })
    ).rejects.toThrow("Cannot change your own role");
    expect(await roleOf(tripId, ctx.user.id)).toBe("Owner");
  });

  it("updateRole — planner cannot change roles", async () => {
    const tripId = await crewTrip("organizer-role");
    const member = ctx.getUser("member");
    await expect(
      ctx.callerAs("planner").tripMembers.updateRole({ tripId, userId: member.id, role: "Organizer" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await roleOf(tripId, member.id)).toBe("Member");
  });

  it("inviteByEmail — owner can invite a new email", async () => {
    const tripId = await crewTrip("invite-new");
    const result = await ctx.caller().tripMembers.inviteByEmail({ tripId, email: `newperson-${Date.now()}@example.com` });
    expect(result.status).toBe("invited_new");
    expect(result.userId).toBeTruthy();
  });

  it("inviteByEmail — duplicate invite returns already_member", async () => {
    const tripId = await crewTrip("invite-dup");
    const email = `dup-${Date.now()}@example.com`;
    expect((await ctx.caller().tripMembers.inviteByEmail({ tripId, email })).status).toBe("invited_new"); // premise
    const result = await ctx.caller().tripMembers.inviteByEmail({ tripId, email });
    expect(result.status).toBe("already_member");
  });

  it("inviteByEmail — existing real user gets added directly", async () => {
    const tripId = await ctx.createTrip("Invite Fresh Trip");
    await ctx.addTripMember(tripId, "planner", "Organizer");
    const outsider = ctx.getUser("outsider");
    expect(await roleOf(tripId, outsider.id)).toBeNull(); // premise
    const result = await ctx.caller().tripMembers.inviteByEmail({ tripId, email: outsider.email });
    expect(result.status).toBe("added_existing");
    expect(await roleOf(tripId, outsider.id)).not.toBeNull();
  });

  // #786/#824 — was "planner cannot invite (Owner only)". #823 proved that was
  // never a guard problem: widening the guard let an Organizer through and the
  // DATABASE refused the trip_members insert. Migration 122 widened that
  // policy, so the guard could finally move. What an Organizer still cannot do
  // is invite someone AS AN ORGANIZER — pinned immediately below, since that is
  // the boundary, not the invite itself.
  it("inviteByEmail — planner CAN invite a Member", async () => {
    const tripId = await crewTrip("invite-organizer");
    await expect(
      ctx.callerAs("planner").tripMembers.inviteByEmail({ tripId, email: `planner-invite-${Date.now()}@example.com`, role: "Member" })
    ).resolves.toBeTruthy();
  });

  it("inviteByEmail — planner CANNOT invite an Organizer", async () => {
    const tripId = await crewTrip("invite-organizer-grant");
    await expect(
      ctx.callerAs("planner").tripMembers.inviteByEmail({ tripId, email: `planner-invite-org-${Date.now()}@example.com`, role: "Organizer" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("inviteByEmail — role defaults to Member, not Organizer", async () => {
    // The default flipped in #823 and is KEPT. It is dead from the UI
    // (CrewSearchInput always passes `role`), so it only governs a direct API
    // call — where "Organizer" was a surprising and unsafe value to assume.
    // Asserted through the created row rather than the schema so a silent flip
    // back is caught.
    const tripId = await crewTrip("invite-default");
    const email = `default-role-${Date.now()}@example.test`;
    await ctx.caller().tripMembers.inviteByEmail({ tripId, email });
    const { data, error } = await ctx.admin.from("invites").select("role").eq("trip_id", tripId).eq("email", email).single();
    if (error) throw new Error(`read invite: ${error.message}`);
    expect(data?.role).toBe("Member");
  });

  it("inviteByEmail — member cannot invite", async () => {
    const tripId = await crewTrip("invite-member");
    await expect(
      ctx.callerAs("member").tripMembers.inviteByEmail({ tripId, email: `another-${Date.now()}@example.com` })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // updateNickname — trip-scoped display-name override (Task 47).
  //
  // The earlier MemberEditor only fired ghostCrew.update when the row was a
  // guest, so renames for real-account members silently dropped. This
  // mutation lives on trip_members so it works for everyone. The Owner row is
  // locked so an Owner can't rename themselves through the trip context (they
  // use account settings).
  it("updateNickname — owner can rename a member", async () => {
    const tripId = await crewTrip("nick-owner");
    const member = ctx.getUser("member");
    const caller = ctx.caller();
    const result = await caller.tripMembers.updateNickname({ tripId, userId: member.id, nickname: "Buddy" });
    expect(result.success).toBe(true);
    expect(result.nickname).toBe("Buddy");

    // listMembers surfaces the override as displayName so the rail and edit
    // drawer pick it up without extra plumbing.
    const row = (await caller.tripMembers.list({ tripId })).find((m) => m.user_id === member.id);
    expect(row?.nickname).toBe("Buddy");
    expect(row?.displayName).toBe("Buddy");
  });

  it("updateNickname — empty string clears the override", async () => {
    const tripId = await crewTrip("nick-clear");
    const member = ctx.getUser("member");
    await ctx.caller().tripMembers.updateNickname({ tripId, userId: member.id, nickname: "Buddy" });
    expect(await nicknameOf(tripId, member.id)).toBe("Buddy"); // premise: there IS an override to clear
    const result = await ctx.caller().tripMembers.updateNickname({ tripId, userId: member.id, nickname: "   " });
    // Whitespace-only collapses to null so display falls back to users.name.
    expect(result.nickname).toBeNull();
    expect(await nicknameOf(tripId, member.id)).toBeNull();
  });

  it("updateNickname — Owner row is locked", async () => {
    // The Owner-row guard is checked even for Owner callers, so this
    // verifies the guard rather than the role middleware.
    const tripId = await crewTrip("nick-owner-row");
    await expect(
      ctx.caller().tripMembers.updateNickname({ tripId, userId: ctx.user.id, nickname: "Boss" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await nicknameOf(tripId, ctx.user.id)).toBeNull();
  });

  // #786/#824 — was "planner cannot rename (Owner only)". A nickname touches no
  // role column, so it moved to Organizer. The plain-member case below is the
  // one that still holds and is what actually guards this.
  it("updateNickname — planner CAN rename a member", async () => {
    const tripId = await crewTrip("nick-organizer");
    const member = ctx.getUser("member");
    await expect(
      ctx.callerAs("planner").tripMembers.updateNickname({ tripId, userId: member.id, nickname: "Renamed By Planner" })
    ).resolves.toMatchObject({ success: true });
    expect(await nicknameOf(tripId, member.id)).toBe("Renamed By Planner");
  });

  it("updateNickname — plain member cannot rename others", async () => {
    // The name says OTHERS; it used to aim the member at their OWN row, which is
    // not the case it claims. Aimed at the Organizer's row now.
    const tripId = await crewTrip("nick-member");
    const planner = ctx.getUser("planner");
    await expect(
      ctx.callerAs("member").tripMembers.updateNickname({ tripId, userId: planner.id, nickname: "Mine" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await nicknameOf(tripId, planner.id)).toBeNull();
  });

  it("remove — owner cannot remove self", async () => {
    const tripId = await crewTrip("remove-self");
    await expect(ctx.caller().tripMembers.remove({ tripId, userId: ctx.user.id })).rejects.toThrow("You can't remove yourself from a trip. Use Leave trip on the Crew tab instead.");
    expect(await roleOf(tripId, ctx.user.id)).toBe("Owner");
  });

  // ── leave (PR 8d, ruling 3) — the same archive as removal, as the caller ──
  it("leave — a Member leaves, and their membership row is gone", async () => {
    const tripId = await crewTrip("leave-member");
    const member = ctx.getUser("member");
    expect(await roleOf(tripId, member.id)).toBe("Member"); // premise
    const result = await ctx.callerAs("member").tripMembers.leave({ tripId });
    expect(result.success).toBe(true);
    expect(await roleOf(tripId, member.id)).toBeNull();
  });

  it("leave — an Organizer can leave (removing one is Owner-only; leaving is not)", async () => {
    const tripId = await crewTrip("leave-organizer");
    const planner = ctx.getUser("planner");
    expect(await roleOf(tripId, planner.id)).toBe("Organizer"); // premise
    await ctx.callerAs("planner").tripMembers.leave({ tripId });
    expect(await roleOf(tripId, planner.id)).toBeNull();
  });

  it("leave — the Owner is refused, told to transfer ownership first, and stays", async () => {
    const tripId = await crewTrip("leave-owner");
    await expect(ctx.caller().tripMembers.leave({ tripId })).rejects.toThrow(/[Tt]ransfer ownership/);
    expect(await roleOf(tripId, ctx.user.id)).toBe("Owner");
  });

  // ── departureSummary.ownerRefusal (PR 8d-3) — the Leave button says why
  // BEFORE the press, and must say exactly what the press would. ────────────
  it("departureSummary — the Owner asking about leaving gets the SAME sentence the leave refuses with", async () => {
    const tripId = await crewTrip("summary-owner");
    const summary = await ctx.caller().tripMembers.departureSummary({ tripId, userId: ctx.user.id });
    const refused = await ctx.caller().tripMembers.leave({ tripId }).then(
      () => null,
      (e: Error) => e.message
    );
    expect(refused).not.toBeNull(); // premise: the leave really is refused
    expect(summary.ownerRefusal).toBe(refused);
  });

  it("departureSummary — nobody else is told they can't leave", async () => {
    const tripId = await crewTrip("summary-others");
    const member = ctx.getUser("member");
    const planner = ctx.getUser("planner");
    // A Member and an Organizer about themselves: they CAN leave.
    expect((await ctx.callerAs("member").tripMembers.departureSummary({ tripId, userId: member.id })).ownerRefusal).toBeNull();
    expect((await ctx.callerAs("planner").tripMembers.departureSummary({ tripId, userId: planner.id })).ownerRefusal).toBeNull();
    // The Owner asking about SOMEONE ELSE is not asking about leaving.
    expect((await ctx.caller().tripMembers.departureSummary({ tripId, userId: member.id })).ownerRefusal).toBeNull();
    // Someone else asking about the Owner is not the Owner leaving either.
    expect((await ctx.callerAs("planner").tripMembers.departureSummary({ tripId, userId: ctx.user.id })).ownerRefusal).toBeNull();
  });

  it("remove — owner can remove a member, and the row is gone", async () => {
    const tripId = await crewTrip("remove");
    const member = ctx.getUser("member");
    expect(await roleOf(tripId, member.id)).toBe("Member"); // premise
    const result = await ctx.caller().tripMembers.remove({ tripId, userId: member.id });
    expect(result.success).toBe(true);
    expect(await roleOf(tripId, member.id)).toBeNull();
  });
});

// ── Travel tests ─────────────────────────────────────────────────────────

describe("tripMembers router — travel", () => {
  let tctx: TestContext;

  beforeAll(async () => {
    tctx = await TestContext.create();
  });

  afterAll(async () => {
    await tctx.cleanup();
  });

  /** A crew trip with a locked destination, so travel fields are in play. */
  async function travelTrip(label: string): Promise<string> {
    const tripId = await tctx.createTrip(`Travel ${label}`);
    await tctx.addTripMember(tripId, "planner", "Organizer");
    await tctx.addTripMember(tripId, "member", "Member");
    const { error } = await tctx.admin.from("trips").update({
      locked_destination_title: "Test Dest",
      locked_destination_location: "Test, TX",
      locked_destination_at: new Date().toISOString(),
      about_message: "Let's go!",
    }).eq("id", tripId);
    if (error) throw new Error(`lock destination: ${error.message}`);
    return tripId;
  }

  it("updateTravel — member can update own travel (flying)", async () => {
    const tripId = await travelTrip("flying");
    const result = await tctx.callerAs("member").tripMembers.updateTravel({
      tripId,
      travelMode: "flying",
      flightAirline: "Delta",
      flightNumber: "DL1733",
      flightArrivalTime: "2026-10-05T19:33:00Z",
      flightAirport: "JAX",
      travelShared: true,
    });
    expect(result.travel_mode).toBe("flying");
    expect(result.flight_airline).toBe("Delta");
    expect(result.flight_number).toBe("DL1733");
    expect(result.travel_shared).toBe(true);
  });

  it("updateTravel — member can update own travel (driving)", async () => {
    const tripId = await travelTrip("driving");
    const result = await tctx.callerAs("member").tripMembers.updateTravel({
      tripId,
      travelMode: "driving",
      travelDetail: "Renting a car from Enterprise",
      travelShared: false,
    });
    expect(result.travel_mode).toBe("driving");
    expect(result.travel_detail).toBe("Renting a car from Enterprise");
    expect(result.travel_shared).toBe(false);
  });

  it("updateTravel — member can clear travel mode", async () => {
    const tripId = await travelTrip("clear");
    const member = tctx.callerAs("member");
    await member.tripMembers.updateTravel({ tripId, travelMode: "driving", travelShared: false });
    const result = await member.tripMembers.updateTravel({ tripId, travelMode: null, travelShared: false });
    expect(result.travel_mode).toBeNull();
  });

  it("updateTravel — member can enter a departure leg (date/time/mode/details)", async () => {
    const tripId = await travelTrip("departure");
    const result = await tctx.callerAs("member").tripMembers.updateTravel({
      tripId,
      travelMode: "flying",
      travelDetail: "Landing Thu",
      flightArrivalTime: "2026-09-09T15:30:00Z",
      departureMode: "driving",
      departureDetail: "Heading out Sunday — carpool with Sam",
      departureTime: "2026-09-13T11:00:00Z",
      travelShared: true,
    });
    expect(result.travel_mode).toBe("flying");
    expect(result.departure_mode).toBe("driving");
    expect(result.departure_detail).toBe("Heading out Sunday — carpool with Sam");
    // timestamptz round-trips as an ISO string carrying the stored instant.
    expect(result.departure_time).toContain("2026-09-13");
  });

  it("updateTravel — departure leg is independent of the arrival leg", async () => {
    const tripId = await travelTrip("independent");
    const member = tctx.callerAs("member");
    // Sets BOTH legs first — this used to rely on the case above having done it.
    await member.tripMembers.updateTravel({
      tripId,
      travelMode: "flying",
      departureMode: "driving",
      departureDetail: "Heading out Sunday",
      travelShared: true,
    });
    // Clear arrival but omit the departure fields — they must not be wiped by an
    // arrival-only update.
    const result = await member.tripMembers.updateTravel({ tripId, travelMode: null, travelShared: false });
    expect(result.travel_mode).toBeNull();
    expect(result.departure_mode).toBe("driving");
  });

  it("updateMemberTravel — owner can enter a departure leg for a member", async () => {
    const tripId = await travelTrip("owner-for-member");
    const caller = tctx.caller();
    const member = tctx.getUser("member");
    const result = await caller.tripMembers.updateMemberTravel({
      tripId,
      targetUserId: member.id,
      travelMode: "flying",
      departureMode: "flying",
      departureDetail: "Red-eye home",
      departureTime: "2026-09-13T22:15:00Z",
    });
    expect(result.success).toBe(true);

    const row = (await caller.tripMembers.list({ tripId })).find((m) => m.user_id === member.id);
    expect(row?.departure_mode).toBe("flying");
    expect(row?.departure_detail).toBe("Red-eye home");
  });
});

// ── sendInvitationBlast tests ────────────────────────────────────────────────

describe("tripMembers router — sendInvitationBlast", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await TestContext.create();
  }, 30_000);

  async function blastTrip(label: string): Promise<string> {
    const tripId = await ctx.createTrip(`Blast ${label}`);
    await ctx.addTripMember(tripId, "planner", "Organizer");
    await ctx.addTripMember(tripId, "member", "Member");
    return tripId;
  }

  /** A crew-tab placeholder on the trip, with an email to send to. */
  async function placeholder(tripId: string, label: string, name: string) {
    const ghostId = `ghost-${genId(label)}`;
    const ghostEmail = `${genId(label)}@example.com`.toLowerCase();
    const { error } = await ctx.admin.from("users").insert({
      id: ghostId, name, email: ghostEmail, is_guest: true,
    });
    if (error) throw new Error(`seed placeholder: ${error.message}`);
    await ctx.addTripMemberById(tripId, ghostId, "Member");
    return { ghostId, ghostEmail };
  }

  async function sendTracking(tripId: string, userId: string) {
    const { data, error } = await ctx.admin
      .from("trip_members")
      .select("last_emailed_at, email_count")
      .eq("trip_id", tripId)
      .eq("user_id", userId)
      .single();
    if (error) throw new Error(`read send tracking: ${error.message}`);
    return data as { last_emailed_at: string | null; email_count: number | null };
  }

  afterAll(async () => {
    await ctx.cleanup();
  }, 30_000);

  it("sendInvitationBlast — owner can blast to members with email", async () => {
    const tripId = await blastTrip("owner can blast to");
    vi.mocked(sendInvitationBlast).mockClear();
    const caller = ctx.caller();
    const planner = ctx.getUser("planner");
    const member = ctx.getUser("member");

    const result = await caller.tripMembers.sendInvitationBlast({
      tripId,
      memberUserIds: [planner.id, member.id],
    });

    // Both recipients are real accounts with an email, so both are sent.
    expect(result.sent).toBe(2);
    expect(vi.mocked(sendInvitationBlast)).toHaveBeenCalledTimes(2);
  });

  it("sendInvitationBlast — sends the explicit message body verbatim", async () => {
    const tripId = await blastTrip("sends the explicit");
    vi.mocked(sendInvitationBlast).mockClear();
    const caller = ctx.caller();
    const member = ctx.getUser("member");
    const body = "Hey! I'm starting to plan a trip and could use your help.";

    await caller.tripMembers.sendInvitationBlast({
      tripId,
      memberUserIds: [member.id],
      message: body,
    });

    expect(vi.mocked(sendInvitationBlast)).toHaveBeenCalledWith(
      expect.objectContaining({ invitationMessage: body })
    );
  });

  it("sendInvitationBlast — stamps last_emailed_at and bumps email_count", async () => {
    const tripId = await blastTrip("stamps last_emaile");
    const caller = ctx.caller();
    const member = ctx.getUser("member");

    // Premise: a fresh membership has never been emailed. (This used to read
    // the starting count and swallow a failed read as 0.)
    const before = await sendTracking(tripId, member.id);
    expect(before.last_emailed_at).toBeNull();
    const startCount = before.email_count ?? 0;

    await caller.tripMembers.sendInvitationBlast({
      tripId,
      memberUserIds: [member.id],
    });

    const after = await sendTracking(tripId, member.id);
    expect(after.last_emailed_at).toBeTruthy();
    expect(after.email_count).toBe(startCount + 1);
  });

  // ── Per-recipient link selection + idempotent minting ────────────────────
  //
  // The two-disjoint-systems bug: `ghostCrew.create` (crew tab) makes a
  // placeholder and mints nothing; the blast then emailed everyone the raw
  // `/trips/{uuid}`. So #988's invite router was live but unreachable from the
  // path actually used to invite people.
  it("mints a token for a placeholder, and NOT for a real account, in one send", async () => {
    const tripId = await blastTrip("mints a token for a placeholder, and NOT");
    vi.mocked(sendInvitationBlast).mockClear();
    const admin = ctx.admin;
    const caller = ctx.caller();
    const member = ctx.getUser("member");

    // A crew-tab placeholder: `ghost-` prefixed id (ghostCrew.create's shape,
    // deliberately distinct from inviteByEmail's bare UUID — that incidental
    // difference is what made this bug findable, so it is preserved on purpose).
    const { ghostId, ghostEmail } = await placeholder(tripId, "blastlink", "Placeholder Pal");

    const result = await caller.tripMembers.sendInvitationBlast({
      tripId,
      memberUserIds: [ghostId, member.id],
    });
    expect(result.sent).toBe(2);

    const calls = vi.mocked(sendInvitationBlast).mock.calls.map((c) => c[0]);
    const toGhost = calls.find((c) => c.toEmail === ghostEmail);
    const toReal = calls.find((c) => c.toEmail !== ghostEmail);

    // The whole point: ONE send, TWO link types, split on is_guest.
    expect(toGhost?.token).toBeTruthy();
    expect(toReal?.token).toBeFalsy();

    // And the token is a real row, not a fabricated string.
    const { data: row } = await admin
      .from("invites").select("token, role, email")
      .eq("trip_id", tripId).eq("email", ghostEmail).maybeSingle();
    expect(row?.token).toBe(toGhost?.token);
    // Default role, not copied from trip_members: nothing reads invites.role
    // (#980 / migration 128), and copying an Organizer role would be refused
    // by invites_insert for a non-Owner sender.
    expect(row?.role).toBe("Member");

    await admin.from("users").delete().eq("id", ghostId);
  }, 30_000);

  it("re-sending REUSES the token — no second row per blast", async () => {
    const tripId = await blastTrip("re-sending REUSES the token — no second ");
    vi.mocked(sendInvitationBlast).mockClear();
    const admin = ctx.admin;
    const caller = ctx.caller();

    const { ghostId, ghostEmail } = await placeholder(tripId, "resend", "Resend Pal");

    await caller.tripMembers.sendInvitationBlast({ tripId, memberUserIds: [ghostId] });
    await caller.tripMembers.sendInvitationBlast({ tripId, memberUserIds: [ghostId] });
    await caller.tripMembers.sendInvitationBlast({ tripId, memberUserIds: [ghostId] });

    const tokens = vi
      .mocked(sendInvitationBlast)
      .mock.calls.map((c) => c[0].token);
    expect(tokens).toHaveLength(3);
    // Same token every time — a person keeps ONE link however often they are
    // chased. Three distinct tokens would mean every "Resend invites" click
    // silently accumulated another live credential.
    expect(new Set(tokens).size).toBe(1);
    expect(tokens[0]).toBeTruthy();

    const { data: rows } = await admin
      .from("invites").select("id").eq("trip_id", tripId).eq("email", ghostEmail);
    expect(rows).toHaveLength(1);

    await admin.from("users").delete().eq("id", ghostId);
  }, 30_000);

  it("sendInvitationBlast — member cannot blast", async () => {
    const tripId = await blastTrip("member cannot blas");
    const caller = ctx.callerAs("member");
    await expect(
      caller.tripMembers.sendInvitationBlast({
        tripId,
        memberUserIds: [ctx.getUser("planner").id],
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // #786/#824 — was "planner cannot blast (owner-only)". It moved WHOLESALE,
  // with no input split, because it takes no role: it sends email and stamps
  // send-tracking, granting nothing. It was Owner-only only as inviteByEmail's
  // sibling, and blocked by the same widened policy (#823's CI failure was the
  // `last_emailed_at` UPDATE matching zero rows for an Organizer).
  it("sendInvitationBlast — planner CAN blast", async () => {
    const tripId = await blastTrip("planner CAN blast");
    const caller = ctx.callerAs("planner");
    await expect(
      caller.tripMembers.sendInvitationBlast({
        tripId,
        memberUserIds: [ctx.getUser("member").id],
      })
    ).resolves.toBeTruthy();
  });

  it("sendInvitationBlast — a plain member still cannot blast", async () => {
    const tripId = await blastTrip("a plain member sti");
    const caller = ctx.callerAs("member");
    await expect(
      caller.tripMembers.sendInvitationBlast({
        tripId,
        memberUserIds: [ctx.getUser("member").id],
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
