import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";

/**
 * Team chat — the policy has no staff branch, and this file is what says so.
 *
 * ── Why this drives PostgREST and not tRPC ─────────────────────────────────
 *
 * The 2026-08-20 RLS audit's central finding: **a test that goes through the
 * callers cannot see a policy wider than its callers.** Twelve gaps sat behind
 * correct, careful procedures — the app never did the thing the policy
 * permitted, so no caller-level test could fail and none did. `game_matches_select`
 * was found gating on the wrong thing after every check had passed as Owner.
 *
 * So every read below goes through `ctx.authedClient(role)` — the anon key plus
 * a real Bearer token, which is exactly what a browser holds and exactly what a
 * curious Owner would use. The tRPC procedures are well-behaved; that is not the
 * question this file asks.
 *
 * ── The two suites that would pass against a wrong build ───────────────────
 *
 * The spec names both, and they are the reason the fixture is shaped the way it
 * is rather than the obvious way:
 *
 *   1. *"A suite that only checks non-members passes against a policy with a
 *      staff bypass."* So the load-bearing cases are not "a member reads their
 *      team". They are the **Owner, the Organizer and the game delegate**
 *      reading a team they are not on and getting nothing. Those fail the moment
 *      someone adds `OR has_trip_role(...)` for consistency with every other
 *      policy in this schema — which is the realistic way this regresses,
 *      because every other policy here HAS that branch.
 *
 *   2. *"A suite that only runs one team passes against a policy that leaks
 *      across teams."* So there are **two teams with different rosters**, and
 *      the decisive cases are each team's member reading the OTHER team. A
 *      single-team fixture cannot distinguish "only your team" from "any team
 *      in a trip you belong to", and the second is a real policy someone could
 *      write by dropping the `ta.team_id = messages.team_id` clause.
 *
 * ── The fixture, and why each person is where they are ─────────────────────
 *
 *   owner    — Owner of the trip, a game DELEGATE, and on NO team.
 *              Carries both staff branches at once: if either `has_trip_role`
 *              or `is_game_delegate` is ever added to the team arm, this person
 *              starts reading both teams and four cases go red.
 *   planner  — Organizer of the trip, on team B.
 *              The sharpest single reader in the file: staff AND a team member,
 *              so their refusal on team A cannot be explained by "they're not in
 *              the competition" — only by the policy being per-team.
 *   member   — plain Member, on team A. The positive case.
 *   outsider — not in the trip at all. The floor.
 *
 * ── Confirmed non-vacuous by doing it, not by asserting it ─────────────────
 *
 * Both wrong builds were actually written into the live local database and this
 * suite run against them. The results are worth recording in full, because the
 * two mutants fail DIFFERENT tests — which is the evidence that the suite
 * distinguishes two failure modes rather than one assertion catching everything:
 *
 *   MUTANT 1 — `OR has_trip_role(trip_id, ARRAY['Owner','Organizer'])` added to
 *   the team arm. 2 failed / 11 passed:
 *     × the Organizer on team B cannot read team A
 *     × the Owner, who is also a delegate, reads NO team chat at all
 *
 *   MUTANT 2 — `ta.team_id = messages.team_id` dropped, so the arm asks "are you
 *   on ANY team in this trip" instead of "are you on THIS team".
 *   2 failed / 11 passed:
 *     × a member of team A cannot read team B
 *     × the Organizer on team B cannot read team A
 *
 * Note what SURVIVES mutant 2: the Owner case passes, correctly — they are on no
 * team, so "any team" does not admit them either. A suite whose only staff case
 * was the Owner would therefore have gone green against a policy that leaks
 * every team to every player in the competition. That is the second wrong build
 * the spec names, and it is why `planner` is on team B rather than on no team.
 *
 * The policy was restored by re-applying migrations 008 and 172 and the suite
 * returned to 13 passed.
 *
 * ── Refusal shapes, asserted differently ───────────────────────────────────
 *
 *   * SELECT against a failing USING returns `[]` with NO error.
 *   * INSERT against a failing WITH CHECK errors (42501).
 *
 * A test asserting `error` is non-null on a refused SELECT would be asserting
 * something the mechanism never produces, and would pass against a policy that
 * returns everything.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/** Unauthenticated — the publishable key alone, which ships in the bundle. */
