import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

/**
 * Competition co-admin role — the container grants it, the gate honors it.
 *
 * A trip ORGANIZER is granted competition co-admin (owner-minus-destructive) by
 * the container mapping (resolveCompetitionRole), LIVE-derived from current trip
 * membership. We assert the matrix in BOTH phases and — the critical one —
 * that demoting the organizer pulls co-admin access on the next check, with no
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
  tripId = await ctx.createTrip("Co-admin trip");
  await ctx.addTripMember(tripId, "planner", "Organizer"); // → competition co-admin
  await ctx.addTripMember(tripId, "member", "Member");
  plannerId = ctx.getUser("planner").id;
  competitionId = await ctx.createCompetition(tripId, "Co-admin Cup");
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

describe("co-admin = owner-minus-destructive (both phases)", () => {
  it("a trip organizer edits + posts — competition metadata + game scoring", async () => {
    const coadmin = ctx.callerAs("planner");

    // PRE-LIVE (competition still "upcoming"): configure a game (requireGameEdit).
    const g1 = await newManualGame("Pre-live game");
    await expect(
      coadmin.games.setStatus({ tripId, gameId: g1, status: "active" })
    ).resolves.toBeTruthy();

    // Post a result (requireGameRunAction — co-admin, not just owner/delegate).
    await expect(
      coadmin.games.post({
        tripId,
        gameId: g1,
        placements: [
          { entityId: teamA, position: 1 },
          { entityId: teamB, position: 2 },
        ],
      })
    ).resolves.toBeTruthy();

    // Edit competition metadata (competitions.update — co-admin allowed).
    // (Was a go-live status flip; GO LIVE was removed, so this exercises the
    // same co-admin update gate via name.)
    await expect(
      coadmin.competitions.update({ tripId, competitionId, name: "Renamed Cup" })
    ).resolves.toBeTruthy();

    // Edit authority is phase-independent — still edits after metadata changes.
    const g2 = await newManualGame("Second game");
    await expect(
      coadmin.games.setStatus({ tripId, gameId: g2, status: "active" })
    ).resolves.toBeTruthy();
  });

  it("co-admin can edit teams but CANNOT delete the competition (destructive = owner only)", async () => {
    const coadmin = ctx.callerAs("planner");

    // Edit teams — co-admin work.
    const t = await coadmin.teams.create({
      tripId,
      competitionId,
      name: "Green",
      shortName: "GRN",
      color: "#22c55e",
      colorDim: "#0a2a0f",
    });
    expect(t).toBeTruthy();
    // Delete team (end-to-end: co_admin gate + migration 054 RLS).
    await expect(
      coadmin.teams.delete({ tripId, teamId: (t as { id: string }).id })
    ).resolves.toBeTruthy();
    const teams = await coadmin.teams.list({ tripId, competitionId });
    expect((teams as { name: string }[]).some((x) => x.name === "Green")).toBe(false);

    // Destructive: delete the competition — owner only.
    await expect(
      coadmin.competitions.delete({ tripId, competitionId })
    ).rejects.toThrow(/owner/i);
  });
});

describe("members have no co-admin access (either phase)", () => {
  it("a plain trip member cannot edit or post", async () => {
    const member = ctx.callerAs("member");
    const g = await newManualGame("Member-blocked game");
    await expect(
      member.games.setStatus({ tripId, gameId: g, status: "active" })
    ).rejects.toThrow(/co-admin|organizer|owner/i);
    await expect(
      member.games.post({
        tripId,
        gameId: g,
        placements: [{ entityId: teamA, position: 1 }],
      })
    ).rejects.toThrow(/co-admin|organizer|owner|delegate/i);
    await expect(
      member.competitions.update({ tripId, competitionId, name: "Nope" })
    ).rejects.toThrow(/co-admin|organizer|owner/i);
  });
});

describe("co-admin is LIVE-derived, never snapshotted", () => {
  it("demoting the organizer pulls co-admin access on the next check (no competition re-save)", async () => {
    const g = await newManualGame("Live-derivation game");

    // Organizer → co-admin → can edit.
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
    ).rejects.toThrow(/co-admin|organizer|owner/i);

    // Re-promote → co-admin returns, again with no competition re-save.
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
