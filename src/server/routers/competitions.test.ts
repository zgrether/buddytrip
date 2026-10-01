import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

/**
 * EVERY CASE BUILDS THE TRIP IT USES (#1527). The cases used to share one trip
 * and walk its single competition through a life: created by one case, read by
 * the next, renamed, deleted — and then "CASCADE-deletes its games" created a
 * second one on the same trip, which only works once the first is gone. A
 * trip holds one cup (migration 195), so shuffled, the creates collided ("A
 * competition already exists for this trip"), the duplicate refusal found no
 * first cup to collide with, and getByTrip read a cup that had not been made.
 */
let ctx: TestContext;

/** Owner = primary user; planner = Organizer; member = Member. No cup yet. */
async function crewTrip(label: string): Promise<string> {
  const tripId = await ctx.createTrip(`Competitions ${label}`);
  await ctx.addTripMember(tripId, "planner", "Organizer");
  await ctx.addTripMember(tripId, "member", "Member");
  return tripId;
}

/** A crew trip that already holds its one cup, made with the sanctioned helper. */
async function cupTrip(label: string, name = "BBMI 2027"): Promise<{ tripId: string; competitionId: string }> {
  const tripId = await crewTrip(label);
  const competitionId = await ctx.createCompetition(tripId, name);
  return { tripId, competitionId };
}

