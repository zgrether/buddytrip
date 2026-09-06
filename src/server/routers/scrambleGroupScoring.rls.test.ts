import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";

/**
 * MIGRATION 181 — a play_group may hold a score when the group IS the unit.
 *
 * Scramble is stroke play where the team is the scorer. `score_entries` has
 * accepted `participant_type = 'play_group'` since the 033 spine, with no FK on
 * `participant_id` — so the ROW was always legal. What refused it was the WRITE:
 * `can_score_unit`'s play_group branch resolved entirely through `game_matches`,
 * which a stroke-shaped game does not have, so the EXISTS could never be true.
 *
 * ── Why this file exists at PostgREST level and not through tRPC ────────────
 *
 * Same reason as `rlsAuditFindings.rls.test.ts`: a test that goes through the
 * callers cannot see a policy wider — or narrower — than its callers. This
 * change WIDENS a policy, which is the direction that needs the most care, so
 * every case runs `authedClient` against a real JWT.
 *
 * ── Each case moves exactly one variable ───────────────────────────────────
 *
 * A guard that admits everything is not a guard, so the three cases below share
 * a fixture and differ in one thing each:
 *
 *   1. member IS in the group, game IS scramble        → ADMITTED
 *   2. member is in a DIFFERENT group of the same game → REFUSED  (membership)
 *   3. same member, same group, game is STROKE PLAY    → REFUSED  (game type)
 *
 * The third is the one worth having. The obvious form of this migration was an
 * unconditional `OR the caller is a member of the target group`, which reads
 * harmless and would pass cases 1 and 2 identically — case 3 is the only thing
 * that separates it from the type-gated version actually shipped. That is
 * migration 090's lesson applied rather than restated: 072 inferred "rack" from
 * a structural fact that was true when written, 089 made it false, and a stroke
 * cart-mate could score somebody else's row.
 *
 * Owner / Organizer / delegate are deliberately NOT exercised: the
 * `score_entries_write` policy (136) admits them ahead of `can_score_unit`, so
 * they would pass whatever this function said and prove nothing about it.
 */

let ctx: TestContext;
let tripId: string;
let competitionId: string;

/** The two teams' groups on the scramble game, and the same shape on a stroke game. */
let scrambleGameId: string;
let strokeGameId: string;
let myGroupId: string;
let otherGroupId: string;
let strokeGroupId: string;

async function makeGame(gameTypeId: string, name: string): Promise<string> {
  const id = genId("game");
  await ctx.admin.from("games").insert({
    id,
    trip_id: tripId,
    competition_id: competitionId,
    game_type_id: gameTypeId,
    name,
    status: "active",
    scoring_enabled: true,
    pairings_published_at: new Date().toISOString(),
  });
  await ctx.admin.from("game_participants").insert({
    id: genId("gp"),
    game_id: id,
    user_id: ctx.getUser("member").id,
  });
  return id;
}

