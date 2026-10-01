import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

/**
 * Competition Organizer role — the container grants it, the gate honors it.
 *
 * A trip ORGANIZER is granted the competition organizer role (owner-minus-destructive) by
 * the container mapping (resolveCompetitionRole), LIVE-derived from current trip
 * membership. We assert the matrix in BOTH phases and — the critical one —
 * that demoting the organizer pulls Organizer access on the next check, with no
 * re-save of the competition (no snapshot to go stale).
 */

const MANUAL = "gtt_manual";
const DIST = { type: "placement" as const, values: [9, 6] };

let ctx: TestContext;
let tripId: string;
let competitionId: string;
let teamA: string;
let teamB: string;
let plannerId: string;
const gameIds: string[] = [];

async function newManualGame(name: string) {
  const g = (await ctx.caller().games.create({
    tripId,
    gameTypeId: MANUAL,
    name,
    competitionId,
    pointsDistribution: DIST,
  })) as { id: string };
  gameIds.push(g.id);
  return g.id;
}

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("Organizer trip");
  await ctx.addTripMember(tripId, "planner", "Organizer"); // → competition Organizer
  await ctx.addTripMember(tripId, "member", "Member");
  plannerId = ctx.getUser("planner").id;
  competitionId = await ctx.createCompetition(tripId, "Organizer Cup");
  teamA = await ctx.createTeam(competitionId, "Blue", { shortName: "BLU" });
  teamB = await ctx.createTeam(competitionId, "Red", { shortName: "RED" });
});

afterAll(async () => {
  for (const id of gameIds) {
    await ctx.admin.from("game_results").delete().eq("game_id", id);
    await ctx.admin.from("game_delegates").delete().eq("game_id", id);
    await ctx.admin.from("games").delete().eq("id", id);
  }
  // Restore the organizer role in case a live-derivation test left it demoted.
  await ctx.admin
    .from("trip_members")
    .update({ role: "Organizer" })
    .eq("trip_id", tripId)
    .eq("user_id", plannerId);
  await ctx.cleanup();
});

describe("Organizer = owner-minus-destructive (both phases)", () => {
  it("a trip organizer edits + posts — competition metadata + game scoring", async () => {
    const organizer = ctx.callerAs("planner");

    // PRE-LIVE (competition still "upcoming"): configure a game (requireGameEdit).
    const g1 = await newManualGame("Pre-live game");
    await expect(
      organizer.games.setStatus({ tripId, gameId: g1, status: "active" })
    ).resolves.toBeTruthy();

    // Post a result (requireGameRunAction — Organizer, not just owner/delegate).
    await expect(
      organizer.games.finish({
        tripId,
        gameId: g1,
        placements: [
          { entityId: teamA, position: 1 },
          { entityId: teamB, position: 2 },
        ],
      })
    ).resolves.toBeTruthy();

    // Edit competition metadata (competitions.update — Organizer allowed).
    // (Was a go-live status flip; GO LIVE was removed, so this exercises the
    // same Organizer update gate via name.)
    await expect(
      organizer.competitions.update({ tripId, competitionId, name: "Renamed Cup" })
    ).resolves.toBeTruthy();

    // Edit authority is phase-independent — still edits after metadata changes.
    const g2 = await newManualGame("Second game");
    await expect(
      organizer.games.setStatus({ tripId, gameId: g2, status: "active" })
    ).resolves.toBeTruthy();
  });

  it("Organizer can edit teams but CANNOT delete the competition (destructive = owner only)", async () => {
    const organizer = ctx.callerAs("planner");

    // Edit teams — Organizer work. In a POINTS cup: the Organizer Cup is head to
    // head (the default), which is exactly two teams and refuses a third or the
    // loss of one (ruling 2, PR 4). This case is about WHO may edit teams, not
    // how many a cup holds, and Organizer derives from the trip role, so it
    // holds on any cup whose trip makes the planner an Organizer. A trip holds
    // one competition (migration 195), so the points cup gets its own trip with
    // the planner as Organizer there too.
    const { tripId: pointsTripId, competitionId: pointsCup } = await ctx.createCupTrip({
      name: "Organizer Points Cup", scoringModel: "points", members: [["planner", "Organizer"]],
    });
    const t = await organizer.teams.create({
      tripId: pointsTripId,
      competitionId: pointsCup,
      name: "Green",
      shortName: "GRN",
      color: "#22c55e",
      colorDim: "#0a2a0f",
    });
    expect(t).toBeTruthy();
    // Delete team (end-to-end: organizer gate + migration 054 RLS).
    await expect(
      organizer.teams.delete({ tripId: pointsTripId, teamId: (t as { id: string }).id })
    ).resolves.toBeTruthy();
    const teams = await organizer.teams.list({ tripId: pointsTripId, competitionId: pointsCup });
    expect((teams as { name: string }[]).some((x) => x.name === "Green")).toBe(false);

    // Destructive: delete the competition — owner only.
    await expect(
      organizer.competitions.delete({ tripId, competitionId })
    ).rejects.toThrow(/owner/i);
  });
});

describe("members have no Organizer access (either phase)", () => {
  it("a plain trip member cannot edit or post", async () => {
    const member = ctx.callerAs("member");
    const g = await newManualGame("Member-blocked game");
    await expect(
      member.games.setStatus({ tripId, gameId: g, status: "active" })
    ).rejects.toThrow(/organizer|owner/i);
    await expect(
      member.games.finish({
        tripId,
        gameId: g,
        placements: [{ entityId: teamA, position: 1 }],
      })
    ).rejects.toThrow(/organizer|owner|delegate/i);
    await expect(
      member.competitions.update({ tripId, competitionId, name: "Nope" })
    ).rejects.toThrow(/organizer|owner/i);
  });
});

describe("Organizer is LIVE-derived, never snapshotted", () => {
  it("demoting the organizer pulls Organizer access on the next check (no competition re-save)", async () => {
    const g = await newManualGame("Live-derivation game");

    // trip Organizer → competition organizer → can edit.
    await expect(
      ctx.callerAs("planner").games.setStatus({ tripId, gameId: g, status: "active" })
    ).resolves.toBeTruthy();

    // Demote to Member at the container layer — NOTHING re-saves the competition.
    await ctx.admin
      .from("trip_members")
      .update({ role: "Member" })
      .eq("trip_id", tripId)
      .eq("user_id", plannerId);

    // Next check (fresh caller / fresh role cache): access is gone immediately.
    await expect(
      ctx.callerAs("planner").games.setStatus({ tripId, gameId: g, status: "pending" })
    ).rejects.toThrow(/organizer|owner/i);

    // Re-promote → Organizer returns, again with no competition re-save.
    await ctx.admin
      .from("trip_members")
      .update({ role: "Organizer" })
      .eq("trip_id", tripId)
      .eq("user_id", plannerId);
    await expect(
      ctx.callerAs("planner").games.setStatus({ tripId, gameId: g, status: "active" })
    ).resolves.toBeTruthy();
  });
});