describe("competitions router", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("getByTrip — returns null when none exists", async () => {
    const tripId = await crewTrip("none");
    const result = await ctx.caller().competitions.getByTrip({ tripId });
    expect(result).toBeNull();
  });

  it("create — owner can create (scoring_model defaults to head-to-head)", async () => {
    const tripId = await crewTrip("create");
    const comp = await ctx.caller().competitions.create({
      tripId,
      name: "BBMI 2027",
      tagline: "The cup returns",
    });
    ctx.trackCompetition(comp.id);
    expect(comp.name).toBe("BBMI 2027");
    expect(comp.tagline).toBe("The cup returns");
    expect(comp.status).toBe("upcoming");
    // Shape chooser omitted → match_play (head-to-head) default.
    expect(comp.scoring_model).toBe("match_play");
  });

  it("create — the shape chooser writes scoring_model (points) + defaults to 2 teams", async () => {
    const pointsTripId = await ctx.createTrip("Points-shape cup");
    const caller = ctx.caller();
    const comp = await caller.competitions.create({
      tripId: pointsTripId,
      name: "Points Cup",
      scoringModel: "points",
    });
    expect(comp.scoring_model).toBe("points");
    ctx.trackCompetition(comp.id);

    // No teamCount → defaults to 2 (Team A blue + Team B red, unchanged from before the picker).
    const teams = (await caller.teams.list({ tripId: pointsTripId, competitionId: comp.id })) as Array<{ short_name: string; color: string }>;
    expect(teams.map((t) => t.short_name).sort()).toEqual(["A", "B"]);
    expect(new Map(teams.map((t) => [t.short_name, t.color])).get("A")).toBe("#3b82f6");
    expect(new Map(teams.map((t) => [t.short_name, t.color])).get("B")).toBe("#ef4444");
  });

  it("create — the team-count picker seeds N default-named teams (§1)", async () => {
    const bigTripId = await ctx.createTrip("Four-team cup");
    const caller = ctx.caller();
    const comp = await caller.competitions.create({
      tripId: bigTripId,
      name: "Four Team Cup",
      scoringModel: "points",
      teamCount: 4,
    });
    ctx.trackCompetition(comp.id);
    const teams = (await caller.teams.list({ tripId: bigTripId, competitionId: comp.id })) as Array<{ name: string; short_name: string }>;
    expect(teams.map((t) => t.short_name).sort()).toEqual(["A", "B", "C", "D"]);
    expect(teams.map((t) => t.name).sort()).toEqual(["Team A", "Team B", "Team C", "Team D"]);
  });

  it("create — match-play is locked at 2 teams even if a teamCount is sent", async () => {
    const mpTripId = await ctx.createTrip("Locked head-to-head");
    const caller = ctx.caller();
    const comp = await caller.competitions.create({
      tripId: mpTripId,
      name: "Head to Head",
      scoringModel: "match_play",
      teamCount: 4, // ignored — match-play seeds exactly 2
    });
    ctx.trackCompetition(comp.id);
    const teams = await caller.teams.list({ tripId: mpTripId, competitionId: comp.id });
    expect((teams as Array<{ short_name: string }>).map((t) => t.short_name).sort()).toEqual(["A", "B"]);
  });

  it("create — member cannot create", async () => {
    const tripId = await crewTrip("member-create");
    await expect(
      ctx.callerAs("member").competitions.create({ tripId, name: "Sneaky" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    // …and nothing was made, so the refusal is not a create that also threw.
    expect(await ctx.caller().competitions.getByTrip({ tripId })).toBeNull();
  });

  // The READ-FIRST branch: the common case, refused with a sentence before the
  // insert. Since migration 195 it is no longer the guard — the database is, and
  // `competitions.oneCupPerTrip.test.ts` pins that refusal and the race past this one.
  it("create — a second competition on the trip is refused, readably (read-first branch)", async () => {
    const { tripId, competitionId } = await cupTrip("second");
    // Premise: the first cup is there to collide with.
    expect((await ctx.caller().competitions.getByTrip({ tripId }))?.id).toBe(competitionId);
    await expect(
      ctx.caller().competitions.create({ tripId, name: "Second one" })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("getByTrip — returns competition for any trip member", async () => {
    const { tripId, competitionId } = await cupTrip("member-read");
    const result = await ctx.callerAs("member").competitions.getByTrip({ tripId });
    expect(result?.id).toBe(competitionId);
    expect(result?.name).toBe("BBMI 2027");
  });

  it("update — planner can edit metadata", async () => {
    const { tripId, competitionId } = await cupTrip("organizer-update");
    const updated = await ctx.callerAs("planner").competitions.update({
      tripId,
      competitionId,
      tagline: "If you're not first, you're last",
    });
    expect(updated.tagline).toBe("If you're not first, you're last");
  });

  it("update — short_name persists and clears back to null", async () => {
    const { tripId, competitionId } = await cupTrip("short-name");
    const ownerCaller = ctx.caller();

    // Set a short label (the bottom-nav tab uses this).
    const set = await ownerCaller.competitions.update({ tripId, competitionId, shortName: "BBMI" });
    expect(set.short_name).toBe("BBMI");

    // Empty clears it → null (nav falls back to the full name).
    const cleared = await ownerCaller.competitions.update({ tripId, competitionId, shortName: null });
    expect(cleared.short_name).toBeNull();
  });

  it("delete — only owner can delete", async () => {
    const { tripId, competitionId } = await cupTrip("delete");

    await expect(
      ctx.callerAs("planner").competitions.delete({ tripId, competitionId })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    // The refusal deleted nothing…
    expect((await ctx.caller().competitions.getByTrip({ tripId }))?.id).toBe(competitionId);

    const ok = await ctx.caller().competitions.delete({ tripId, competitionId });
    expect(ok).toEqual({ success: true });
    // …and the owner's delete really did.
    expect(await ctx.caller().competitions.getByTrip({ tripId })).toBeNull();
  });

  it("delete — CASCADE-deletes its games (Phase 1 default), never leaving detached orphans", async () => {
    const tripId = await crewTrip("cascade");
    const caller = ctx.caller();
    const comp = await caller.competitions.create({ tripId, name: "Cascade Cup" });
    ctx.trackCompetition(comp.id);
    const game = (await caller.games.create({
      tripId,
      gameTypeId: "gtt_manual",
      name: "Cascade Game",
      competitionId: comp.id,
      pointsDistribution: { type: "placement", values: [3, 1] },
    })) as { id: string };

    const gameRow = async () => {
      const { data, error } = await ctx.admin.from("games").select("id").eq("id", game.id).maybeSingle();
      if (error) throw new Error(`read game: ${error.message}`);
      return data;
    };
    expect(await gameRow()).not.toBeNull(); // premise: there is a game to cascade

    await caller.competitions.delete({ tripId, competitionId: comp.id });

    // The game is DELETED with the competition (delete_competition_cascade,
    // migration 079) — NOT SET NULL-detached. The row is gone, and nothing is
    // left carrying the dead competition id. (The full child-cascade / ordering
    // proof lives in deleteCompetitionCascade.test.ts.)
    expect(await gameRow()).toBeNull();
    const { data: detached, error } = await ctx.admin
      .from("games")
      .select("id")
      .eq("competition_id", comp.id);
    if (error) throw new Error(`read detached games: ${error.message}`);
    expect(detached).toEqual([]);
  });
});
