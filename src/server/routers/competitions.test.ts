import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

let ctx: TestContext;
let tripId: string;

describe("competitions router", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
    tripId = await ctx.createTrip("Competitions Test");
    await ctx.addTripMember(tripId, "planner", "Organizer");
    await ctx.addTripMember(tripId, "member", "Member");
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("getByTrip — returns null when none exists", async () => {
    const caller = ctx.caller();
    const result = await caller.competitions.getByTrip({ tripId });
    expect(result).toBeNull();
  });

  it("create — owner can create (scoring_model defaults to head-to-head)", async () => {
    const caller = ctx.caller();
    const comp = await caller.competitions.create({
      tripId,
      name: "BBMI 2027",
      tagline: "The cup returns",
    });
    expect(comp.name).toBe("BBMI 2027");
    expect(comp.tagline).toBe("The cup returns");
    expect(comp.status).toBe("upcoming");
    // Shape chooser omitted → match_play (head-to-head) default.
    expect(comp.scoring_model).toBe("match_play");
    ctx.trackCompetition(comp.id);
  });

  it("create — the shape chooser writes scoring_model (points) + seeds 2 teams", async () => {
    const pointsTripId = await ctx.createTrip("Points-shape cup");
    const caller = ctx.caller();
    const comp = await caller.competitions.create({
      tripId: pointsTripId,
      name: "Points Cup",
      scoringModel: "points",
    });
    expect(comp.scoring_model).toBe("points");
    ctx.trackCompetition(comp.id);

    // Both shapes seed exactly two placeholder teams; the Teams shape adds more
    // afterward via the Rosters surface.
    const teams = await caller.teams.list({ tripId: pointsTripId, competitionId: comp.id });
    expect((teams as Array<{ short_name: string }>).map((t) => t.short_name).sort()).toEqual(["A", "B"]);
  });

  it("create — member cannot create", async () => {
    const caller = ctx.callerAs("member");
    await expect(
      caller.competitions.create({ tripId, name: "Sneaky" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("create — duplicate per trip rejected (MVP one-per-trip)", async () => {
    const caller = ctx.caller();
    await expect(
      caller.competitions.create({ tripId, name: "Second one" })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("getByTrip — returns competition for any trip member", async () => {
    const caller = ctx.callerAs("member");
    const result = await caller.competitions.getByTrip({ tripId });
    expect(result?.name).toBe("BBMI 2027");
  });

  it("update — planner can edit metadata", async () => {
    const ownerCaller = ctx.caller();
    const existing = await ownerCaller.competitions.getByTrip({ tripId });
    expect(existing).not.toBeNull();

    const plannerCaller = ctx.callerAs("planner");
    const updated = await plannerCaller.competitions.update({
      tripId,
      competitionId: existing!.id,
      tagline: "If you're not first, you're last",
    });
    expect(updated.tagline).toBe("If you're not first, you're last");
  });

  it("update — short_name persists and clears back to null", async () => {
    const ownerCaller = ctx.caller();
    const existing = await ownerCaller.competitions.getByTrip({ tripId });
    expect(existing).not.toBeNull();

    // Set a short label (the bottom-nav tab uses this).
    const set = await ownerCaller.competitions.update({
      tripId,
      competitionId: existing!.id,
      shortName: "BBMI",
    });
    expect(set.short_name).toBe("BBMI");

    // Empty clears it → null (nav falls back to the full name).
    const cleared = await ownerCaller.competitions.update({
      tripId,
      competitionId: existing!.id,
      shortName: null,
    });
    expect(cleared.short_name).toBeNull();
  });

  it("delete — only owner can delete", async () => {
    const ownerCaller = ctx.caller();
    const existing = await ownerCaller.competitions.getByTrip({ tripId });
    expect(existing).not.toBeNull();

    const plannerCaller = ctx.callerAs("planner");
    await expect(
      plannerCaller.competitions.delete({
        tripId,
        competitionId: existing!.id,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const ok = await ownerCaller.competitions.delete({
      tripId,
      competitionId: existing!.id,
    });
    expect(ok).toEqual({ success: true });
  });

  it("delete — CASCADE-deletes its games (Phase 1 default), never leaving detached orphans", async () => {
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

    await caller.competitions.delete({ tripId, competitionId: comp.id });

    // The game is DELETED with the competition (delete_competition_cascade,
    // migration 079) — NOT SET NULL-detached. The row is gone, and nothing is
    // left carrying the dead competition id. (The full child-cascade / ordering
    // proof lives in deleteCompetitionCascade.test.ts.)
    const { data: row } = await ctx.admin
      .from("games")
      .select("id")
      .eq("id", game.id)
      .maybeSingle();
    expect(row).toBeNull();
    const { data: detached } = await ctx.admin
      .from("games")
      .select("id")
      .eq("competition_id", comp.id);
    expect(detached?.length ?? 0).toBe(0);
  });
});
