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
      tagline: "If you're not first, you're last",
      status: "active",
    });
    expect(updated.tagline).toBe("If you're not first, you're last");
    expect(updated.status).toBe("active");
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
