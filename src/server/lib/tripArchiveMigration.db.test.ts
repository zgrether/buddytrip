import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";
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
 *   - departures: written ONLY when something in the trip still names the
 *     person after the clean-up (Zach: "no history, delete as before; any
 *     history, archive"); members read them, nobody writes them directly; the
 *     merge re-keys them; a departed placeholder is not hard-deleted, and one
 *     with no history is, as before;
 *   - pick'em sheets in unfinished games go with the seat; delegate grants end.
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

/** History: something in the trip that names them. A chat message is the
 *  smallest. `messages.user_id` is ON DELETE SET NULL, so for a placeholder it
 *  does not stop a hard delete by itself — only the departure record does. */
async function say(tripId: string, userId: string) {
  const { error } = await ctx.admin.from("messages").insert({
    id: genId("msg"), trip_id: tripId, user_id: userId, channel: "trip", team_id: null, text: "hello",
  });
  if (error) throw error;
}

async function plainTrip(name: string) {
  return ctx.createCupTrip({
    name, scoringModel: "points",
    members: [["planner", "Organizer"], ["member", "Member"], ["outsider", "Member"]],
  });
}

/** A teamed cup with NO finished game, so nothing names anyone yet. */
async function teamedCup(name: string) {
  const { tripId, competitionId } = await ctx.createCupTrip({
    name, scoringModel: "points",
    members: [["planner", "Organizer"], ["member", "Member"], ["outsider", "Member"]],
  });
  const alpha = await ctx.createTeam(competitionId, "Alpha", { shortName: "ALP" });
  const bravo = await ctx.createTeam(competitionId, "Bravo", { shortName: "BRV" });
  const ins = await ctx.admin.from("team_assignments").insert([
    { competition_id: competitionId, user_id: f.owner, team_id: alpha },
    { competition_id: competitionId, user_id: f.planner, team_id: alpha },
    { competition_id: competitionId, user_id: f.member, team_id: bravo },
    { competition_id: competitionId, user_id: f.outsider, team_id: bravo },
  ]);
  if (ins.error) throw ins.error;
  return { tripId, competitionId };
}

describe("leaving", () => {
  it("a Member leaves: membership ends, and the departure keeps the name the crew saw (the nickname)", async () => {
    const t = await plainTrip("Archive leave");
    const nick = await ctx.admin.from("trip_members").update({ nickname: "Biscuit" }).eq("trip_id", t.tripId).eq("user_id", f.member);
    if (nick.error) throw nick.error;
    await say(t.tripId, f.member);

    const { error } = await archive("member", t.tripId, f.member);
    expect(error).toBeNull();
    expect(await isMember(t.tripId, f.member)).toBe(false);
    expect((await departure(t.tripId, f.member))?.display_name).toBe("Biscuit");
  });

  it("with no nickname, the departure carries the account name", async () => {
    const t = await plainTrip("Archive account name");
    const { data: u } = await ctx.admin.from("users").select("name").eq("id", f.outsider).single();
    expect(u?.name).toBeTruthy();
    await say(t.tripId, f.outsider);
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
    // CONTROL first: the same delete made DIRECTLY removes nothing. Until
    // migration 210 the role guard refused it ("Only the trip owner"); since
    // then there is no DELETE policy, so RLS refuses it first — either way only
    // the archive, with its marker, can end an Organizer's membership.
    const direct = await ctx.authedClient("planner").from("trip_members").delete({ count: "exact" }).eq("trip_id", t.tripId).eq("user_id", f.planner);
    expect(direct.error).toBeNull();
    expect(direct.count).toBe(0);
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
    // ...and that history is what the departure stands beside.
    expect(await departure(c.tripId, f.planner)).not.toBeNull();

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
    await say(t.tripId, f.member);
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
    await say(t.tripId, f.member);
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

  it("a placeholder WITH history is archived and kept; one with NO history leaves no record and is deleted as before", async () => {
    // The two differ in one thing — a message naming the first — and take
    // the same path: archive, then the orphan-guest clean-up the app runs.
    const t = await plainTrip("Archive guest split");
    const withHistory = await guestOn(t.tripId, "Departed Guest");
    const noHistory = await guestOn(t.tripId, "Added By Mistake");
    await say(t.tripId, withHistory);

    for (const id of [withHistory, noHistory]) {
      expect((await archive("owner", t.tripId, id)).error).toBeNull();
      expect(await isMember(t.tripId, id)).toBe(false);
      expect((await ctx.authedClient("owner").rpc("delete_orphan_guest_user", { p_user_id: id })).error).toBeNull();
    }

    expect((await departure(t.tripId, withHistory))?.display_name).toBe("Departed Guest");
    expect(await userExists(withHistory)).toBe(true);

    expect(await departure(t.tripId, noHistory)).toBeNull();
    expect(await userExists(noHistory)).toBe(false);
  });

  it("the guest merge moves a departure to the real account, and the real account's wins a collision", async () => {
    const t = await plainTrip("Archive merge");
    const other = await plainTrip("Archive merge other");
    const ghost = await guestOn(t.tripId, "Placeholder");
    const real = await ctx.createAccount("archive-merge");
    await say(t.tripId, ghost);
    expect((await archive("owner", t.tripId, ghost)).error).toBeNull();
    // A second trip where BOTH have left: the collision.
    const g2 = await ctx.admin.from("trip_members").insert({ id: crypto.randomUUID(), trip_id: other.tripId, user_id: ghost, role: "Member", status: "in" });
    if (g2.error) throw g2.error;
    await say(other.tripId, ghost);
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

describe("the departure needs something to stand beside", () => {
  it("a real member with no history leaves no record", async () => {
    const t = await plainTrip("Archive no history");
    expect((await archive("member", t.tripId, f.member)).error).toBeNull();
    expect(await isMember(t.tripId, f.member)).toBe(false);
    expect(await departure(t.tripId, f.member)).toBeNull();
  });

  it("a seat in an UNFINISHED game is not history — the question is asked after the clean-up", async () => {
    // The member's only footprint is a seat the archive itself removes. Asked
    // before the clean-up, the seat would count and a record would be written.
    const c = await teamedCup("Archive seat not history");
    const live = await f.strokeGame(c.tripId, c.competitionId, "Live round");
    expect(await participantRows(live, f.member)).toBe(1);

    expect((await archive("member", c.tripId, f.member)).error).toBeNull();
    expect(await participantRows(live, f.member)).toBe(0);
    expect(await departure(c.tripId, f.member)).toBeNull();
  });
});

describe("pick'em sheets follow the seat rule", () => {
  async function pickemGame(tripId: string, competitionId: string, name: string) {
    const g = (await ctx.caller().games.create({ tripId, gameTypeId: "gtt_pickem", name, competitionId })) as { id: string };
    const pg = await ctx.admin.from("pickem_games").upsert({ game_id: g.id });
    if (pg.error) throw pg.error;
    const slateId = genId("slate");
    const sg = await ctx.admin.from("pickem_slate_games").insert({
      id: slateId, game_id: g.id, display_order: 0, away_team: "Alabama", home_team: "Georgia", multiplier: 1,
    });
    if (sg.error) throw sg.error;
    return { gameId: g.id, slateId };
  }
  async function pick(gameId: string, slateId: string, userId: string, enteredBy: string | null = null) {
    const { error } = await ctx.admin.from("pickem_picks").insert({
      id: genId("pick"), game_id: gameId, slate_game_id: slateId, user_id: userId, pick: "home", entered_by: enteredBy,
    });
    if (error) throw error;
  }
  async function picks(gameId: string, userId: string) {
    const { count, error } = await ctx.admin.from("pickem_picks")
      .select("id", { count: "exact", head: true }).eq("game_id", gameId).eq("user_id", userId);
    if (error) throw error;
    return count ?? 0;
  }

  it("their sheet in an UNFINISHED game goes; one in a FINISHED game stays; a sheet they entered for someone else stays", async () => {
    // Pick'em pays teams, so it needs a teamed cup (games.create refuses otherwise).
    const t = await teamedCup("Archive pickem");
    const done = await pickemGame(t.tripId, t.competitionId, "Last week");
    const open = await pickemGame(t.tripId, t.competitionId, "This week");
    await pick(done.gameId, done.slateId, f.member);
    await pick(open.gameId, open.slateId, f.member);
    // The member entered the outsider's sheet as a proxy: it is the outsider's.
    await pick(open.gameId, open.slateId, f.outsider, f.member);
    const fin = await ctx.admin.from("games").update({ status: "complete" }).eq("id", done.gameId);
    if (fin.error) throw fin.error;

    expect((await archive("member", t.tripId, f.member)).error).toBeNull();

    expect(await picks(open.gameId, f.member)).toBe(0);
    expect(await picks(done.gameId, f.member)).toBe(1);
    expect(await picks(open.gameId, f.outsider)).toBe(1);
    // The finished sheet is history, so the record exists.
    expect(await departure(t.tripId, f.member)).not.toBeNull();
  });
});

describe("delegate rights", () => {
  async function grant(rows: { game_id: string; user_id: string }[]) {
    const { error } = await ctx.admin.from("game_delegates").insert(rows.map((r) => ({ ...r, granted_by: f.owner })));
    if (error) throw error;
  }

  it("leaving ends every grant the person holds on the trip's games, finished or not", async () => {
    const c = await f.finishedCup("Archive delegates");
    const live = await f.strokeGame(c.tripId, c.competitionId, "Live round");
    await grant([
      { game_id: c.gameId, user_id: f.member },
      { game_id: live, user_id: f.member },
      { game_id: live, user_id: f.outsider },
    ]);

    expect((await archive("member", c.tripId, f.member)).error).toBeNull();

    const { data } = await ctx.admin.from("game_delegates").select("game_id, user_id").in("game_id", [c.gameId, live]);
    expect(data).toEqual([{ game_id: live, user_id: f.outsider }]);
  });

  it("a grant confers nothing on someone no longer on the trip", async () => {
    const c = await f.finishedCup("Delegate needs membership");
    const live = await f.strokeGame(c.tripId, c.competitionId, "Live round");
    await grant([{ game_id: live, user_id: f.member }]);
    const write = () => ctx.authedClient("member").from("game_results").insert({
      id: genId("res"), game_id: live, entity_type: "user", entity_id: f.member, value_kind: "rank", raw_score: 1,
    });

    // CONTROL: a member holding the grant may write.
    expect((await write()).error).toBeNull();

    // Off the trip by a path that leaves the grant in place, so only the
    // rights check itself can refuse.
    const off = await ctx.admin.from("trip_members").delete().eq("trip_id", c.tripId).eq("user_id", f.member);
    if (off.error) throw off.error;
    expect(await isMember(c.tripId, f.member)).toBe(false);
    expect((await write()).error?.code).toBe("42501");
  });
});

describe("the history helper is not part of the API", () => {
  it("a signed-in caller cannot ask it about someone", async () => {
    const t = await plainTrip("Archive helper hidden");
    const { error } = await ctx.authedClient("owner").rpc("_trip_history_names", { p_trip_id: t.tripId, p_user_id: f.member });
    expect(error).not.toBeNull();
  });
});

/**
 * DRIFT GUARD: every person-referencing column in the live schema is either
 * read by `_trip_history_names` or named here as not-history, with a reason.
 * A new table that names a person fails this until someone decides which.
 *
 * Its limit, stated: it checks the CLASSIFICATION, not the function body —
 * PostgREST exposes no function source. The behavioural cases above pin the
 * arms that matter most (a message, a finished game, a finished pick'em sheet,
 * an unfinished seat that must not count). JSONB references (`game_matches`
 * sides) cannot be found by column name and are read by the function anyway.
 */
describe("every column that names a person is classified", () => {
  const HISTORY = new Set([
    "messages.user_id", "expenses.paid_by_user_id", "expenses.created_by", "expense_splits.user_id",
    "news_posts.author_id", "schedule_items.created_by", "schedule_items.confirmed_by",
    "logistics_items.created_by", "quick_info_tiles.created_by", "idea_lodging_options.created_by",
    "idea_votes.user_id", "date_poll_votes.user_id", "invites.created_by",
    "game_participants.user_id", "game_results.entity_id", "score_entries.participant_id",
    "score_entries.submitted_by", "match_hole_outcomes.submitted_by", "skins_hole_outcomes.submitted_by",
    "skins_hole_outcomes.winner_user_id", "pickem_picks.user_id", "pickem_picks.entered_by",
    "bracket_entrant_members.user_id", "game_recredits.user_id", "game_recredits.recredited_by",
    "game_delegates.granted_by",
  ]);
  const NOT_HISTORY: Record<string, string> = {
    "trip_members.user_id": "the membership itself",
    "trip_departures.user_id": "the record itself",
    "team_assignments.user_id": "cleared by the archive",
    "game_delegates.user_id": "a right, cleared by the archive",
    "chat_reads.user_id": "a read receipt, never shown as a name",
    "news_reads.user_id": "a read receipt, never shown as a name",
    "push_send_log.actor_user_id": "delivery bookkeeping",
    "push_subscriptions.user_id": "the person's own devices, not the trip's",
    "circle_members.user_id": "not scoped to a trip",
    "circles.created_by": "not scoped to a trip",
    "courses.created_by": "global course data",
    "users.created_by": "account metadata",
    "archived_ideas.user_id": "the person's own archive, not the trip's",
  };
  const PERSON = new Set([
    "created_by", "submitted_by", "entity_id", "participant_id", "granted_by", "author_id",
    "confirmed_by", "entered_by", "recredited_by",
  ]);

  it("no person-referencing column is unclassified", async () => {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    if (!res.ok) throw new Error(`OpenAPI read failed: ${res.status}`);
    const spec = (await res.json()) as { definitions?: Record<string, { properties?: Record<string, unknown> }> };
    const live: string[] = [];
    for (const [table, def] of Object.entries(spec.definitions ?? {})) {
      for (const col of Object.keys(def.properties ?? {})) {
        if (col.endsWith("user_id") || PERSON.has(col)) live.push(`${table}.${col}`);
      }
    }
    // Positive control: the reader sees columns we know exist.
    expect(live).toContain("messages.user_id");
    expect(live).toContain("trip_members.user_id");

    const unclassified = live.filter((c) => !HISTORY.has(c) && !(c in NOT_HISTORY)).sort();
    expect(unclassified).toEqual([]);
  });
});
