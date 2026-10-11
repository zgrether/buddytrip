import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

/**
 * #1016 — removing someone vacates their match seat instead of leaving a "Player".
 *
 * The reported sequence, in three steps, every one of which behaved correctly on
 * its own:
 *
 *   1. a crew member is in a match with scores  → #996's guard refuses the removal
 *   2. clear the scores                         → the guard finds nothing
 *   3. remove them                              → succeeds, and the seat renders "Player"
 *
 * Nothing was broken at any step. The gap is AFTER the guard: `game_matches`
 * side refs live in JSONB, which no FK can see and no cascade can reach, so the
 * removal left the match pointing at somebody who no longer existed.
 *
 * This file once had a second half testing the removal guard itself
 * (`findContributionBlockers`), which turned out to be blind to outcome-mode
 * hole results and to doubles sides keyed to a `play_group` (CLAUDE.md #27).
 * PR 8d-3 retired that guard — the archive decides what is history, once, in
 * the database — so only the seat half remains.
 */

const MATCH_PLAY = "gtt_match_play";

type Side = { type: string; id: string } | null;
interface MatchRow {
  id: string;
  side_a: Side;
  side_b: Side;
}

let ctx: TestContext;
let owner: string, planner: string, member: string, outsider: string;

/**
 * EVERY CASE BUILDS ITS OWN TRIP AND CUP (#1527). The file used to share one
 * trip, removing `member` and putting them back case after case. Once a case
 * that RECORDS A RESULT had run — the outcome-mode game, the decided doubles
 * match — `member` had history on that trip, so every later removal was
 * refused: "Test Member can't be removed — has results in 2 games". A shuffled
 * run sent four vacate cases into that wall. The `restore` helpers that put a
 * removed person back are gone with it.
 */
type Cup = { tripId: string; competitionId: string };

/** A trip with all four people, and a cup with two rostered teams. */
async function vacateCup(label: string): Promise<Cup> {
  const tripId = await ctx.createTrip(`Vacate Seat ${label}`);
  // Sequential, never Promise.all — these race (CLAUDE.md, local-stack conventions).
  await ctx.addTripMember(tripId, "planner", "Organizer");
  await ctx.addTripMember(tripId, "member", "Member");
  await ctx.addTripMember(tripId, "outsider", "Member");
  const competitionId = await ctx.createCompetition(tripId, `Vacate Seat Cup ${label}`);
  // Two rostered teams. This used to assign nobody, so that removal had only the
  // seat to clear — but the cup defaults to match_play, and a Ryder cup refuses an
  // unrostered participant since migration 193: an unassigned pairing is a state
  // the app cannot produce. Every assertion here is about seats and results.
  const teamA = await ctx.createTeam(competitionId, "Vacate A", { shortName: "VA" });
  const teamB = await ctx.createTeam(competitionId, "Vacate B", { shortName: "VB" });
  await ctx.assignTeam(competitionId, teamA, [owner, planner]);
  await ctx.assignTeam(competitionId, teamB, [member, outsider]);
  return { tripId, competitionId };
}

/** Read the game's matches straight from the table — the seat, not a rendering of it. */
async function seats(gameId: string): Promise<Record<string, MatchRow>> {
  const { data, error } = await ctx.admin
    .from("game_matches")
    .select("id, side_a, side_b")
    .eq("game_id", gameId);
  if (error) throw new Error(`read seats: ${error.message}`);
  return Object.fromEntries(((data ?? []) as MatchRow[]).map((r) => [r.id, r]));
}

async function participantIds(gameId: string): Promise<string[]> {
  const { data, error } = await ctx.admin.from("game_participants").select("user_id").eq("game_id", gameId);
  if (error) throw new Error(`read participants: ${error.message}`);
  return ((data ?? []) as { user_id: string }[]).map((r) => r.user_id);
}

/** The board's own Setting-up↔Ready signal, read the way the Cup face reads it. */
async function boardConfigured(cup: Cup, gameId: string): Promise<boolean> {
  const lb = await ctx.caller().competitions.leaderboard({ tripId: cup.tripId, competitionId: cup.competitionId });
  const row = lb.games.find((g: { id: string }) => g.id === gameId) as { configured: boolean };
  return row.configured;
}

/** A singles game with two fully-paired matches, in the cup so the board can see it. */
async function pairedGame(cup: Cup, name: string): Promise<{ gameId: string; m1: string; m2: string }> {
  const { tripId, competitionId } = cup;
  const game = (await ctx.caller().games.create({
    tripId,
    gameTypeId: MATCH_PLAY,
    name,
    competitionId,
    pointsTotal: 10,
  })) as { id: string };
  const matches = (await ctx.caller().matches.setPairings({
    tripId,
    gameId: game.id,
    matches: [
      { playersPerSide: 1, sideA: { members: [owner] }, sideB: { members: [member] }, matchNumber: 1 },
      { playersPerSide: 1, sideA: { members: [planner] }, sideB: { members: [outsider] }, matchNumber: 2 },
    ],
  })) as MatchRow[];
  return { gameId: game.id, m1: matches[0].id, m2: matches[1].id };
}

beforeAll(async () => {
  ctx = await TestContext.create();
  owner = ctx.user.id;
  planner = ctx.getUser("planner").id;
  member = ctx.getUser("member").id;
  outsider = ctx.getUser("outsider").id;
}, 120_000);

afterAll(async () => {
  await ctx.cleanup();
}, 60_000);