const anonClient = () => createClient(SUPABASE_URL, ANON_KEY);

let ctx: TestContext;
let tripId: string;
let competitionId: string;
let teamA: string;
let teamB: string;
let msgA: string;
let msgB: string;
let crewMsg: string;

beforeAll(async () => {
  ctx = await TestContext.create();

  tripId = await ctx.createTrip("Team Chat Policy");
  await ctx.addTripMember(tripId, "planner", "Organizer");
  await ctx.addTripMember(tripId, "member", "Member");

  competitionId = await ctx.createCompetition(tripId);
  teamA = await ctx.createTeam(competitionId, "Buddy", { shortName: "BUD" });
  teamB = await ctx.createTeam(competitionId, "Banks", { shortName: "BNK" });

  // member -> A, planner -> B. The owner is deliberately on NEITHER.
  await ctx.admin.from("team_assignments").insert([
    {
      competition_id: competitionId,
      user_id: ctx.getUser("member").id,
      team_id: teamA,
    },
    {
      competition_id: competitionId,
      user_id: ctx.getUser("planner").id,
      team_id: teamB,
    },
  ]);

  // A game with the owner as delegate — the third staff branch. It has to be a
  // real `game_delegates` row and not merely an assertion that owners are staff,
  // because `is_game_delegate` is a separate function and could be added to the
  // policy on its own.
  const gameId = genId("game");
  await ctx.admin.from("games").insert({
    id: gameId,
    trip_id: tripId,
    competition_id: competitionId,
    name: "Delegate Game",
    game_type_id: "stroke_play",
  });
  await ctx.admin.from("game_delegates").insert({
    game_id: gameId,
    user_id: ctx.getUser("owner").id,
  });

  // One message in each team room, and one in Crew for the contrast case.
  msgA = genId("msg");
  msgB = genId("msg");
  crewMsg = genId("msg");
  await ctx.admin.from("messages").insert([
    {
      id: msgA,
      trip_id: tripId,
      user_id: ctx.getUser("member").id,
      channel: "team",
      team_id: teamA,
      text: "buddy team talk",
      visibility: "crew",
      message_type: "user",
    },
    {
      id: msgB,
      trip_id: tripId,
      user_id: ctx.getUser("planner").id,
      channel: "team",
      team_id: teamB,
      text: "banks team talk",
      visibility: "crew",
      message_type: "user",
    },
    {
      id: crewMsg,
      trip_id: tripId,
      user_id: ctx.getUser("owner").id,
      channel: "trip",
      team_id: null,
      text: "everyone",
      visibility: "crew",
      message_type: "user",
    },
  ]);
}, 60_000);

afterAll(async () => {
  await ctx.cleanup();
}, 60_000);

/** Every team message this role can actually read, by id. */
async function teamMessagesVisibleTo(role: "owner" | "planner" | "member" | "outsider") {
  const { data, error } = await ctx
    .authedClient(role)
    .from("messages")
    .select("id, team_id")
    .eq("trip_id", tripId)
    .eq("channel", "team");
  expect(error).toBeNull();
  return (data ?? []) as { id: string; team_id: string }[];
}

