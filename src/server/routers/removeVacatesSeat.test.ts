import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";
import { findContributionBlockers } from "../lib/participationGuard";

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
 * The second half of this file is the guard itself, which turned out to be blind
 * in two directions Phase 0 found and prod could reach today:
 *
 *   - `match_hole_outcomes` — the score in `entry_mode='outcome'`, and a table
 *     the guard never read. An outcome game carries ZERO `score_entries` rows,
 *     so "has anyone played this?" answered no for a match seventeen holes in.
 *   - `play_group` sides — a 2v2 side is a minted group, and both the side ref
 *     and the `game_results` row are keyed to the GROUP. Comparing those to a
 *     user id answers no for every doubles match ever played.
 *
 * Those are asserted against `findContributionBlockers` directly rather than
 * through the refusal message, because the message says the same words for five
 * different reasons and the REASON is the thing being fixed.
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

describe("the guard sees the score in both of its storage shapes", () => {
  it("SEES recorded hole outcomes, which are not score_entries (the remove panel's warning)", async () => {
    // `entry_mode='outcome'` stores the score in `match_hole_outcomes`, and
    // `matchOutcomes.upsertOutcome` deliberately runs no recompute — so until
    // `games.finish` there is no `game_results` row and no decided match either.
    // Every column the guard used to read is empty for a game genuinely underway.
    const cup = await vacateCup("outcome-underway");
    const { tripId } = cup;
    const { gameId, m1 } = await pairedGame(cup, "Outcome Mode Underway");
    await ctx.caller().games.update({ tripId, gameId, entryMode: "outcome" });
    await ctx.caller().matches.enableScoring({ tripId, gameId });
    await ctx.caller().matchOutcomes.upsertOutcome({
      tripId, gameId, matchId: m1, holeNumber: 1, result: "side_b",
    });

    // The premise: this game really does have no score_entries. Without it the
    // block below could be coming from the old signal and prove nothing.
    const { count, error } = await ctx.admin
      .from("score_entries").select("id", { count: "exact", head: true }).eq("game_id", gameId);
    if (error) throw new Error(`count score_entries: ${error.message}`);
    expect(count).toBe(0);

    const blockers = await findContributionBlockers(ctx.admin, tripId, member);
    const game = blockers.games.find((g) => g.gameId === gameId);
    expect(game?.reasons).toContain("played-game");
    // Since PR 8d the predicate drives a warning, not a refusal: removal goes
    // through (what it does to the seat is the case at the top of this file).
    await expect(ctx.caller().tripMembers.remove({ tripId, userId: member })).resolves.toMatchObject({ success: true });
  }, 120_000);

  it("does NOT block a game nobody has played (a plan stays removable)", async () => {
    // The control the test above needs: same shape, no outcome recorded. If this
    // one blocked too, "blocks on outcomes" would be indistinguishable from
    // "blocks on being in a match at all".
    const cup = await vacateCup("outcome-untouched");
    const { tripId } = cup;
    const { gameId } = await pairedGame(cup, "Outcome Mode Untouched");
    await ctx.caller().games.update({ tripId, gameId, entryMode: "outcome" });
    await ctx.caller().matches.enableScoring({ tripId, gameId });

    const blockers = await findContributionBlockers(ctx.admin, tripId, member);
    expect(blockers.games.find((g) => g.gameId === gameId)).toBeUndefined();
  }, 120_000);
});

describe("the guard resolves a doubles side to the people in it", () => {
  // These cases only READ one finished game, so they share it — on a cup of
  // their own, so the result it records cannot reach any other describe.
  let tripId: string;
  let gameId: string;

  beforeAll(async () => {
    // One 2v2 match, played to a finish in outcome mode. `games.finish` runs
    // `computeMatchPlayResults`, which writes `game_matches.status='complete'`
    // and a `game_results` row per side — both keyed to the minted play_group,
    // never to a person.
    const cup = await vacateCup("doubles");
    tripId = cup.tripId;
    const game = (await ctx.caller().games.create({
      tripId, gameTypeId: MATCH_PLAY, name: "Doubles Decided", competitionId: cup.competitionId, pointsTotal: 10,
    })) as { id: string };
    gameId = game.id;
    const matches = (await ctx.caller().matches.setPairings({
      tripId,
      gameId,
      matches: [{
        playersPerSide: 2,
        sideA: { members: [owner, planner] },
        sideB: { members: [member, outsider] },
        matchNumber: 1,
      }],
    })) as MatchRow[];
    await ctx.caller().games.update({ tripId, gameId, entryMode: "outcome" });
    await ctx.caller().matches.enableScoring({ tripId, gameId });
    for (let hole = 1; hole <= 18; hole++) {
      await ctx.caller().matchOutcomes.upsertOutcome({
        tripId, gameId, matchId: matches[0].id, holeNumber: hole, result: "side_a",
      });
    }
    await ctx.caller().games.finish({ tripId, gameId });
  }, 180_000);

  it("keys the decided match and its results to the GROUP, not to a user", async () => {
    // The premise this whole describe rests on. Asserted rather than assumed,
    // because if a side or a result were user-keyed the tests below would pass
    // through the OLD comparison and say nothing about the new one.
    const { data: results, error } = await ctx.admin
      .from("game_results").select("entity_type, entity_id").eq("game_id", gameId);
    if (error) throw new Error(`read results: ${error.message}`);
    const rows = (results ?? []) as { entity_type: string; entity_id: string }[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.map((r) => r.entity_id)).not.toContain(member);

    const sides = Object.values(await seats(gameId)).flatMap((m) => [m.side_a, m.side_b]);
    expect(sides.every((s) => s?.type === "play_group")).toBe(true);
    expect(sides.map((s) => s?.id)).not.toContain(member);
  }, 60_000);

  it("BLOCKS a member of the winning side on both the result and the decided match", async () => {
    const blockers = await findContributionBlockers(ctx.admin, tripId, planner);
    const game = blockers.games.find((g) => g.gameId === gameId);
    expect(game?.reasons).toContain("result");
    expect(game?.reasons).toContain("decided-match");
  }, 60_000);

  it("BLOCKS a member of the losing side too — a result is not only the winner's", async () => {
    const blockers = await findContributionBlockers(ctx.admin, tripId, member);
    const game = blockers.games.find((g) => g.gameId === gameId);
    expect(game?.reasons).toContain("result");
    expect(game?.reasons).toContain("decided-match");
  }, 60_000);

  it("does NOT block someone on the trip who is in no side of it", async () => {
    // The control: a guest on the same trip, in no game. Without this, "the
    // group resolves to its members" is indistinguishable from "everything
    // blocks once any match is decided".
    const guest = (await ctx.caller().ghostCrew.create({ tripId, name: "Doubles Bystander" })) as { id: string };
    const blockers = await findContributionBlockers(ctx.admin, tripId, guest.id);
    expect(blockers.games.find((g) => g.gameId === gameId)).toBeUndefined();
    await ctx.caller().ghostCrew.remove({ tripId, guestUserId: guest.id });
  }, 60_000);
});
