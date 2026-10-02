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

/**
 * EVERY CASE BUILDS ITS OWN CUP (#1527, found at seed 90210). The cup used to
 * be built once in `beforeAll` and shared — moved there earlier so a CI retry
 * could not put a second cup on one trip — but the cases still read each
 * other's assignments: "nobody is on a team yet" ran after the case that puts
 * the owner on Blue, and "is PER VIEWER" read an owner nobody had assigned.
 * A cup per case answers both: there is no second cup on any trip, and each
 * case assigns exactly who it reads.
 */
type Cup = { tripId: string; competitionId: string; blueId: string; redId: string };

async function avatarCup(label: string): Promise<Cup> {
  const cup = await ctx.createCupTrip({
    name: `Avatar Cup ${label}`,
    scoringModel: "points",
    members: ["member", ["planner", "Organizer"]],
  });
  // Explicit, DISTINCT colours: `createTeam` defaults every team to the same
  // blue, so a per-viewer assertion against the default would compare a colour
  // to itself and pass or fail for the wrong reason.
  const blueId = await ctx.createTeam(cup.competitionId, "Blue", { shortName: "BLU", color: "#3b82f6", colorDim: "#0a1a2a" });
  const redId = await ctx.createTeam(cup.competitionId, "Red", { shortName: "RED", color: "#ef4444", colorDim: "#2a0a0a" });
  return { tripId: cup.tripId, competitionId: cup.competitionId, blueId, redId };
}

async function assign(cup: Cup, teamId: string, role: "owner" | "member") {
  const { error } = await ctx.admin
    .from("team_assignments")
    .insert({ competition_id: cup.competitionId, team_id: teamId, user_id: ctx.getUser(role).id });
  if (error) throw new Error(`seed ${role} assignment: ${error.message}`);
}

beforeAll(async () => {
  ctx = await TestContext.create();
});

afterAll(async () => {
  await ctx.cleanup();
}, 30000);

describe("competitions.myTeamColor", () => {
  it("returns null for a trip with NO competition", async () => {
    // The commonest trip in the product. Must be null, not a throw — the avatar
    // renders teal here and this is not an error.
    const tripId = await ctx.createTrip("Avatar colour trip");
    await expect(ctx.caller().competitions.myTeamColor({ tripId })).resolves.toBeNull();
  });

  it("returns null once a competition exists but nobody is on a team yet", async () => {
    // Teams exist; assignments don't. Having a competition is not the condition —
    // being ON a team is.
    const cup = await avatarCup("no-assignments");
    await expect(ctx.caller().competitions.myTeamColor({ tripId: cup.tripId })).resolves.toBeNull();
  });

  it("returns the assigned team's colour", async () => {
    const cup = await avatarCup("assigned");
    await assign(cup, cup.blueId, "owner");

    const res = await ctx.caller().competitions.myTeamColor({ tripId: cup.tripId });
    expect(res).not.toBeNull();
    expect(res!.teamId).toBe(cup.blueId);
    expect(res!.teamName).toBe("Blue");
    // The colour is whatever the team row carries — never a value this procedure
    // invents, so a palette change flows through without touching this code.
    const { data: team, error } = await ctx.admin.from("teams").select("color, color_dim").eq("id", cup.blueId).single();
    if (error) throw new Error(`read team: ${error.message}`);
    expect(res!.color).toBe(team!.color);
    expect(res!.colorDim).toBe(team!.color_dim);
  });

  it("is PER VIEWER — two members on different teams get different colours", async () => {
    const cup = await avatarCup("per-viewer");
    await assign(cup, cup.blueId, "owner");
    await assign(cup, cup.redId, "member");

    const asOwner = await ctx.caller().competitions.myTeamColor({ tripId: cup.tripId });
    const asMember = await ctx.callerAs("member").competitions.myTeamColor({ tripId: cup.tripId });

    // The whole point of the feature: the avatar is the VIEWER's identity. A
    // procedure that keyed off the trip alone would hand everyone one colour.
    expect(asOwner!.teamId).toBe(cup.blueId);
    expect(asMember!.teamId).toBe(cup.redId);
    expect(asOwner!.color).not.toBe(asMember!.color);
  });

  it("returns null for a trip member who is on no team, while others are", async () => {
    // The planner is a trip member but was never assigned. Their avatar stays
    // teal even though the competition has rosters — and it HAS rosters here,
    // so the null is about the planner and not an empty cup.
    const cup = await avatarCup("unassigned-viewer");
    await assign(cup, cup.blueId, "owner");
    await assign(cup, cup.redId, "member");
    expect(await ctx.caller().competitions.myTeamColor({ tripId: cup.tripId })).not.toBeNull(); // premise
    await expect(ctx.callerAs("planner").competitions.myTeamColor({ tripId: cup.tripId })).resolves.toBeNull();
  });

  it("refuses a non-member — it rides requireTripMember like every trip-scoped read", async () => {
    const cup = await avatarCup("outsider");
    await expect(ctx.callerAs("outsider").competitions.myTeamColor({ tripId: cup.tripId })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});
