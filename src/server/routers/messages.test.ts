import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";

let ctx: TestContext;
let tripId: string;

describe("messages router", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
    tripId = await ctx.createTrip("Messages Test");
    await ctx.addTripMember(tripId, "planner", "Organizer");
    await ctx.addTripMember(tripId, "member", "Member");
  });

  afterAll(async () => {
    await ctx.cleanup();
  }, 30000); // cleanup does many sequential remote deletes per trip; this suite
  // creates a dozen-plus trips, so the default 10s hook timeout is too tight.

  it("send — member can send a trip message", async () => {
    const caller = ctx.callerAs("member");
    const msg = await caller.messages.send({
      tripId,
      id: genId("msg"),
      text: "Hello everyone!",
    });
    expect(msg.text).toBe("Hello everyone!");
    expect(msg.channel).toBe("trip");
    expect(msg.visibility).toBe("crew");
  });

  /**
   * RETRY SAFETY. The client mints `id` and this is a plain INSERT into a table
   * whose primary key is that column, so a retry reusing the id cannot duplicate
   * the message — the key refuses it.
   *
   * What the router must do is REPORT that refusal as `CONFLICT` rather than as
   * a generic 500. The failed-message retry in `FloatingChatPanel` branches on
   * that code to tell "the send failed" from "it already landed", and without it
   * the one case where the message is safely stored reports failure forever.
   *
   * Asserted on the CODE, not the message text: matching Postgres's wording
   * would make the contract a coincidence of phrasing.
   */
  it("send — re-sending the same id is refused as CONFLICT, and does not duplicate", async () => {
    const caller = ctx.callerAs("member");
    const id = genId("msg");
    const text = "Retried exactly once";

    await caller.messages.send({ tripId, id, text });

    await expect(caller.messages.send({ tripId, id, text })).rejects.toMatchObject({
      code: "CONFLICT",
    });

    // The point of the whole exercise: exactly one copy reached the channel.
    const msgs = await caller.messages.list({ tripId });
    expect(msgs.filter((m) => m.id === id)).toHaveLength(1);
    expect(msgs.filter((m) => m.text === text)).toHaveLength(1);
  });

  it("list — member can view trip messages", async () => {
    const caller = ctx.callerAs("member");
    const msgs = await caller.messages.list({ tripId });
    expect(msgs.length).toBeGreaterThanOrEqual(1);
    expect(msgs.some((m) => m.text === "Hello everyone!")).toBe(true);
  });

  it("send — team channel requires teamId", async () => {
    const caller = ctx.callerAs("member");
    await expect(
      caller.messages.send({
        tripId,
        id: genId("msg"),
        channel: "team",
        text: "Team message",
      })
    ).rejects.toThrow("teamId is required");
  });

  // ── Crew / Organizers visibility split ─────────────────────────────────

  it("send — owner can post to the Organizers (planning) channel", async () => {
    const caller = ctx.caller();
    const msg = await caller.messages.send({
      tripId,
      id: genId("msg"),
      visibility: "planning",
      text: "Organizers only",
    });
    expect(msg.visibility).toBe("planning");
  });

  it("send — planner can post to the Organizers channel", async () => {
    const caller = ctx.callerAs("planner");
    const msg = await caller.messages.send({
      tripId,
      id: genId("msg"),
      visibility: "planning",
      text: "Organizer planning note",
    });
    expect(msg.visibility).toBe("planning");
  });

  it("send — member cannot post to the Organizers channel", async () => {
    const caller = ctx.callerAs("member");
    await expect(
      caller.messages.send({
        tripId,
        id: genId("msg"),
        visibility: "planning",
        text: "I should not be able to do this",
      })
    ).rejects.toThrow(/owner\/organizer only/i);
  });

  it("list — owner sees planning messages on the planning channel", async () => {
    const caller = ctx.caller();
    const msgs = await caller.messages.list({ tripId, visibility: "planning" });
    expect(msgs.some((m) => m.text === "Organizers only")).toBe(true);
  });

  it("list — crew channel excludes planning messages", async () => {
    const caller = ctx.caller();
    const msgs = await caller.messages.list({ tripId, visibility: "crew" });
    expect(msgs.every((m) => m.visibility === "crew")).toBe(true);
    expect(msgs.some((m) => m.text === "Organizers only")).toBe(false);
  });

  it("list — member cannot read the Organizers channel", async () => {
    const caller = ctx.callerAs("member");
    await expect(
      caller.messages.list({ tripId, visibility: "planning" })
    ).rejects.toThrow(/owner\/organizer only/i);
  });

  // ── Read state — server-backed, cross-device ───────────────────────────

  it("readState — defaults to null on both channels before anything is read", async () => {
    const trip = await ctx.createTrip("Read State Defaults");
    const msgs = await ctx.caller().messages.readState({ tripId: trip });
    expect(msgs.crew).toBeNull();
    expect(msgs.planning).toBeNull();
  });

  it("markRead — records the caller's crew read timestamp", async () => {
    const trip = await ctx.createTrip("Mark Read Crew");
    const owner = ctx.caller();
    const res = await owner.messages.markRead({ tripId: trip, visibility: "crew" });
    expect(typeof res.last_read_at).toBe("string");

    const state = await owner.messages.readState({ tripId: trip });
    expect(state.crew).toBe(res.last_read_at);
    expect(state.planning).toBeNull();
  });

  it("markRead — is idempotent and advances the timestamp on re-read", async () => {
    const trip = await ctx.createTrip("Mark Read Advance");
    const owner = ctx.caller();
    const first = await owner.messages.markRead({ tripId: trip, visibility: "crew" });
    await new Promise((r) => setTimeout(r, 10));
    const second = await owner.messages.markRead({ tripId: trip, visibility: "crew" });
    expect(new Date(second.last_read_at).getTime()).toBeGreaterThanOrEqual(
      new Date(first.last_read_at).getTime()
    );

    const state = await owner.messages.readState({ tripId: trip });
    expect(state.crew).toBe(second.last_read_at);
  });

  it("markRead — member cannot mark the Organizers channel read", async () => {
    const trip = await ctx.createTrip("Mark Read Guard");
    await ctx.addTripMember(trip, "member", "Member");
    await expect(
      ctx.callerAs("member").messages.markRead({ tripId: trip, visibility: "planning" })
    ).rejects.toThrow(/owner\/organizer only/i);
  });

  /**
   * `markViewing` carries the SAME role gate as `markRead`, and it has to be
   * asserted separately rather than assumed from the shape of the code: a
   * non-organizer who could write a viewing mark for the Organizers channel
   * would be writing state for a room they cannot see — and the effect is
   * silent, since nothing renders `viewing_at`. The only symptom would be
   * organizers quietly missing pushes.
   */
  it("markViewing — member cannot mark the Organizers channel viewed", async () => {
    const trip = await ctx.createTrip("Mark Viewing Guard");
    await ctx.addTripMember(trip, "member", "Member");
    await expect(
      ctx.callerAs("member").messages.markViewing({ tripId: trip, visibility: "planning" })
    ).rejects.toThrow(/owner\/organizer only/i);
  });

  it("markViewing — a non-member cannot mark anything viewed", async () => {
    const trip = await ctx.createTrip("Mark Viewing Member Guard");
    await expect(
      ctx.callerAs("outsider").messages.markViewing({ tripId: trip, visibility: "crew" })
    ).rejects.toThrow();
  });

  it("readState — read marks are per-user, not shared", async () => {
    const trip = await ctx.createTrip("Read State Per User");
    await ctx.addTripMember(trip, "member", "Member");

    await ctx.caller().messages.markRead({ tripId: trip, visibility: "crew" });

    // The member never marked anything read — their state stays null even
    // though the owner just did.
    const memberState = await ctx.callerAs("member").messages.readState({ tripId: trip });
    expect(memberState.crew).toBeNull();

    const ownerState = await ctx.caller().messages.readState({ tripId: trip });
    expect(ownerState.crew).not.toBeNull();
  });

  // ── Per-member visibility floor ────────────────────────────────────────

  it("list — chat_visible_from floor hides crew history from before a member joined", async () => {
    const floorTrip = await ctx.createTrip("Floor Test");
    const owner = ctx.caller();

    // Message posted before the member is given access.
    const banter = await owner.messages.send({
      tripId: floorTrip,
      id: genId("msg"),
      text: "Banter before you joined",
    });

    // Add member with a floor 1ms past the banter's own server timestamp.
    // Deriving the floor from created_at (server clock) rather than the
    // local clock avoids a false pass/fail when the test machine's clock
    // is skewed relative to Postgres now().
    const floor = new Date(
      new Date(banter.created_at as string).getTime() + 1
    ).toISOString();
    await ctx.admin.from("trip_members").insert({
      trip_id: floorTrip,
      user_id: ctx.getUser("member").id,
      role: "Member",
      status: "in",
      chat_visible_from: floor,
    });

    // Message posted after the member joined.
    await owner.messages.send({
      tripId: floorTrip,
      id: genId("msg"),
      text: "Welcome aboard",
    });

    const memberView = await ctx.callerAs("member").messages.list({
      tripId: floorTrip,
    });
    expect(memberView.some((m) => m.text === "Welcome aboard")).toBe(true);
    expect(memberView.some((m) => m.text === "Banter before you joined")).toBe(
      false
    );
  });

  // ── #982 — what a new member actually lands in ─────────────────────────
  //
  // The spec these were first written against said new members should get full
  // crew history, and that decision was REVERSED before it shipped. Migration
  // 008's original rationale — "so they do not see prior banter" — is the
  // better one, and not only because of existing members' informality: a new
  // person scrolling back through sixteen people's unfiltered conversation may
  // find discussion ABOUT THEMSELVES, and that cannot be undone. A momentarily
  // confusing empty room is much the smaller problem. The floor stays; what
  // changed is the join message that makes the empty room read as a beginning.
  //
  // The assertions below pin the state the reversal restored, so nobody has to
  // re-derive it from the fact that `list()` simply doesn't mention crew.

  it("a new member does NOT see crew history from before they joined, and unread is zero", async () => {
    const trip = await ctx.createTrip("New Member Floor");
    const owner = ctx.caller();

    const prior = await owner.messages.send({
      tripId: trip,
      id: genId("msg"),
      text: "Deciding on dates back in June",
    });

    // Mirrors the real add path (tripMembers.ts / ghostCrew.ts): every
    // membership insert stamps chat_visible_from at join time.
    const joinFloor = new Date(
      new Date(prior.created_at as string).getTime() + 1
    ).toISOString();
    await ctx.admin.from("trip_members").insert({
      trip_id: trip,
      user_id: ctx.getUser("member").id,
      role: "Member",
      status: "in",
      chat_visible_from: joinFloor,
    });

    const memberView = await ctx.callerAs("member").messages.list({ tripId: trip });
    expect(memberView.some((m) => m.text === "Deciding on dates back in June")).toBe(false);

    // Zero with no `chat_reads` row anywhere — the floor is what delivers this,
    // which is why nothing is seeded at join.
    expect(await ctx.callerAs("member").messages.unreadCount({ tripId: trip })).toBe(0);
  });

  it("a trip with no prior messages: empty room, no badge, for a new member", async () => {
    const trip = await ctx.createTrip("Truly Empty Room");
    await ctx.admin.from("trip_members").insert({
      trip_id: trip,
      user_id: ctx.getUser("member").id,
      role: "Member",
      status: "in",
      chat_visible_from: new Date().toISOString(),
    });

    expect(await ctx.callerAs("member").messages.list({ tripId: trip })).toEqual([]);
    expect(await ctx.callerAs("member").messages.unreadCount({ tripId: trip })).toBe(0);
  });

  it("existing member: unread behaves exactly as before (#982 regression guard)", async () => {
    // The regression risk named in the spec: nothing done for new members may
    // change what an already-caught-up member sees.
    const trip = await ctx.createTrip("Existing Member Unaffected");
    await ctx.addTripMember(trip, "member", "Member");
    const owner = ctx.caller();
    const member = ctx.callerAs("member");

    await member.messages.markRead({ tripId: trip, visibility: "crew" });
    expect(await member.messages.unreadCount({ tripId: trip })).toBe(0);

    await owner.messages.send({ tripId: trip, id: genId("msg"), text: "one" });
    await owner.messages.send({ tripId: trip, id: genId("msg"), text: "two" });

    expect(await member.messages.unreadCount({ tripId: trip })).toBe(2);
  });

  // ── #982 — the join line: ONE row, two readings ────────────────────────

  it("tripMembers.add writes exactly ONE join row, carrying the joiner as its subject", async () => {
    // The whole point of putting the joiner on `user_id` is that the two
    // wordings come from one row. If this ever becomes two rows, everyone
    // reads a greeting addressed to someone else and the transcript doubles.
    const trip = await ctx.createTrip("One Join Row");
    const outsider = ctx.getUser("outsider");
    await ctx.caller().tripMembers.add({ tripId: trip, userId: outsider.id });

    const { data: rows } = await ctx.admin
      .from("messages")
      .select("id, text, user_id, message_type")
      .eq("trip_id", trip)
      .eq("message_type", "system");

    expect(rows).toHaveLength(1);
    expect(rows![0].user_id).toBe(outsider.id);
    // Stored form is third person; the welcome variant is derived at render
    // (src/lib/joinMessage.ts), never stored.
    expect(rows![0].text).toContain("has now joined the chat");
    expect(rows![0].text).not.toContain("Hey ");
  });

  it("the join row badges nobody — not the joiner, not anyone else", async () => {
    const trip = await ctx.createTrip("Join Row No Badge");
    await ctx.addTripMember(trip, "planner", "Organizer");
    await ctx.caller().tripMembers.add({ tripId: trip, userId: ctx.getUser("member").id });

    // The joiner: their own line, and a floor stamped at join.
    expect(await ctx.callerAs("member").messages.unreadCount({ tripId: trip })).toBe(0);
    // Everyone else: system rows are excluded from the count outright, so a
    // membership change never lights up a badge for the people already there.
    expect(await ctx.callerAs("planner").messages.unreadCount({ tripId: trip })).toBe(0);

    // ...but it IS in the transcript for both of them — one row, two readings.
    const joinerView = await ctx.callerAs("member").messages.list({ tripId: trip });
    const othersView = await ctx.callerAs("planner").messages.list({ tripId: trip });
    expect(joinerView.filter((m) => m.message_type === "system")).toHaveLength(1);
    expect(othersView.filter((m) => m.message_type === "system")).toHaveLength(1);
  });

  // ── unreadCount — server-side count replacing the client page-scan (F3) ──

  it("unreadCount — zero right after the caller marks crew read", async () => {
    const trip = await ctx.createTrip("Unread Zero");
    const owner = ctx.caller();
    await owner.messages.send({ tripId: trip, id: genId("msg"), text: "hello" });
    await owner.messages.markRead({ tripId: trip, visibility: "crew" });
    const count = await owner.messages.unreadCount({ tripId: trip });
    expect(count).toBe(0);
  });

  it("unreadCount — a newer crew message from someone else bumps the count", async () => {
    const trip = await ctx.createTrip("Unread Some");
    await ctx.addTripMember(trip, "member", "Member");
    const owner = ctx.caller();
    const member = ctx.callerAs("member");

    await owner.messages.markRead({ tripId: trip, visibility: "crew" });
    expect(await owner.messages.unreadCount({ tripId: trip })).toBe(0);

    await member.messages.send({ tripId: trip, id: genId("msg"), text: "new one" });
    await member.messages.send({ tripId: trip, id: genId("msg"), text: "and another" });

    expect(await owner.messages.unreadCount({ tripId: trip })).toBe(2);
  });

  it("unreadCount — never read (null read mark) counts every visible message", async () => {
    const trip = await ctx.createTrip("Unread Never Read");
    await ctx.addTripMember(trip, "member", "Member");
    await ctx.callerAs("member").messages.send({ tripId: trip, id: genId("msg"), text: "a" });
    await ctx.callerAs("member").messages.send({ tripId: trip, id: genId("msg"), text: "b" });

    const count = await ctx.caller().messages.unreadCount({ tripId: trip });
    expect(count).toBe(2);
  });

  it("unreadCount — excludes the caller's own messages", async () => {
    const trip = await ctx.createTrip("Unread Own Excluded");
    const owner = ctx.caller();
    await owner.messages.send({ tripId: trip, id: genId("msg"), text: "I said this" });
    const count = await owner.messages.unreadCount({ tripId: trip });
    expect(count).toBe(0);
  });

  it("unreadCount — a plain member's badge does NOT count planning messages", async () => {
    // The badge must agree with what the tab can actually SHOW. If a member's
    // count included the organizers' channel they'd tap in and find nothing — a
    // number pointing at content that doesn't exist for them.
    //
    // WHERE THE GUARANTEE ACTUALLY LIVES — established by mutation, not by
    // reading the code. `unreadCount` derives `canSeeOrganizers` from
    // ctx.tripRole and only issues the planning COUNT when true. Removing that
    // gate does NOT change this test's result: the member's count stays 0
    // because RLS already denies them the planning rows, so the COUNT returns 0
    // whether or not it runs.
    //
    // So RLS is the security boundary and the app-level gate is an OPTIMISATION
    // (skip a query that can only return 0). Both are worth keeping, but do not
    // read this test as proving the app gate — it can't distinguish, and no
    // test at this layer can. The assertion below deliberately checks the
    // message EXISTS in the database first, so the member's 0 means "filtered"
    // rather than "nothing was posted".
    const trip = await ctx.createTrip("Unread Planning Hidden");
    await ctx.addTripMember(trip, "member", "Member");
    const owner = ctx.caller();
    const member = ctx.callerAs("member");

    await member.messages.markRead({ tripId: trip, visibility: "crew" });
    expect(await member.messages.unreadCount({ tripId: trip })).toBe(0);

    // Owner posts to the organizers-only channel.
    const planningId = genId("msg");
    await owner.messages.send({
      tripId: trip,
      id: planningId,
      text: "Organizers only — budget",
      visibility: "planning",
    });

    // The row really is in the database (admin bypasses RLS) — so the member's
    // zero below is the filter working, not an empty table.
    const { data: row } = await ctx.admin
      .from("messages")
      .select("id, visibility")
      .eq("id", planningId)
      .maybeSingle();
    expect(row?.visibility).toBe("planning");

    // The member cannot see it, so it must not appear in their badge...
    expect(await member.messages.unreadCount({ tripId: trip })).toBe(0);
    // ...and the member's own list confirms there is genuinely nothing to find.
    const memberCrew = await member.messages.list({ tripId: trip, visibility: "crew" });
    expect(memberCrew.some((m) => m.visibility === "planning")).toBe(false);

    // A crew message DOES reach them — proving the zero above is the filter
    // working, not the count being broken.
    await owner.messages.send({ tripId: trip, id: genId("msg"), text: "everyone" });
    expect(await member.messages.unreadCount({ tripId: trip })).toBe(1);
  });

  it("unreadCount — an organizer DOES count planning messages", async () => {
    // The other half: the same message must reach a caller who can read it, so
    // the test above can't pass by simply never counting planning.
    const trip = await ctx.createTrip("Unread Planning Visible");
    await ctx.addTripMember(trip, "planner", "Organizer");
    const owner = ctx.caller();
    const organizer = ctx.callerAs("planner");

    await organizer.messages.markRead({ tripId: trip, visibility: "crew" });
    await organizer.messages.markRead({ tripId: trip, visibility: "planning" });
    expect(await organizer.messages.unreadCount({ tripId: trip })).toBe(0);

    await owner.messages.send({
      tripId: trip,
      id: genId("msg"),
      text: "Organizers only — budget",
      visibility: "planning",
    });

    expect(await organizer.messages.unreadCount({ tripId: trip })).toBe(1);
  });

  it("unreadCount — excludes system messages (e.g. the clearChannel marker)", async () => {
    const trip = await ctx.createTrip("Unread System Excluded");
    await ctx.addTripMember(trip, "member", "Member");
    const owner = ctx.caller();
    await owner.messages.send({ tripId: trip, id: genId("msg"), text: "to be cleared" });
    await owner.messages.markRead({ tripId: trip, visibility: "crew" });
    // clearChannel wipes the message and leaves ONE system marker in its place.
    await owner.messages.clearChannel({ tripId: trip, visibility: "crew" });

    const count = await ctx.callerAs("member").messages.unreadCount({ tripId: trip });
    expect(count).toBe(0);
  });

  it("unreadCount — a plain member's count never includes the Organizers channel", async () => {
    const trip = await ctx.createTrip("Unread Member No Planning");
    await ctx.addTripMember(trip, "member", "Member");
    await ctx.caller().messages.send({
      tripId: trip,
      id: genId("msg"),
      visibility: "planning",
      text: "organizers only",
    });
    const count = await ctx.callerAs("member").messages.unreadCount({ tripId: trip });
    expect(count).toBe(0);
  });

  it("unreadCount — an organizer's count sums unread crew AND planning", async () => {
    const trip = await ctx.createTrip("Unread Organizer Sums Both");
    await ctx.addTripMember(trip, "planner", "Organizer");
    const owner = ctx.caller();
    const planner = ctx.callerAs("planner");

    await planner.messages.markRead({ tripId: trip, visibility: "crew" });
    await planner.messages.markRead({ tripId: trip, visibility: "planning" });

    await owner.messages.send({ tripId: trip, id: genId("msg"), text: "crew ping" });
    await owner.messages.send({
      tripId: trip,
      id: genId("msg"),
      visibility: "planning",
      text: "planning ping",
    });

    expect(await planner.messages.unreadCount({ tripId: trip })).toBe(2);
  });

  // ── unreadCountByChannel — the Chat tab's per-segment breakdown ─────────
  // `unreadCount` (above) is the summed total; these pin the per-channel
  // shape it's built from, which the Chat tab's Crew/Planning segment dots
  // read directly.

  it("unreadCountByChannel — an organizer gets a breakdown, not just a sum", async () => {
    const trip = await ctx.createTrip("Unread ByChannel Organizer");
    await ctx.addTripMember(trip, "planner", "Organizer");
    const owner = ctx.caller();
    const planner = ctx.callerAs("planner");

    await planner.messages.markRead({ tripId: trip, visibility: "crew" });
    await planner.messages.markRead({ tripId: trip, visibility: "planning" });

    await owner.messages.send({ tripId: trip, id: genId("msg"), text: "crew ping" });
    await owner.messages.send({
      tripId: trip,
      id: genId("msg"),
      visibility: "planning",
      text: "planning ping",
    });
    await owner.messages.send({ tripId: trip, id: genId("msg"), text: "crew ping 2" });

    const byChannel = await planner.messages.unreadCountByChannel({ tripId: trip });
    expect(byChannel).toEqual({ crew: 2, planning: 1 });
  });

  it("unreadCountByChannel — a plain member's planning share is always 0, even with unread planning messages", async () => {
    const trip = await ctx.createTrip("Unread ByChannel Member");
    await ctx.addTripMember(trip, "member", "Member");
    const owner = ctx.caller();
    const member = ctx.callerAs("member");

    await member.messages.markRead({ tripId: trip, visibility: "crew" });
    await owner.messages.send({
      tripId: trip,
      id: genId("msg"),
      visibility: "planning",
      text: "organizers only",
    });
    await owner.messages.send({ tripId: trip, id: genId("msg"), text: "everyone" });

    const byChannel = await member.messages.unreadCountByChannel({ tripId: trip });
    expect(byChannel).toEqual({ crew: 1, planning: 0 });
  });

  it("unreadCountByChannel — sums to the same total unreadCount returns", async () => {
    const trip = await ctx.createTrip("Unread ByChannel Matches Total");
    await ctx.addTripMember(trip, "planner", "Organizer");
    const owner = ctx.caller();
    const planner = ctx.callerAs("planner");

    await planner.messages.markRead({ tripId: trip, visibility: "crew" });
    await planner.messages.markRead({ tripId: trip, visibility: "planning" });
    await owner.messages.send({ tripId: trip, id: genId("msg"), text: "crew ping" });
    await owner.messages.send({
      tripId: trip,
      id: genId("msg"),
      visibility: "planning",
      text: "planning ping",
    });

    const [byChannel, total] = await Promise.all([
      planner.messages.unreadCountByChannel({ tripId: trip }),
      planner.messages.unreadCount({ tripId: trip }),
    ]);
    expect(byChannel.crew + byChannel.planning).toBe(total);
  });

  it("unreadCount — chat_visible_from floor excludes messages from before the member joined", async () => {
    const trip = await ctx.createTrip("Unread Floor Test");
    const owner = ctx.caller();

    const banter = await owner.messages.send({
      tripId: trip,
      id: genId("msg"),
      text: "Banter before you joined",
    });
    // Same clock-skew-proof floor derivation as the list() floor test above.
    const floor = new Date(
      new Date(banter.created_at as string).getTime() + 1
    ).toISOString();
    await ctx.admin.from("trip_members").insert({
      trip_id: trip,
      user_id: ctx.getUser("member").id,
      role: "Member",
      status: "in",
      chat_visible_from: floor,
    });

    // Only this one is visible to (and thus counts as unread for) the member.
    await owner.messages.send({ tripId: trip, id: genId("msg"), text: "Welcome aboard" });

    const count = await ctx.callerAs("member").messages.unreadCount({ tripId: trip });
    expect(count).toBe(1);
  });

  // ── clearChannel — owner-only privacy wipe ─────────────────────────────

  it("clearChannel — owner clears one channel without touching the other", async () => {
    const trip = await ctx.createTrip("Clear Chat Trip");
    await ctx.addTripMember(trip, "member", "Member");
    const owner = ctx.caller();

    await owner.messages.send({ tripId: trip, id: genId("msg"), text: "crew one" });
    await owner.messages.send({ tripId: trip, id: genId("msg"), text: "crew two" });
    await owner.messages.send({
      tripId: trip,
      id: genId("msg"),
      visibility: "planning",
      text: "org secret",
    });

    const res = await owner.messages.clearChannel({ tripId: trip, visibility: "crew" });
    expect(res.deleted).toBe(2);

    // Crew is wiped except the system "cleared" marker; planning is untouched.
    const crew = await owner.messages.list({ tripId: trip, visibility: "crew" });
    expect(crew.some((m) => m.text === "crew one")).toBe(false);
    expect(crew.some((m) => m.text === "crew two")).toBe(false);
    expect(crew.every((m) => m.message_type === "system")).toBe(true);

    const planning = await owner.messages.list({ tripId: trip, visibility: "planning" });
    expect(planning.some((m) => m.text === "org secret")).toBe(true);
  });

  it("clearChannel — non-owner is forbidden", async () => {
    const trip = await ctx.createTrip("Clear Chat Guard Trip");
    await ctx.addTripMember(trip, "member", "Member");
    await ctx.callerAs("member").messages.send({
      tripId: trip,
      id: genId("msg"),
      text: "do not delete me",
    });

    await expect(
      ctx.callerAs("member").messages.clearChannel({ tripId: trip, visibility: "crew" })
    ).rejects.toThrow(/Owner/i);

    // Message survives the rejected wipe.
    const crew = await ctx.caller().messages.list({ tripId: trip, visibility: "crew" });
    expect(crew.some((m) => m.text === "do not delete me")).toBe(true);
  });

  it("list — planning_visible_from floor hides Organizers history from before promotion", async () => {
    const floorTrip = await ctx.createTrip("Planning Floor Test");
    const owner = ctx.caller();

    // Owner posts to the Organizers channel before the new organizer arrives.
    const secret = await owner.messages.send({
      tripId: floorTrip,
      id: genId("msg"),
      visibility: "planning",
      text: "Secret organizer plan",
    });

    // Promote a member to Organizer with a planning floor 1ms past the secret
    // message's own server timestamp — the same clock-skew-proof derivation
    // used by the crew-floor test (floor from created_at, not the local clock).
    const floor = new Date(
      new Date(secret.created_at as string).getTime() + 1
    ).toISOString();
    await ctx.admin.from("trip_members").insert({
      trip_id: floorTrip,
      user_id: ctx.getUser("outsider").id,
      role: "Organizer",
      status: "in",
      chat_visible_from: floor,
      planning_visible_from: floor,
    });

    // Owner posts again after the promotion.
    await owner.messages.send({
      tripId: floorTrip,
      id: genId("msg"),
      visibility: "planning",
      text: "Plan after promotion",
    });

    const promotedView = await ctx.callerAs("outsider").messages.list({
      tripId: floorTrip,
      visibility: "planning",
    });
    expect(promotedView.some((m) => m.text === "Plan after promotion")).toBe(true);
    expect(promotedView.some((m) => m.text === "Secret organizer plan")).toBe(
      false
    );
  });
});