describe("removing a crew member vacates their match seat", () => {
  it("a match still being PLAYED: the seat empties even with a score in it, and the score stays", async () => {
    // PR 8d (ruling 7): someone leaving mid-round really has left, so an
    // UNDECIDED match loses their seat even once it has scores. Until 8d this
    // refused ("can't be removed") until the scores were reset. The score row is
    // history and stays; only a DECIDED match keeps its seat (migration 207,
    // pinned in tripArchiveDecidedMatches.db.test.ts).
    const cup = await vacateCup("underway");
    const { tripId } = cup;
    const { gameId, m1, m2 } = await pairedGame(cup, "Removed Mid-Round");
    await ctx.caller().matches.enableScoring({ tripId, gameId });
    await ctx.caller().scores.upsertEntry({
      tripId, gameId, participantId: member, unitLabel: "1", value: 4,
    });

    await ctx.caller().tripMembers.remove({ tripId, userId: member });
    const { count: kept } = await ctx.admin.from("score_entries")
      .select("id", { count: "exact", head: true }).eq("game_id", gameId).eq("participant_id", member);
    expect(kept).toBe(1);

    const after = await seats(gameId);
    expect(after[m1].side_b).toBeNull();                 // the seat is empty, not a person
    expect(after[m1].side_a?.id).toBe(owner);            // the OTHER seat is untouched
    expect(after[m2].side_a?.id).toBe(planner);          // and so is the other match
    expect(after[m2].side_b?.id).toBe(outsider);
    expect(await participantIds(gameId)).not.toContain(member); // no dangling row
  }, 120_000);

  it("the game reads Setting-up again, without anything writing that state", async () => {
    // Readiness is DERIVED — `isConfigured` recomputes paired-vs-total on every
    // read — so this asserts the board's own flag rather than a stored column.
    // Deliberately checked TRUE first: a `configured: false` that was already
    // false before the removal would prove nothing.
    const cup = await vacateCup("setting-up");
    const { gameId } = await pairedGame(cup, "Back To Setting Up");
    expect(await boardConfigured(cup, gameId)).toBe(true);

    await ctx.caller().tripMembers.remove({ tripId: cup.tripId, userId: member });

    expect(await boardConfigured(cup, gameId)).toBe(false);
  }, 120_000);

  it("empties BOTH seats of a match when both of its people are removed", async () => {
    // Two vacated seats must read as an empty match, not as two "Player"s — so
    // this match is deliberately member-vs-outsider, the two people who can
    // actually be removed (the owner cannot remove themselves).
    const { tripId, competitionId } = await vacateCup("both-seats");
    const game = (await ctx.caller().games.create({
      tripId, gameTypeId: MATCH_PLAY, name: "Both Seats", competitionId, pointsTotal: 10,
    })) as { id: string };
    const matches = (await ctx.caller().matches.setPairings({
      tripId,
      gameId: game.id,
      matches: [
        { playersPerSide: 1, sideA: { members: [member] }, sideB: { members: [outsider] }, matchNumber: 1 },
        { playersPerSide: 1, sideA: { members: [owner] }, sideB: { members: [planner] }, matchNumber: 2 },
      ],
    })) as MatchRow[];
    const [m1, m2] = [matches[0].id, matches[1].id];

    await ctx.caller().tripMembers.remove({ tripId, userId: member });
    await ctx.caller().tripMembers.remove({ tripId, userId: outsider });

    const after = await seats(game.id);
    expect(after[m1].side_a).toBeNull();
    expect(after[m1].side_b).toBeNull();
    expect(after[m2].side_a?.id).toBe(owner);   // the untouched match, still both people
    expect(after[m2].side_b?.id).toBe(planner);
    expect((await participantIds(game.id)).sort()).toEqual([owner, planner].sort());
  }, 120_000);

  it("leaves every match alone when the person is in none of them", async () => {
    // The frictionless case, which must stay frictionless.
    const cup = await vacateCup("unseated");
    const { gameId, m1, m2 } = await pairedGame(cup, "Not In Any Match");
    const before = await seats(gameId);
    const guest = (await ctx.caller().ghostCrew.create({ tripId: cup.tripId, name: "Unseated Guest" })) as { id: string };

    await ctx.caller().ghostCrew.remove({ tripId: cup.tripId, guestUserId: guest.id });

    const after = await seats(gameId);
    expect(after[m1].side_a?.id).toBe(before[m1].side_a?.id);
    expect(after[m1].side_b?.id).toBe(before[m1].side_b?.id);
    expect(after[m2].side_a?.id).toBe(before[m2].side_a?.id);
    expect(after[m2].side_b?.id).toBe(before[m2].side_b?.id);
    expect((await participantIds(gameId)).sort()).toEqual([owner, member, planner, outsider].sort());
  }, 120_000);

  it("clears the surviving opponent's relative handicap", async () => {
    // A match-play handicap is set against the OTHER side — one side gets the
    // strokes, the other is zeroed. Left behind, it is a number relative to
    // nobody. `assignPlayer` already clears both when it vacates a match.
    const cup = await vacateCup("handicap");
    const { tripId } = cup;
    const { gameId, m1 } = await pairedGame(cup, "Relative Handicap");
    await ctx.caller().matches.setHandicap({
      tripId, gameId, matchId: m1, recipientId: member, strokes: 4,
    });

    await ctx.caller().tripMembers.remove({ tripId, userId: member });

    const { data, error } = await ctx.admin
      .from("game_participants")
      .select("user_id, handicap_strokes")
      .eq("game_id", gameId)
      .eq("user_id", owner)
      .single();
    if (error) throw new Error(`read owner's handicap: ${error.message}`);
    expect((data as { handicap_strokes: number | null }).handicap_strokes).toBeNull();
  }, 120_000);
});
