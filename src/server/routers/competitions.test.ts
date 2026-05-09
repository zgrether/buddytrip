import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

let ctx: TestContext;
let tripId: string;

describe("competitions router", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
    tripId = await ctx.createTrip("Competitions Test");
    await ctx.addTripMember(tripId, "planner", "Planner");
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

  it("create — owner can create", async () => {
    const caller = ctx.caller();
    const comp = await caller.competitions.create({
      tripId,
      name: "BBMI 2027",
      tagline: "The cup returns",
    });
    expect(comp.name).toBe("BBMI 2027");
    expect(comp.tagline).toBe("The cup returns");
    expect(comp.status).toBe("upcoming");
    ctx.trackCompetition(comp.id);
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
      motto: "If you're not first, you're last",
      status: "active",
    });
    expect(updated.motto).toBe("If you're not first, you're last");
    expect(updated.status).toBe("active");
  });

  it("hydrate — returns null competition + members when not set up", async () => {
    // Burn the comp first so the trip has none.
    const ownerCaller = ctx.caller();
    const existing = await ownerCaller.competitions.getByTrip({ tripId });
    if (existing) {
      // Active status from the previous test would block delete; flip
      // it back to upcoming so we can wipe.
      await ownerCaller.competitions.update({
        tripId,
        competitionId: existing.id,
        status: "upcoming",
      });
      await ownerCaller.competitions.delete({
        tripId,
        competitionId: existing.id,
      });
    }

    const result = await ownerCaller.competitions.hydrate({ tripId });
    expect(result.competition).toBeNull();
    expect(result.teams).toEqual([]);
    expect(result.assignments).toEqual([]);
    expect(result.events).toEqual([]);
    // members + golfItems are still loaded — the comp tab uses them
    // for setup-mode UI even when the competition itself doesn't exist.
    expect(result.members.length).toBeGreaterThan(0);
    expect(Array.isArray(result.golfItems)).toBe(true);
  });

  it("hydrate — bundles comp + teams + assignments + events", async () => {
    const ownerCaller = ctx.caller();
    const comp = await ownerCaller.competitions.create({
      tripId,
      name: "Hydrate Cup",
    });
    ctx.trackCompetition(comp.id);

    const team = await ownerCaller.teams.create({
      tripId,
      competitionId: comp.id,
      name: "Hydrate Team",
      shortName: "HY",
      color: "#ff8800",
      colorDim: "#332010",
    });
    ctx.trackTeam(team.id);

    const event = await ownerCaller.events.create({
      tripId,
      competitionId: comp.id,
      type: "GENERIC",
      title: "Cornhole",
    });
    ctx.trackEvent(event.id);

    const result = await ownerCaller.competitions.hydrate({ tripId });
    expect(result.competition?.id).toBe(comp.id);
    expect(result.teams.find((t) => t.id === team.id)).toBeDefined();
    expect(result.events.find((e) => e.id === event.id)).toBeDefined();
    expect(Array.isArray(result.assignments)).toBe(true);
    expect(Array.isArray(result.members)).toBe(true);
    expect(Array.isArray(result.golfItems)).toBe(true);
  });

  it("hydrate — outsider gets FORBIDDEN", async () => {
    const outsiderCaller = ctx.callerAs("outsider");
    await expect(
      outsiderCaller.competitions.hydrate({ tripId })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
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
});
