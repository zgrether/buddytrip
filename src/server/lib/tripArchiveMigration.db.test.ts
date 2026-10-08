import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";
import { recreditFixture } from "../../__tests__/helpers/recreditFixture";

/**
 * Migration 205's database contract — leaving a trip is an ARCHIVE (PR 8d,
 * ruling 19 and Zach's rulings of 2026-10-08) — through direct calls, no tRPC.
 *
 *   - `archive_trip_member` is the one path for leaving and removal: it writes
 *     the departure (the name the crew saw), clears cup assignments, keeps
 *     FINISHED games exactly as they are, vacates seats in unfinished ones, and
 *     ends the membership;
 *   - its rules: the Owner cannot leave; Owners/Organizers remove Members, only
 *     the Owner removes an Organizer, nobody removes the Owner;
 *   - an Organizer CAN leave — admitted by the archive's marker, while the same
 *     delete made directly is still refused (the control that proves it is the
 *     marker doing it);
 *   - the direct self-delete is closed;
 *   - departures: members read them, nobody writes them directly; the merge
 *     re-keys them; a departed placeholder is not hard-deleted.
 *
 * Each case builds its own trip: these are destructive writes (CLAUDE.md).
 */

const MATCH_PLAY = "gtt_match_play";

let ctx: TestContext;
let f: ReturnType<typeof recreditFixture>;

beforeAll(async () => {
  ctx = await TestContext.create();
  f = recreditFixture(ctx);
}, 60_000);

afterAll(async () => {
  await ctx.cleanup();
}, 60_000);

const archive = (role: "owner" | "planner" | "member" | "outsider", tripId: string, userId: string) =>
  ctx.authedClient(role).rpc("archive_trip_member", { p_trip_id: tripId, p_user_id: userId });

async function isMember(tripId: string, userId: string) {
  const { count, error } = await ctx.admin
    .from("trip_members").select("user_id", { count: "exact", head: true })
    .eq("trip_id", tripId).eq("user_id", userId);
  if (error) throw error;
  return (count ?? 0) > 0;
}

async function departure(tripId: string, userId: string) {
  const { data, error } = await ctx.admin
    .from("trip_departures").select("display_name, left_at").eq("trip_id", tripId).eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data;
}

async function participantRows(gameId: string, userId: string) {
  const { count, error } = await ctx.admin
    .from("game_participants").select("user_id", { count: "exact", head: true })
    .eq("game_id", gameId).eq("user_id", userId);
  if (error) throw error;
  return count ?? 0;
}

async function plainTrip(name: string) {
  return ctx.createCupTrip({
    name, scoringModel: "points",
    members: [["planner", "Organizer"], ["member", "Member"], ["outsider", "Member"]],
  });
}

describe("leaving", () => {
  it("a Member leaves: membership ends, and the departure keeps the name the crew saw (the nickname)", async () => {
    const t = await plainTrip("Archive leave");
    const nick = await ctx.admin.from("trip_members").update({ nickname: "Biscuit" }).eq("trip_id", t.tripId).eq("user_id", f.member);
    if (nick.error) throw nick.error;

    const { error } = await archive("member", t.tripId, f.member);
    expect(error).toBeNull();
    expect(await isMember(t.tripId, f.member)).toBe(false);
    expect((await departure(t.tripId, f.member))?.display_name).toBe("Biscuit");
  });

  it("with no nickname, the departure carries the account name", async () => {
    const t = await plainTrip("Archive account name");
    const { data: u } = await ctx.admin.from("users").select("name").eq("id", f.outsider).single();
    expect(u?.name).toBeTruthy();
    expect((await archive("outsider", t.tripId, f.outsider)).error).toBeNull();
    expect((await departure(t.tripId, f.outsider))?.display_name).toBe(u?.name);
  });

  it("the Owner cannot leave — the trip would have nobody to run it", async () => {
    const t = await plainTrip("Archive owner stays");
    const { error } = await archive("owner", t.tripId, f.owner);
    expect(error?.message).toContain("ARCHIVE_OWNER_MUST_TRANSFER");
    expect(await isMember(t.tripId, f.owner)).toBe(true);
    expect(await departure(t.tripId, f.owner)).toBeNull();
  });

  it("an Organizer CAN leave through the archive — and the same delete made DIRECTLY is still refused", async () => {
    const t = await plainTrip("Archive organizer leaves");
    // CONTROL first: the role guard refuses an Organizer deleting an
    // Organizer's row (their own), so without the archive's marker this fails.
    const direct = await ctx.authedClient("planner").from("trip_members").delete().eq("trip_id", t.tripId).eq("user_id", f.planner);
    expect(direct.error?.message).toContain("Only the trip owner");
    expect(await isMember(t.tripId, f.planner)).toBe(true);

    const { error } = await archive("planner", t.tripId, f.planner);
    expect(error).toBeNull();
    expect(await isMember(t.tripId, f.planner)).toBe(false);
  });

  it("CLOSED: a Member can no longer end their own membership straight through the API", async () => {
    const t = await plainTrip("Archive self delete closed");
    const { error, count } = await ctx.authedClient("member")
      .from("trip_members").delete({ count: "exact" }).eq("trip_id", t.tripId).eq("user_id", f.member);
    expect(error).toBeNull();
    expect(count).toBe(0);
    expect(await isMember(t.tripId, f.member)).toBe(true);
  });
});