describe("team chat RLS — the read", () => {
  it("a team member reads their own team's chat", async () => {
    const rows = await teamMessagesVisibleTo("member");
    expect(rows.map((r) => r.id)).toContain(msgA);
  });

  it("the Organizer on team B reads team B", async () => {
    const rows = await teamMessagesVisibleTo("planner");
    expect(rows.map((r) => r.id)).toContain(msgB);
  });

  /**
   * THE CROSS-TEAM CASE. `member` is in the trip and in the competition, so the
   * only thing that can refuse them team B is the `ta.team_id = messages.team_id`
   * clause. Drop it and this is the test that goes red.
   */
  it("a member of team A cannot read team B", async () => {
    const rows = await teamMessagesVisibleTo("member");
    expect(rows.map((r) => r.id)).not.toContain(msgB);
    expect(rows.every((r) => r.team_id === teamA)).toBe(true);
  });

  /**
   * The same clause from the other side, by a person who is ALSO staff — so a
   * pass here cannot be explained by them lacking rights generally.
   */
  it("the Organizer on team B cannot read team A", async () => {
    const rows = await teamMessagesVisibleTo("planner");
    expect(rows.map((r) => r.id)).not.toContain(msgA);
    expect(rows.every((r) => r.team_id === teamB)).toBe(true);
  });

  /**
   * THE STAFF CASE. Owner of the trip AND a game delegate, on no team, reading
   * a trip they own. Adding either staff branch to the team arm turns this red.
   */
  it("the Owner, who is also a delegate, reads NO team chat at all", async () => {
    const rows = await teamMessagesVisibleTo("owner");
    expect(rows).toHaveLength(0);
  });

  it("the Owner still reads Crew — the refusal is scoped to team rooms", async () => {
    const { data } = await ctx
      .authedClient("owner")
      .from("messages")
      .select("id")
      .eq("trip_id", tripId)
      .eq("channel", "trip");
    expect((data ?? []).map((r) => r.id as string)).toContain(crewMsg);
  });

  it("a non-member of the trip reads nothing", async () => {
    const rows = await teamMessagesVisibleTo("outsider");
    expect(rows).toHaveLength(0);
  });

  it("an unauthenticated client reads nothing", async () => {
    const { data } = await anonClient()
      .from("messages")
      .select("id")
      .eq("trip_id", tripId)
      .eq("channel", "team");
    expect(data ?? []).toHaveLength(0);
  });
});

describe("team chat RLS — the write", () => {
  it("a team member can post to their own team", async () => {
    const id = genId("msg");
    const { error } = await ctx.authedClient("member").from("messages").insert({
      id,
      trip_id: tripId,
      user_id: ctx.getUser("member").id,
      channel: "team",
      team_id: teamA,
      text: "mine",
      visibility: "crew",
      message_type: "user",
    });
    expect(error).toBeNull();
    await ctx.admin.from("messages").delete().eq("id", id);
  });

  it("a member of team A cannot post to team B", async () => {
    const { error } = await ctx.authedClient("member").from("messages").insert({
      id: genId("msg"),
      trip_id: tripId,
      user_id: ctx.getUser("member").id,
      channel: "team",
      team_id: teamB,
      text: "not mine",
      visibility: "crew",
      message_type: "user",
    });
    expect(error).not.toBeNull();
    expect(error!.code).toBe("42501");
  });

  it("the Owner cannot post to a team they are not on", async () => {
    const { error } = await ctx.authedClient("owner").from("messages").insert({
      id: genId("msg"),
      trip_id: tripId,
      user_id: ctx.getUser("owner").id,
      channel: "team",
      team_id: teamA,
      text: "owner here",
      visibility: "crew",
      message_type: "user",
    });
    expect(error).not.toBeNull();
    expect(error!.code).toBe("42501");
  });
});

/**
 * The policy's stated fragility, asserted rather than only commented.
 *
 * `messages_select`'s team arm reads `team_assignments` and `competitions`
 * DIRECTLY rather than through a SECURITY DEFINER helper, and Postgres applies
 * RLS inside policy subqueries — so the arm works only while those two SELECT
 * policies stay member-wide. This is the check that would catch it: if a member
 * stops being able to see their own assignment row, they stop being able to see
 * their own team chat, with no error anywhere.
 *
 * It is a canary, not a behaviour test. If it fails, read the comment on
 * `messages_select` (migration 172) before assuming team chat is what broke.
 */
describe("team chat RLS — the subquery's dependency", () => {
  it("a member can read their own team_assignments row, which the team arm needs", async () => {
    const { data, error } = await ctx
      .authedClient("member")
      .from("team_assignments")
      .select("team_id")
      .eq("competition_id", competitionId)
      .eq("user_id", ctx.getUser("member").id);
    expect(error).toBeNull();
    expect((data ?? []).map((r) => r.team_id as string)).toEqual([teamA]);
  });

  it("a member can read the competition row the team arm joins through", async () => {
    const { data, error } = await ctx
      .authedClient("member")
      .from("competitions")
      .select("id")
      .eq("id", competitionId);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(1);
  });
});
