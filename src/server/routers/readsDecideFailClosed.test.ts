import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";
import { callerFailingRead } from "../../__tests__/helpers/failingRead";
import { MATCHES_COMPETITION_FORMAT } from "@/lib/resultStrategy";

/**
 * #1663 — reads that DECIDE something must not decide on a failed read.
 *
 * Each case fails exactly one read and asserts the call refuses with a
 * retryable 500 and that nothing it would have written was written. Each has a
 * CONTROL: the same call through working reads does what it is for, which
 * shows the fixture can express the outcome the failure must prevent.
 *
 * `saveConfig`'s case is the sharp one. Its recompute read used to run AFTER
 * `save_game_config` committed, so a failed read there either skipped the
 * recompute or, once it threw, reported a committed save as failed. The read
 * now runs before the write, so a failure leaves the game untouched.
 */

let ctx: TestContext;
let owner: string, member: string;

async function expectRetryable(p: Promise<unknown>) {
  vi.spyOn(console, "error").mockImplementation(() => {});
  let caught: unknown = null;
  try {
    await p;
  } catch (e) {
    caught = e;
  }
  vi.restoreAllMocks();
  expect(caught, "the call must fail while the read fails").not.toBeNull();
  expect((caught as { code?: string }).code).toBe("INTERNAL_SERVER_ERROR");
}

beforeAll(async () => {
  ctx = await TestContext.create();
  owner = ctx.user.id;
  member = ctx.getUser("member").id;
}, 60_000);

afterAll(async () => {
  await ctx.cleanup();
}, 60_000);

describe("the team identity-edit gate's captain read (middleware)", () => {
  async function captainCup(label: string) {
    const tripId = await ctx.createTrip(`1663 captain ${label}`);
    await ctx.addTripMember(tripId, "member", "Member");
    const competitionId = await ctx.createCompetition(tripId, `1663 cup ${label}`);
    const teamId = await ctx.createTeam(competitionId, "Alpha", { shortName: "ALP" });
    const ins = await ctx.admin.from("team_assignments").insert([
      { competition_id: competitionId, user_id: member, team_id: teamId, is_captain: true },
    ]);
    if (ins.error) throw ins.error;
    return { tripId, teamId };
  }
  const teamName = async (teamId: string) => (await ctx.admin.from("teams").select("name").eq("id", teamId).single()).data?.name;

  it("a failed read is a retryable 500, not 'only the captain can', and the name is unchanged", async () => {
    const c = await captainCup("failed");
    await expectRetryable(
      callerFailingRead(ctx, "member", { table: "team_assignments", columns: "user_id" }).teams.update({
        tripId: c.tripId, teamId: c.teamId, name: "Renamed",
      })
    );
    expect(await teamName(c.teamId)).toBe("Alpha");
  }, 60_000);

  it("CONTROL: through a working read, the captain renames their team", async () => {
    const c = await captainCup("control");
    await ctx.callerAs("member").teams.update({ tripId: c.tripId, teamId: c.teamId, name: "Renamed" });
    expect(await teamName(c.teamId)).toBe("Renamed");
  }, 60_000);
});

describe("competitions.faceBootstrap's competition read", () => {
  let tripId: string;
  let competitionId: string;
  beforeAll(async () => {
    tripId = await ctx.createTrip("1663 bootstrap");
    competitionId = await ctx.createCompetition(tripId, "1663 bootstrap cup");
  }, 60_000);

  it("a failed read is a retryable 500, never 'this trip has no competition'", async () => {
    await expectRetryable(
      callerFailingRead(ctx, "owner", { table: "competitions", columns: "*" }).competitions.faceBootstrap({ tripId })
    );
  }, 60_000);

  it("CONTROL: through a working read, the trip's competition comes back", async () => {
    const boot = (await ctx.caller().competitions.faceBootstrap({ tripId })) as { competition: { id: string } | null };
    expect(boot.competition?.id).toBe(competitionId);
  }, 60_000);
});

describe("teamAssignments.assign's sort-order read", () => {
  async function cup(label: string) {
    const tripId = await ctx.createTrip(`1663 assign ${label}`);
    await ctx.addTripMember(tripId, "member", "Member");
    const competitionId = await ctx.createCompetition(tripId, `1663 assign cup ${label}`);
    const teamId = await ctx.createTeam(competitionId, "Alpha", { shortName: "ALP" });
    return { tripId, competitionId, teamId };
  }
  const assignment = async (competitionId: string) =>
    (await ctx.admin.from("team_assignments").select("team_id").eq("competition_id", competitionId).eq("user_id", member).maybeSingle()).data;

  it("a failed read is a retryable 500, and nobody is assigned with a made-up order", async () => {
    const c = await cup("failed");
    await expectRetryable(
      callerFailingRead(ctx, "owner", { table: "team_assignments", columns: "sort_order" }).teamAssignments.assign({
        tripId: c.tripId, competitionId: c.competitionId, userId: member, teamId: c.teamId,
      })
    );
    expect(await assignment(c.competitionId)).toBeNull();
  }, 60_000);

  it("CONTROL: through a working read, the player is assigned", async () => {
    const c = await cup("control");
    await ctx.caller().teamAssignments.assign({ tripId: c.tripId, competitionId: c.competitionId, userId: member, teamId: c.teamId });
    expect(await assignment(c.competitionId)).toEqual({ team_id: c.teamId });
  }, 60_000);
});

describe("games.saveConfig's recompute read now runs BEFORE the write", () => {
  let tripId: string;
  let competitionId: string;
  beforeAll(async () => {
    ({ tripId, competitionId } = await ctx.createCupTrip({
      name: "1663 saveConfig", scoringModel: "points", teams: ["Team A", "Team B"], members: [["member", "Member"]],
    }));
  }, 60_000);

  async function input(gameId: string, name: string) {
    const g = (await ctx.caller().games.getById({ tripId, gameId })) as Record<string, unknown>;
    return {
      tripId, gameId,
      baseHash: (await ctx.caller().games.configHash({ tripId, gameId })).hash,
      payload: {
        name,
        rulesForToday: (g.rules_for_today as string | null) ?? null,
        scoringEnabled: (g.scoring_enabled as boolean) ?? false,
        pointsTotal: (g.points_total as number | null) ?? 4,
        pointsDistribution: g.points_distribution ?? null,
        courseId: null, backCourseId: null, scorecardSchema: null,
        delegates: [],
        competitionFormat: MATCHES_COMPETITION_FORMAT,
        matches: [{ matchNumber: 1, playersPerSide: 1 as const, a: [owner], b: [member], strokesA: 0, strokesB: 0, pointValue: null }],
        matchesStructureDirty: true,
      } as never,
    };
  }
  const nameOf = async (gameId: string) => (await ctx.admin.from("games").select("name").eq("id", gameId).single()).data?.name;

  it("a failed read refuses the save before anything is written", async () => {
    const g = (await ctx.caller().games.create({ tripId, competitionId, gameTypeId: "gtt_generic_card", name: "Before" })) as { id: string };
    await expectRetryable(
      callerFailingRead(ctx, "owner", { table: "games", columns: "game_type_id, status" }).games.saveConfig(await input(g.id, "After"))
    );
    expect(await nameOf(g.id), "the write must not have happened").toBe("Before");
  }, 60_000);

  it("CONTROL: through a working read, the save lands", async () => {
    const g = (await ctx.caller().games.create({ tripId, competitionId, gameTypeId: "gtt_generic_card", name: "Before" })) as { id: string };
    await ctx.caller().games.saveConfig(await input(g.id, "After"));
    expect(await nameOf(g.id)).toBe("After");
  }, 60_000);
});