describe("removing", () => {
  it("Owners and Organizers remove Members; only the Owner removes an Organizer; nobody removes the Owner", async () => {
    const t = await plainTrip("Archive removal rules");
    expect((await archive("member", t.tripId, f.outsider)).error?.message).toContain("ARCHIVE_NOT_ALLOWED");
    expect((await archive("planner", t.tripId, f.owner)).error?.message).toContain("ARCHIVE_CANNOT_REMOVE_OWNER");

    expect((await archive("planner", t.tripId, f.member)).error).toBeNull();
    expect(await isMember(t.tripId, f.member)).toBe(false);

    // A second Organizer: the first may not remove them, the Owner may.
    const promote = await ctx.admin.from("trip_members").update({ role: "Organizer" }).eq("trip_id", t.tripId).eq("user_id", f.outsider);
    if (promote.error) throw promote.error;
    expect((await archive("planner", t.tripId, f.outsider)).error?.message).toContain("ARCHIVE_ORGANIZER_REMOVES_MEMBERS_ONLY");
    expect(await isMember(t.tripId, f.outsider)).toBe(true);
    expect((await archive("owner", t.tripId, f.outsider)).error).toBeNull();
    expect(await isMember(t.tripId, f.outsider)).toBe(false);
  });

  it("someone who is not a member cannot be archived", async () => {
    const t = await plainTrip("Archive not a member");
    expect((await archive("planner", t.tripId, f.member)).error).toBeNull();
    expect((await archive("planner", t.tripId, f.member)).error?.message).toContain("ARCHIVE_NOT_A_MEMBER");
  });
});

describe("what leaving clears — and what it keeps", () => {
  it("FINISHED games keep everything; UNFINISHED games lose the seat; cup assignments go", async () => {
    // A finished stroke round with the planner in it (Alpha), then an
    // unfinished stroke round and an unfinished match with them too.
    const c = await f.finishedCup("Archive keeps finished");
    const live = await f.strokeGame(c.tripId, c.competitionId, "Live round");
    const match = (await ctx.caller().games.create({
      tripId: c.tripId, gameTypeId: MATCH_PLAY, name: "Live match", competitionId: c.competitionId,
      pointsDistribution: { type: "per_match", value: 1 },
    })) as { id: string };
    const pairs = (await ctx.caller().matches.setPairings({
      tripId: c.tripId, gameId: match.id,
      matches: [{ playersPerSide: 1, sideA: { members: [f.planner] }, sideB: { members: [f.member] }, matchNumber: 1 }],
    })) as { id: string }[];
    // The opponent's handicap was set against the planner.
    const hc = await ctx.admin.from("game_participants").update({ handicap_strokes: 3 }).eq("game_id", match.id).eq("user_id", f.member);
    if (hc.error) throw hc.error;

    expect(await participantRows(c.gameId, f.planner)).toBe(1);
    expect(await participantRows(live, f.planner)).toBe(1);

    const { error } = await archive("planner", c.tripId, f.planner);
    expect(error).toBeNull();

    // Finished: participation, result and credited roster untouched.
    expect(await participantRows(c.gameId, f.planner)).toBe(1);
    expect((await f.creditedRoster(c.gameId))[f.planner]).toBe(c.alpha);
    expect(await f.teamTotals(c.gameId)).toEqual({ [c.alpha]: 11, [c.bravo]: 8 });
    const res = await ctx.admin.from("game_results").select("entity_id").eq("game_id", c.gameId).eq("entity_type", "user").eq("entity_id", f.planner);
    expect(res.data).toHaveLength(1);

    // Unfinished: the seat goes, the match side is vacated, the opponent's
    // handicap is cleared.
    expect(await participantRows(live, f.planner)).toBe(0);
    expect(await participantRows(match.id, f.planner)).toBe(0);
    const { data: m } = await ctx.admin.from("game_matches").select("side_a, side_b").eq("id", pairs[0].id).single();
    expect(m?.side_a).toBeNull();
    expect((m?.side_b as { id: string }).id).toBe(f.member);
    const { data: opp } = await ctx.admin.from("game_participants").select("handicap_strokes").eq("game_id", match.id).eq("user_id", f.member).single();
    expect(opp?.handicap_strokes).toBeNull();

    // Cup assignment gone; everyone else's untouched.
    const { data: ta } = await ctx.admin.from("team_assignments").select("user_id").eq("competition_id", c.competitionId);
    expect((ta ?? []).map((r) => r.user_id).sort()).toEqual([f.member, f.outsider, f.owner].sort());
  });

  it("leaving again after re-joining refreshes the one departure record", async () => {
    const t = await plainTrip("Archive rejoin");
    expect((await archive("member", t.tripId, f.member)).error).toBeNull();
    const first = await departure(t.tripId, f.member);
    const back = await ctx.admin.from("trip_members").insert({ id: crypto.randomUUID(), trip_id: t.tripId, user_id: f.member, role: "Member", status: "in" });
    if (back.error) throw back.error;
    await new Promise((r) => setTimeout(r, 20));
    expect((await archive("member", t.tripId, f.member)).error).toBeNull();
    const second = await departure(t.tripId, f.member);
    expect(second).not.toBeNull();
    expect(new Date(second!.left_at).getTime()).toBeGreaterThan(new Date(first!.left_at).getTime());
    const { count } = await ctx.admin.from("trip_departures").select("user_id", { count: "exact", head: true }).eq("trip_id", t.tripId).eq("user_id", f.member);
    expect(count).toBe(1);
  });
});

