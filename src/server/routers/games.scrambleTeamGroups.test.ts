import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

/**
 * SCRAMBLE ARRIVES WITH ITS GROUPS — the teams ARE the groupings.
 *
 * There is no group builder for this format, so if the groups are not there the
 * game is unplayable with no surface to fix it on: its go-live gate (migration
 * 182) is "at least one grouped participant", and a runner would face "finish
 * setting up this game" with no setting to finish. That is exactly what Zach
 * hit.
 *
 * ── The two moments, and why both are needed ───────────────────────────────
 *
 * Seeding at CREATE covers the ordinary flow. It does not cover a cup whose
 * games are added before its people are assigned — a real order, and the one
 * that would strand a game permanently now that the builder is hidden. So the
 * same helper runs again at go-live, idempotent by emptiness.
 *
 * The idempotency is not a nicety. `save_game_config` treats a changed group SET
 * as structure and clean-replaces it with fresh ids, which would orphan every
 * `score_entries` row keyed to the old play_group. A seed that fires only on a
 * game with zero groups cannot reach that path, and the last test here is what
 * pins it.
 */

const SCRAMBLE = "gtt_scramble";
const STROKE_PLAY = "gtt_stroke_play";

let ctx: TestContext;
let tripId: string;

/** The groups a game actually has, with their members — the shape under test. */
async function groupsOf(gameId: string) {
  const { data: groups } = await ctx.admin
    .from("play_groups")
    .select("id, display_name")
    .eq("game_id", gameId);
  const { data: parts } = await ctx.admin
    .from("game_participants")
    .select("user_id, play_group_id, team_id")
    .eq("game_id", gameId);
  return (groups ?? []).map((g) => ({
    name: g.display_name as string,
    members: (parts ?? [])
      .filter((p) => p.play_group_id === g.id)
      .map((p) => p.user_id as string)
      .sort(),
  }));
}

describe("scramble seeds one group per team", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
    tripId = await ctx.createTrip("Scramble Groups Trip");
    await ctx.addTripMember(tripId, "planner", "Organizer");
    await ctx.addTripMember(tripId, "member", "Member");
  }, 60_000);

  afterAll(async () => {
    await ctx.cleanup();
  }, 60_000);

  async function cupWithTeams(name: string) {
    const comp = await ctx.createCompetition(tripId, name, { scoringModel: "points" });
    const teamA = await ctx.createTeam(comp, "Alpha", { shortName: "ALP" });
    const teamB = await ctx.createTeam(comp, "Bravo", { shortName: "BRV" });
    return { comp, teamA, teamB };
  }

  it("creates a group per team, named for it, with that team's members", async () => {
    const { comp, teamA, teamB } = await cupWithTeams("Seed At Create");
    const owner = ctx.getUser("owner").id;
    const planner = ctx.getUser("planner").id;
    const member = ctx.getUser("member").id;
    await ctx.admin.from("team_assignments").insert([
      { competition_id: comp, user_id: owner, team_id: teamA },
      { competition_id: comp, user_id: planner, team_id: teamA },
      { competition_id: comp, user_id: member, team_id: teamB },
    ]);

    const game = (await ctx.caller().games.create({
      tripId, gameTypeId: SCRAMBLE, name: "Auto Groups", competitionId: comp,
    })) as { id: string };

    const groups = await groupsOf(game.id);
    expect(groups).toHaveLength(2);
    expect(groups.find((g) => g.name === "Alpha")?.members).toEqual([owner, planner].sort());
    expect(groups.find((g) => g.name === "Bravo")?.members).toEqual([member]);
  }, 60_000);

  it("A TEAM WITH NOBODY ON IT GETS NO GROUP — an empty side must not be able to post a card", async () => {
    const { comp, teamA } = await cupWithTeams("Empty Team");
    await ctx.admin.from("team_assignments").insert([
      { competition_id: comp, user_id: ctx.getUser("owner").id, team_id: teamA },
    ]);
    const game = (await ctx.caller().games.create({
      tripId, gameTypeId: SCRAMBLE, name: "One Team Playing", competitionId: comp,
    })) as { id: string };

    const groups = await groupsOf(game.id);
    expect(groups.map((g) => g.name)).toEqual(["Alpha"]);
  }, 60_000);

  it("A GAME CREATED BEFORE THE TEAMS ARE ASSIGNED still becomes playable", async () => {
    /**
     * The case that needs the SECOND call site. Create the game first, assign
     * people after — a real order, and with the group builder hidden it would
     * otherwise strand the game with no way to fix it.
     */
    const { comp, teamA, teamB } = await cupWithTeams("Teams After");
    const game = (await ctx.caller().games.create({
      tripId, gameTypeId: SCRAMBLE, name: "Empty At Birth", competitionId: comp,
    })) as { id: string };

    // Nothing to seed from yet — and that is not an error, it is just not ready.
    expect(await groupsOf(game.id)).toEqual([]);

    const owner = ctx.getUser("owner").id;
    const member = ctx.getUser("member").id;
    await ctx.admin.from("team_assignments").insert([
      { competition_id: comp, user_id: owner, team_id: teamA },
      { competition_id: comp, user_id: member, team_id: teamB },
    ]);

    // Going live seeds first, THEN checks readiness — so this does not throw.
    await ctx.caller().games.enableScoring({ tripId, gameId: game.id });
    const groups = await groupsOf(game.id);
    expect(groups).toHaveLength(2);
    expect(groups.flatMap((g) => g.members).sort()).toEqual([owner, member].sort());
  }, 60_000);

  it("IS IDEMPOTENT — going live again does not mint a second set of groups", async () => {
    /**
     * The assertion that keeps the second call site safe. If this seeded again,
     * a re-enable would double the groups; and if it ever REBUILT them the ids
     * would move, orphaning every score keyed to the old play_group.
     *
     * Asserted on the group IDS, not the count: a rebuild that replaced two
     * groups with two different groups keeps the count identical, which is
     * exactly the failure a count cannot see.
     */
    const { comp, teamA } = await cupWithTeams("Idempotent");
    await ctx.admin.from("team_assignments").insert([
      { competition_id: comp, user_id: ctx.getUser("owner").id, team_id: teamA },
    ]);
    const game = (await ctx.caller().games.create({
      tripId, gameTypeId: SCRAMBLE, name: "Twice", competitionId: comp,
    })) as { id: string };

    const idsBefore = ((await ctx.admin.from("play_groups").select("id").eq("game_id", game.id)).data ?? [])
      .map((g) => g.id as string)
      .sort();
    await ctx.caller().games.enableScoring({ tripId, gameId: game.id });
    await ctx.caller().games.enableScoring({ tripId, gameId: game.id });
    const idsAfter = ((await ctx.admin.from("play_groups").select("id").eq("game_id", game.id)).data ?? [])
      .map((g) => g.id as string)
      .sort();

    expect(idsBefore).toHaveLength(1);
    expect(idsAfter).toEqual(idsBefore);
  }, 60_000);

  it("A STROKE GAME SEEDS NOTHING — the control", async () => {
    // Every other roster format keeps its manual builder; seeding one would
    // silently make somebody else's foursomes for them.
    const { comp, teamA } = await cupWithTeams("Stroke Control");
    await ctx.admin.from("team_assignments").insert([
      { competition_id: comp, user_id: ctx.getUser("owner").id, team_id: teamA },
    ]);
    const game = (await ctx.caller().games.create({
      tripId, gameTypeId: STROKE_PLAY, name: "Manual Groups", competitionId: comp,
    })) as { id: string };

    expect(await groupsOf(game.id)).toEqual([]);
  }, 60_000);
});