describe("181 — a scramble group's score is writable by its members", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
    // Sequential, never Promise.all — these race and flake (CLAUDE.md).
    tripId = await ctx.createTrip("Scramble RLS Trip");
    await ctx.addTripMember(tripId, "member", "Member");
    competitionId = await ctx.createCompetition(tripId, "Scramble Cup");

    scrambleGameId = await makeGame("gtt_scramble", "Scramble");
    // The member's own team group. `groupStrokeParticipants` creates the group
    // AND points their `game_participants.play_group_id` at it, which is the
    // link the new branch reads.
    myGroupId = await ctx.groupStrokeParticipants(scrambleGameId, [ctx.getUser("member").id]);
    // A SECOND team's group on the same game, which the member is not in. No
    // participants assigned — the point is only that the id exists and is not
    // theirs.
    otherGroupId = genId("grp");
    await ctx.admin.from("play_groups").insert({
      id: otherGroupId, game_id: scrambleGameId, display_name: "Team B", tee_time: null,
    });

    // The CONTROL: the identical fixture on a stroke game, where the individual
    // is the unit and a group score is not a thing.
    strokeGameId = await makeGame("gtt_stroke_play", "Stroke Control");
    strokeGroupId = await ctx.groupStrokeParticipants(strokeGameId, [ctx.getUser("member").id]);
  }, 60_000);

  afterAll(async () => {
    await ctx.admin.from("play_groups").delete().eq("id", otherGroupId);
    await ctx.cleanup();
  }, 60_000);

  it("a member of the group WRITES the group's score", async () => {
    const { error } = await ctx.authedClient("member").from("score_entries").insert({
      id: genId("se"),
      game_id: scrambleGameId,
      participant_id: myGroupId,
      participant_type: "play_group",
      unit_label: "1",
      value: 4,
      submitted_by: ctx.getUser("member").id,
    });
    // The capability the migration exists for. Before 181 this was refused —
    // the play_group branch resolved through `game_matches`, and a scramble
    // game has none.
    expect(error).toBeNull();
  });

  it("but NOT another team's group in the same game", async () => {
    const { error } = await ctx.authedClient("member").from("score_entries").insert({
      id: genId("se"),
      game_id: scrambleGameId,
      participant_id: otherGroupId,
      participant_type: "play_group",
      unit_label: "1",
      value: 3,
      submitted_by: ctx.getUser("member").id,
    });
    // Membership of the TARGET group is what admits the write, not membership of
    // the game. Without this the branch would let anyone in the field write any
    // team's card.
    expect(error).not.toBeNull();
  });

  it("THE TYPE GATE DOES WORK — the same group score is refused on a stroke game", async () => {
    /**
     * The case that separates the shipped migration from the obvious one.
     *
     * Everything here is identical to the admitted case except `game_type_id`:
     * the member is in the group, the group belongs to the game, the game is
     * live and scoring-enabled. An unconditional "member of the target group"
     * rule passes this, and it should not — stroke's unit is the individual,
     * and a group-shaped score on it is exactly the leak 090 closed for rack.
     */
    const { error } = await ctx.authedClient("member").from("score_entries").insert({
      id: genId("se"),
      game_id: strokeGameId,
      participant_id: strokeGroupId,
      participant_type: "play_group",
      unit_label: "1",
      value: 4,
      submitted_by: ctx.getUser("member").id,
    });
    expect(error).not.toBeNull();
  });

  it("THE ADMISSION DEPENDS ON THE GATE — flip this game's type and the same write is refused", async () => {
    /**
     * The mutation check, run as a test rather than by hand, and deliberately
     * done by moving ONE COLUMN ON MY OWN ROW rather than by reverting
     * `can_score_unit` in the database.
     *
     * The usual way to prove a migration did something is to put the old
     * function back, watch the test go red, and restore it. This stack is
     * shared with another session, and `can_score_unit` gates every
     * `score_entries` write in it — so that proof would briefly break somebody
     * else's suite to make a point about mine. Flipping `game_type_id` on a
     * game this file created reaches exactly the same conclusion and touches
     * nothing outside the fixture.
     *
     * Same caller, same group, same membership, same policy, same row — only
     * the type moves, and the answer inverts. That is the gate doing the work,
     * and it is what makes the admitted case above evidence for 181 rather than
     * for the write being permitted all along.
     */
    const insert = (unit: string) =>
      ctx.authedClient("member").from("score_entries").insert({
        id: genId("se"),
        game_id: scrambleGameId,
        participant_id: myGroupId,
        participant_type: "play_group",
        unit_label: unit,
        value: 5,
        submitted_by: ctx.getUser("member").id,
      });

    await ctx.admin.from("games").update({ game_type_id: "gtt_stroke_play" }).eq("id", scrambleGameId);
    const refused = await insert("7");
    // Restore BEFORE asserting, so a failure here cannot leave the fixture in
    // the flipped state for the assertions that follow it in file order.
    await ctx.admin.from("games").update({ game_type_id: "gtt_scramble" }).eq("id", scrambleGameId);
    const admitted = await insert("8");

    expect(refused.error, "a group score was admitted on a non-scramble game").not.toBeNull();
    expect(admitted.error, "the same write failed once the type was restored").toBeNull();
  });

  it("the fixture is real — the two games differ only in type", async () => {
    // Without this the file could pass against a broken fixture: if the stroke
    // control were missing its group or its participant, case 3 would refuse for
    // the wrong reason and read as a working gate. "Absence of matches is
    // absence of search."
    const { data } = await ctx.admin
      .from("game_participants")
      .select("game_id, play_group_id")
      .eq("user_id", ctx.getUser("member").id)
      .in("game_id", [scrambleGameId, strokeGameId]);
    const byGame = new Map((data ?? []).map((r) => [r.game_id as string, r.play_group_id as string]));
    expect(byGame.get(scrambleGameId), "member not grouped on the scramble game").toBe(myGroupId);
    expect(byGame.get(strokeGameId), "member not grouped on the stroke control").toBe(strokeGroupId);
  });
});
