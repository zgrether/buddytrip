import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

/**
 * `competitions.myTeamColor` — the viewer's team identity for a trip, which the
 * account avatar in the app bar reads on every tab.
 *
 * Every case here is a state a real trip passes THROUGH, not an edge case: a
 * trip with no competition, a competition before rosters are set, and a member
 * on a team. All three must resolve, and the first two must resolve to null
 * rather than throwing — the avatar's teal fallback is the default state for
 * most trips, not an error path.
 */

let ctx: TestContext;
let tripId: string;
let competitionId: string;
let blueId: string;
let redId: string;

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("Avatar colour trip");
  await ctx.addTripMember(tripId, "member", "Member");
  await ctx.addTripMember(tripId, "planner", "Organizer");
});

afterAll(async () => {
  await ctx.cleanup();
}, 30000);

describe("competitions.myTeamColor", () => {
  it("returns null for a trip with NO competition", async () => {
    // The commonest trip in the product. Must be null, not a throw — the avatar
    // renders teal here and this is not an error.
    await expect(ctx.caller().competitions.myTeamColor({ tripId })).resolves.toBeNull();
  });

  it("returns null once a competition exists but nobody is on a team yet", async () => {
    competitionId = await ctx.createCompetition(tripId, "Avatar Cup", { scoringModel: "points" });
    // Explicit, DISTINCT colours: `createTeam` defaults every team to the same
    // blue, so a per-viewer assertion against the default would compare a colour
    // to itself and pass or fail for the wrong reason.
    blueId = await ctx.createTeam(competitionId, "Blue", { shortName: "BLU", color: "#3b82f6", colorDim: "#0a1a2a" });
    redId = await ctx.createTeam(competitionId, "Red", { shortName: "RED", color: "#ef4444", colorDim: "#2a0a0a" });

    // Teams exist; assignments don't. Having a competition is not the condition —
    // being ON a team is.
    await expect(ctx.caller().competitions.myTeamColor({ tripId })).resolves.toBeNull();
  });

  it("returns the assigned team's colour", async () => {
    const owner = ctx.getUser("owner").id;
    const { error } = await ctx.admin
      .from("team_assignments")
      .insert([{ competition_id: competitionId, team_id: blueId, user_id: owner }]);
    if (error) throw new Error(`seed assignment: ${error.message}`);

    const res = await ctx.caller().competitions.myTeamColor({ tripId });
    expect(res).not.toBeNull();
    expect(res!.teamId).toBe(blueId);
    expect(res!.teamName).toBe("Blue");
    // The colour is whatever the team row carries — never a value this procedure
    // invents, so a palette change flows through without touching this code.
    const { data: team } = await ctx.admin.from("teams").select("color, color_dim").eq("id", blueId).single();
    expect(res!.color).toBe(team!.color);
    expect(res!.colorDim).toBe(team!.color_dim);
  });

  it("is PER VIEWER — two members on different teams get different colours", async () => {
    const member = ctx.getUser("member").id;
    const { error } = await ctx.admin
      .from("team_assignments")
      .insert([{ competition_id: competitionId, team_id: redId, user_id: member }]);
    if (error) throw new Error(`seed member assignment: ${error.message}`);

    const asOwner = await ctx.caller().competitions.myTeamColor({ tripId });
    const asMember = await ctx.callerAs("member").competitions.myTeamColor({ tripId });

    // The whole point of the feature: the avatar is the VIEWER's identity. A
    // procedure that keyed off the trip alone would hand everyone one colour.
    expect(asOwner!.teamId).toBe(blueId);
    expect(asMember!.teamId).toBe(redId);
    expect(asOwner!.color).not.toBe(asMember!.color);
  });

  it("returns null for a trip member who is on no team, while others are", async () => {
    // The planner is a trip member but was never assigned. Their avatar stays
    // teal even though the competition has rosters.
    await expect(ctx.callerAs("planner").competitions.myTeamColor({ tripId })).resolves.toBeNull();
  });

  it("refuses a non-member — it rides requireTripMember like every trip-scoped read", async () => {
    await expect(ctx.callerAs("outsider").competitions.myTeamColor({ tripId })).rejects.toThrow();
  });
});
