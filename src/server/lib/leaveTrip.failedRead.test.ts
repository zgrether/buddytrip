import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";
import { callerFailingRead } from "../../__tests__/helpers/failingRead";

/**
 * #1507 — removing a member must not act on a FAILED read of the trip's matches.
 *
 * `vacateTripGameSeats` reads the matches, vacates any seat the person holds,
 * then deletes their `game_participants` rows. Seats first is load-bearing (the
 * participant row is what makes someone part of a doubles side). It read with
 * `data ?? []`, so a failed matches read came back as "no matches": no seat was
 * vacated, and the participant rows were deleted anyway, leaving a seat that
 * points at someone who is no longer in the game.
 *
 * It is best-effort, deliberately: the removal the owner watched succeed must not
 * fail because the tidy-up did. So on a failed read the removal STANDS and the
 * tidy-up writes NOTHING, which leaves the state we started in.
 *
 * Driven through the real `tripMembers.remove`, with a client that fails exactly
 * the vacate's own select (table AND column string), so every other read and all
 * writes reach the database. The control proves the same fixture CAN vacate and
 * delete, so "nothing was written" in the failing case is a result, not a fixture
 * that could not write.
 */

const MATCH_PLAY = "gtt_match_play";
const VACATE_MATCHES_READ = { table: "game_matches", columns: "id, game_id, side_a, side_b" };

let ctx: TestContext;

beforeAll(async () => {
  ctx = await TestContext.create();
});

afterAll(async () => {
  await ctx.cleanup();
});

/** A trip where `member` sits in match 1 of an unplayed match-play game. */
async function seatedMember() {
  const owner = ctx.user.id;
  const member = ctx.getUser("member").id;
  const { tripId, competitionId } = await ctx.createCupTrip({
    title: "vacate failed-read trip", name: "Vacate Cup", members: ["member"],
  });
  const blue = await ctx.createTeam(competitionId, "Blue");
  const red = await ctx.createTeam(competitionId, "Red");
  await ctx.admin.from("team_assignments").insert([
    { competition_id: competitionId, user_id: owner, team_id: blue },
    { competition_id: competitionId, user_id: member, team_id: red },
  ]);
  const game = (await ctx.caller().games.create({
    tripId, gameTypeId: MATCH_PLAY, name: "Seats", competitionId,
    pointsDistribution: { type: "per_match", value: 1 },
  })) as { id: string };
  const matches = (await ctx.caller().matches.setPairings({
    tripId, gameId: game.id,
    matches: [{ playersPerSide: 1, sideA: { members: [owner] }, sideB: { members: [member] }, matchNumber: 1 }],
  })) as { id: string }[];
  return { tripId, gameId: game.id, matchId: matches[0].id, member };
}

async function stateOf(gameId: string, matchId: string, member: string) {
  const { data: m, error: mErr } = await ctx.admin.from("game_matches").select("side_b").eq("id", matchId).single();
  if (mErr) throw new Error(mErr.message);
  const { count, error: pErr } = await ctx.admin
    .from("game_participants")
    .select("user_id", { count: "exact", head: true })
    .eq("game_id", gameId)
    .eq("user_id", member);
  if (pErr) throw new Error(pErr.message);
  return { seatB: (m!.side_b as { id?: string } | null)?.id ?? null, participantRows: count ?? -1 };
}

describe("vacateTripGameSeats — a failed read writes nothing (#1507)", () => {
  it("CONTROL: a normal removal vacates the seat and deletes the participant row", async () => {
    const s = await seatedMember();
    expect(await stateOf(s.gameId, s.matchId, s.member)).toEqual({ seatB: s.member, participantRows: 1 });

    await ctx.caller().tripMembers.remove({ tripId: s.tripId, userId: s.member });

    expect(await stateOf(s.gameId, s.matchId, s.member)).toEqual({ seatB: null, participantRows: 0 });
  }, 60000);

  it("a failed matches read: the removal stands, and neither the seat nor the participant row is touched", async () => {
    const s = await seatedMember();

    const failing = callerFailingRead(ctx, "owner", VACATE_MATCHES_READ);
    await failing.tripMembers.remove({ tripId: s.tripId, userId: s.member });

    // The removal itself went through (best-effort tidy-up, not a failed removal)…
    const { count: stillMember } = await ctx.admin
      .from("trip_members")
      .select("user_id", { count: "exact", head: true })
      .eq("trip_id", s.tripId)
      .eq("user_id", s.member);
    expect(stillMember).toBe(0);

    // …and the tidy-up wrote NOTHING. Before the fix: seat still theirs, but the
    // participant row deleted (participantRows 0), the order broken by a 502.
    expect(await stateOf(s.gameId, s.matchId, s.member)).toEqual({ seatB: s.member, participantRows: 1 });
  }, 60000);
});
