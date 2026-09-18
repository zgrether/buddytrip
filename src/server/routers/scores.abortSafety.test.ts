import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";
import { isTerminalRefusal } from "../../lib/terminalRefusal";

/**
 * THE SCORE-WRITE CARVE-OUT, AS A PROPERTY (#1258).
 *
 * Lever A aborts a Supabase call after 8 seconds. Every other path turns that
 * into a visible error; the score path is carved out on the claim that the
 * durable outbox plus an idempotent upsert make an aborted write recoverable.
 *
 * That claim was an INFERENCE — "outbox plus upsert, so it's safe". This file
 * makes it a property with a test, because the dangerous case is not the one
 * the inference describes: it is the abort that lands AFTER the server has
 * already committed, where the client believes the write failed and re-sends.
 *
 *   An aborted score write cannot lose or duplicate a score.
 *
 * Two halves live here (they need a real database): idempotence under retry,
 * and commit-then-abort. The third — that the client keeps the value and the
 * outbox entry — is `useScoreSaver.abortSafety.guard.test.ts`.
 *
 * ── WHAT THE MUTATION CAMPAIGN FOUND, and it corrected this file ───────────
 *
 * The carve-out was written up as resting on the upsert's `onConflict` target.
 * Removing that target fails NOTHING here — and the honest reading is not "weak
 * test" but "wrong mutation". Idempotence has TWO independent mechanisms:
 *
 *   1. `onConflict: "game_id,participant_id,unit_label"` — resolves the write
 *      against the composite unique index.
 *   2. a DETERMINISTIC row id (`gameId:participantId:unitLabel`) — so even with
 *      no conflict target the upsert matches the same row by primary key.
 *
 * Either alone keeps a retry to one row: removing only the target still updates
 * in place (by id), and removing only the deterministic id still updates in
 * place (by the target) while CHANGING the row's id, which case 2 catches.
 * Remove BOTH and the second write raises
 * `duplicate key value violates unique constraint
 * score_entries_game_id_participant_id_unit_label_key`, failing both cases.
 *
 * The redundancy is real and worth knowing: the score path survives losing
 * either one, and the unique index is the floor under both.
 */

let ctx: TestContext;
let tripId: string;
let gameId: string;
let participantId: string;

const UNIT = "7";

async function rowsFor(unitLabel: string) {
  const { data, error } = await ctx.admin
    .from("score_entries")
    .select("id, value, submitted_by")
    .eq("game_id", gameId)
    .eq("participant_id", participantId)
    .eq("unit_label", unitLabel);
  expect(error).toBeNull();
  return data ?? [];
}

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("abort safety Trip");
  await ctx.addTripMember(tripId, "member");
  participantId = ctx.user.id;
  const g = (await ctx.caller().games.create({ tripId, gameTypeId: "gtt_stroke_play", name: "Abort safety" })) as { id: string };
  gameId = g.id;
  // A game needs a field, not a soloist — the roster write takes two.
  await ctx.caller().games.addParticipants({ tripId, gameId, userIds: [participantId, ctx.getUser("member").id] });
  await ctx.admin.from("games").update({ scoring_enabled: true, status: "active" }).eq("id", gameId);
});

afterAll(async () => {
  await ctx.admin.from("score_entries").delete().eq("game_id", gameId);
  await ctx.admin.from("games").delete().eq("id", gameId);
  await ctx.cleanup();
});

describe("an aborted score write cannot lose or duplicate a score", () => {
  it("1 · IDEMPOTENCE UNDER RETRY: the same cell written twice leaves ONE row, holding the second value", async () => {
    // What the retry does after a transient failure. The conflict target
    // (game_id, participant_id, unit_label) is what makes it an update in place
    // rather than a second row.
    await ctx.caller().scores.upsertEntry({ tripId, gameId, participantId, unitLabel: UNIT, value: 4 });
    await ctx.caller().scores.upsertEntry({ tripId, gameId, participantId, unitLabel: UNIT, value: 5 });

    const rows = await rowsFor(UNIT);
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe(5);
  });

  it("2 · COMMIT-THEN-ABORT: a write the server committed, re-sent because the client saw no response, still leaves ONE row", async () => {
    // THE CASE THE ABORT INTRODUCES. An 8s abort fires on the CLIENT side of the
    // Supabase call; the statement may already have committed. The score saver
    // cannot tell those apart, so it keeps the outbox entry and re-sends on the
    // next mount. This is that re-send, against a row that is already there.
    const unit = "8";
    await ctx.caller().scores.upsertEntry({ tripId, gameId, participantId, unitLabel: unit, value: 3 });
    const committed = await rowsFor(unit);
    expect(committed, "premise: the first write landed").toHaveLength(1);

    // The retry carries the SAME value the outbox held — not a newer one.
    await ctx.caller().scores.upsertEntry({ tripId, gameId, participantId, unitLabel: unit, value: 3 });

    const rows = await rowsFor(unit);
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe(3);
    // And the row keeps its identity: the upsert updates in place rather than
    // deleting and re-inserting, so nothing downstream sees the score vanish.
    expect(rows[0].id).toBe(committed[0].id);
  });

  it("3 · an abort is NOT a terminal refusal, so the retry path stays open", async () => {
    // The carve-out depends on this classification. An aborted Supabase call
    // surfaces from the procedure as INTERNAL_SERVER_ERROR ("Failed to save
    // score: …"), which must read as transient — a terminal code would make the
    // client DROP the outbox entry, which is exactly how an abort would lose a
    // score.
    const aborted = { data: { code: "INTERNAL_SERVER_ERROR" }, message: "Failed to save score: The operation was aborted" };
    expect(isTerminalRefusal(aborted)).toBe(false);
    // The contrast, so this is not vacuous: a real refusal IS terminal.
    expect(isTerminalRefusal({ data: { code: "FORBIDDEN" }, message: "Scoring is closed" })).toBe(true);
  });
});