describe("trip_departures: who reads it, who writes it", () => {
  it("current members read it; the departed person does not; nobody inserts directly", async () => {
    const t = await plainTrip("Archive departures visibility");
    expect((await archive("member", t.tripId, f.member)).error).toBeNull();

    const asOwner = await ctx.authedClient("owner").from("trip_departures").select("display_name").eq("trip_id", t.tripId);
    expect(asOwner.data).toHaveLength(1);

    const asDeparted = await ctx.authedClient("member").from("trip_departures").select("display_name").eq("trip_id", t.tripId);
    expect(asDeparted.error).toBeNull();
    expect(asDeparted.data).toEqual([]);

    const write = await ctx.authedClient("owner").from("trip_departures").insert({ trip_id: t.tripId, user_id: f.outsider, display_name: "x" });
    expect(write.error?.code).toBe("42501");
  });
});

describe("placeholders", () => {
  async function guestOn(tripId: string, name: string) {
    const id = `ghost-${crypto.randomUUID()}`;
    const u = await ctx.admin.from("users").insert({ id, name, is_guest: true });
    if (u.error) throw u.error;
    const m = await ctx.admin.from("trip_members").insert({ id: crypto.randomUUID(), trip_id: tripId, user_id: id, role: "Member", status: "in" });
    if (m.error) throw m.error;
    return id;
  }
  async function userExists(id: string) {
    const { count } = await ctx.admin.from("users").select("id", { count: "exact", head: true }).eq("id", id);
    return (count ?? 0) > 0;
  }

  it("a departed placeholder is NOT hard-deleted — and a CONTROL placeholder with no departure is", async () => {
    const t = await plainTrip("Archive guest kept");
    const departed = await guestOn(t.tripId, "Departed Guest");
    expect((await archive("owner", t.tripId, departed)).error).toBeNull();
    expect((await ctx.authedClient("owner").rpc("delete_orphan_guest_user", { p_user_id: departed })).error).toBeNull();
    expect(await userExists(departed)).toBe(true);

    const control = `ghost-${crypto.randomUUID()}`;
    const u = await ctx.admin.from("users").insert({ id: control, name: "Never Joined", is_guest: true });
    if (u.error) throw u.error;
    expect((await ctx.authedClient("owner").rpc("delete_orphan_guest_user", { p_user_id: control })).error).toBeNull();
    expect(await userExists(control)).toBe(false);
  });

  it("the guest merge moves a departure to the real account, and the real account's wins a collision", async () => {
    const t = await plainTrip("Archive merge");
    const other = await plainTrip("Archive merge other");
    const ghost = await guestOn(t.tripId, "Placeholder");
    const real = await ctx.createAccount("archive-merge");
    expect((await archive("owner", t.tripId, ghost)).error).toBeNull();
    // A second trip where BOTH have left: the collision.
    const g2 = await ctx.admin.from("trip_members").insert({ id: crypto.randomUUID(), trip_id: other.tripId, user_id: ghost, role: "Member", status: "in" });
    if (g2.error) throw g2.error;
    expect((await archive("owner", other.tripId, ghost)).error).toBeNull();
    const realDep = await ctx.admin.from("trip_departures").insert({ trip_id: other.tripId, user_id: real.id, display_name: "Real Name" });
    if (realDep.error) throw realDep.error;

    const { error } = await ctx.admin.rpc("merge_guest_to_real_user", { p_ghost_id: ghost, p_real_id: real.id });
    expect(error).toBeNull();
    expect((await departure(t.tripId, real.id))?.display_name).toBe("Placeholder");
    expect((await departure(other.tripId, real.id))?.display_name).toBe("Real Name");
    const { count } = await ctx.admin.from("trip_departures").select("user_id", { count: "exact", head: true }).eq("user_id", ghost);
    expect(count).toBe(0);
  });
});
