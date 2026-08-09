import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import { TestContext } from "../../__tests__/helpers/test-setup";
import { scoreEventsTopic, SCORE_EVENT } from "../../hooks/useRealtimeScoreEvents";

/**
 * Migration 096 — the score-event broadcast trigger, end to end.
 *
 * This subscribes with a REAL Supabase Realtime client rather than reading
 * `realtime.messages` directly (PostgREST does not expose the `realtime`
 * schema), which makes it a genuine end-to-end test of the whole chain:
 * trigger → realtime.send → Realtime server → browser client.
 *
 * That chain is worth testing as one piece because its most likely failure is a
 * SILENT MISMATCH, not an error: the topic string and event name live in two
 * places — the SQL trigger (096) and `useRealtimeScoreEvents.ts` — and if either
 * drifts, nothing throws anywhere. Scores keep saving, the board keeps
 * rendering, and live updates just quietly stop, degrading to the 5-minute
 * backstop. The constants are imported from the hook here on purpose, so this
 * test fails if the client and the database stop agreeing.
 *
 * The subscriber is ANONYMOUS on purpose — see the payload test.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

let ctx: TestContext;
let tripId: string;
let competitionId: string;
let compGameId: string;
let soloGameId: string;

let rt: SupabaseClient;
let channel: RealtimeChannel;
/**
 * Whether a Realtime websocket is actually reachable in this environment.
 *
 * On the GitHub runner the container starts but channel joins never complete,
 * so these tests SKIP there rather than failing a merge gate on infrastructure.
 * The emit/listen contract they exist to protect is enforced everywhere by
 * `useRealtimeScoreEvents.contract.test.ts`, which needs no infrastructure; this
 * file is the deeper runtime proof that runs locally.
 *
 * A skip is reported loudly on purpose — a silently-skipped test is worse than
 * no test, because it reads as coverage.
 */
let realtimeUp = false;
let lastStatus = "not attempted";

/** Skip with a visible reason when Realtime isn't available here. */
function requireRealtime(t: { skip: (note?: string) => void }): boolean {
  if (realtimeUp) return true;
  console.warn(
    `[broadcastScoreEvents] SKIPPED — no Realtime websocket in this environment (${lastStatus}). ` +
      `Static contract still enforced by useRealtimeScoreEvents.contract.test.ts.`,
  );
  t.skip();
  return false;
}
/** Every broadcast seen on the competition's topic, in arrival order. */
let received: Array<Record<string, unknown>> = [];

const rid = (p: string) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

/** Wait for `n` broadcasts to land, or give up. Realtime is a network hop, so
 *  this polls rather than assuming synchronous delivery. */
async function waitFor(n: number, ms = 8000): Promise<void> {
  const deadline = Date.now() + ms;
  while (received.length < n && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** Give any (unwanted) broadcast time to arrive before asserting it did NOT.
 *  Without this, a negative assertion would pass simply by racing the network. */
async function settle(ms = 2500): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("Broadcast trip");
  competitionId = await ctx.createCompetition(tripId, "Broadcast Cup");

  compGameId = rid("game-comp");
  soloGameId = rid("game-solo");
  const a = await ctx.admin.from("games").insert({
    id: compGameId,
    trip_id: tripId,
    competition_id: competitionId,
    game_type_id: "gtt_manual",
    name: "In competition",
  });
  if (a.error) throw new Error(`seed comp game: ${a.error.message}`);
  const b = await ctx.admin.from("games").insert({
    id: soloGameId,
    trip_id: tripId,
    competition_id: null,
    game_type_id: "gtt_manual",
    name: "Standalone",
  });
  if (b.error) throw new Error(`seed solo game: ${b.error.message}`);

  rt = createClient(SUPABASE_URL, ANON_KEY);

  // Opening the websocket is the one step that depends on infrastructure beyond
  // Postgres. Retry to a deadline (a contended local stack can miss the first
  // join), but do NOT fail the file if Realtime is simply unreachable — see
  // `realtimeUp` below.
  const deadline = Date.now() + 60_000;
  let attempt = 0;
  for (;;) {
    attempt += 1;
    channel = rt.channel(scoreEventsTopic(competitionId));
    channel.on("broadcast", { event: SCORE_EVENT }, (m) => {
      received.push((m?.payload ?? {}) as Record<string, unknown>);
    });

    const status = await new Promise<string>((resolve) => {
      const t = setTimeout(() => resolve("LOCAL_TIMEOUT"), 15_000);
      channel.subscribe((s) => {
        clearTimeout(t);
        resolve(s);
      });
    });
    if (status === "SUBSCRIBED") {
      realtimeUp = true;
      break;
    }

    await rt.removeChannel(channel);
    if (Date.now() > deadline) {
      lastStatus = `${status} after ${attempt} attempts`;
      break;
    }
  }
}, 120_000);

/**
 * Quiesce, THEN clear. A test's own cleanup DELETE is itself a score write, so
 * it broadcasts too — and that message can land a moment later, inside the next
 * test, where it reads as a spurious event and breaks a negative assertion.
 * Clearing without waiting first would just move the race, so wait for the tail
 * of the previous test to arrive and only then reset.
 */
beforeEach(async () => {
  await settle(1500);
  received = [];
});

afterAll(async () => {
  if (channel) await rt.removeChannel(channel);
  await ctx?.cleanup();
});

describe("096 broadcast trigger — score writes", () => {
  it("broadcasts on INSERT, UPDATE and DELETE of a score in a competition game", async (t) => {
    if (!requireRealtime(t)) return;
    const id = rid("se");

    const ins = await ctx.admin.from("score_entries").insert({
      id,
      game_id: compGameId,
      participant_type: "user",
      participant_id: ctx.getUser("owner").id,
      unit_label: "1",
      value: 4,
    });
    expect(ins.error).toBeNull();

    const upd = await ctx.admin.from("score_entries").update({ value: 3 }).eq("id", id);
    expect(upd.error).toBeNull();

    const del = await ctx.admin.from("score_entries").delete().eq("id", id);
    expect(del.error).toBeNull();

    // DELETE matters on its own: the emitter reads OLD there, since NEW is null.
    // A naive `NEW.game_id` implementation passes the first two and drops this.
    await waitFor(3);
    expect(received).toHaveLength(3);
    for (const p of received) {
      expect(p.gameId).toBe(compGameId);
      expect(p.competitionId).toBe(competitionId);
    }
  }, 60_000);

  it("carries a SIGNAL ONLY — no score reaches an anonymous subscriber", async (t) => {
    if (!requireRealtime(t)) return;
    const id = rid("se");
    const secret = 7;

    const ins = await ctx.admin.from("score_entries").insert({
      id,
      game_id: compGameId,
      participant_type: "user",
      participant_id: ctx.getUser("owner").id,
      unit_label: "9",
      value: secret,
    });
    expect(ins.error).toBeNull();
    await waitFor(1);
    expect(received).toHaveLength(1);

    // This client never authenticated — the topic is public (`private => false`).
    // That is only acceptable while the payload is content-free, so pin the exact
    // key set. `id` is the message uuid realtime.send stamps on, not our data.
    //
    // If this test fails because someone added a field, the fix is to REMOVE the
    // field, not to widen this assertion: the payload is what an unauthenticated
    // listener gets, and it is also what CLAUDE.md #15 depends on us NOT applying
    // to the cache.
    expect(Object.keys(received[0]).sort()).toEqual(["competitionId", "gameId", "id"]);

    const serialized = JSON.stringify(received[0]);
    expect(serialized).not.toContain(`"value"`);
    expect(serialized).not.toContain(`:${secret}`);
    expect(serialized).not.toContain(ctx.getUser("owner").id);

    await ctx.admin.from("score_entries").delete().eq("id", id);
  }, 60_000);

  it("stays silent for a STANDALONE game, and does not fail the write", async (t) => {
    if (!requireRealtime(t)) return;
    const id = rid("se");

    // 40% of production games have no competition — this is the common path, not
    // an edge case. The write must succeed and nothing may be emitted.
    const ins = await ctx.admin.from("score_entries").insert({
      id,
      game_id: soloGameId,
      participant_type: "user",
      participant_id: ctx.getUser("owner").id,
      unit_label: "1",
      value: 5,
    });
    expect(ins.error).toBeNull();

    const { data } = await ctx.admin.from("score_entries").select("value").eq("id", id).single();
    expect(data?.value).toBe(5); // the score actually landed

    await settle();
    expect(received).toEqual([]);

    await ctx.admin.from("score_entries").delete().eq("id", id);
  }, 60_000);
});

describe("096 broadcast trigger — game lifecycle", () => {
  it("broadcasts on go-live, finalize and re-open-for-correction", async (t) => {
    if (!requireRealtime(t)) return;

    for (const patch of [
      { scoring_enabled: true },
      { status: "complete" },
      { corrections_open: true },
    ]) {
      const r = await ctx.admin.from("games").update(patch).eq("id", compGameId);
      expect(r.error).toBeNull();
    }

    await waitFor(3);
    expect(received).toHaveLength(3);
    expect(received.every((p) => p.gameId === compGameId)).toBe(true);
  }, 60_000);

  it("stays silent on a games UPDATE that the board does not care about", async (t) => {
    if (!requireRealtime(t)) return;

    // The WHEN guard is what keeps this from becoming the high-frequency firehose
    // migration 084 was right to refuse. Every settings save touches this table.
    const r = await ctx.admin.from("games").update({ name: "Renamed" }).eq("id", compGameId);
    expect(r.error).toBeNull();

    await settle();
    expect(received).toEqual([]);
  }, 60_000);

  // 110 — reordering was the gap: display_order was not in the WHEN clause, so
  // a drag reached no one but the client that dragged. `games.reorder` writes
  // this column on every game in a competition, which is why the fix belongs on
  // the SAME trigger rather than a fourth one — the row is still there on an
  // UPDATE, so the existing lookup-by-id path needs nothing else.
  it("broadcasts when display_order changes — the reorder gap", async (t) => {
    if (!requireRealtime(t)) return;

    const r = await ctx.admin.from("games").update({ display_order: 7 }).eq("id", compGameId);
    expect(r.error).toBeNull();

    await waitFor(1);
    expect(received).toHaveLength(1);
    expect(received[0].gameId).toBe(compGameId);
    expect(received[0].competitionId).toBe(competitionId);
  }, 60_000);

  it("does not re-broadcast when a lifecycle column is written to its current value", async (t) => {
    if (!requireRealtime(t)) return;

    // IS DISTINCT FROM, not just "column was in the UPDATE" — an idempotent
    // re-save of the same status should not wake every viewer's board.
    const r = await ctx.admin.from("games").update({ status: "complete" }).eq("id", compGameId);
    expect(r.error).toBeNull();

    await settle();
    expect(received).toEqual([]);
  }, 60_000);
});

/**
 * Migration 109 — a game APPEARING or DISAPPEARING.
 *
 * 096 covered UPDATE only, so creating or deleting a game emitted nothing and
 * every other client waited out the 5-minute `LEADERBOARD_QUERY` backstop.
 *
 * DELETE is the one that needs an end-to-end test rather than an assertion,
 * because the obvious implementation silently does nothing: `broadcast_score_event`
 * used to resolve the competition by looking the game up, and in an AFTER DELETE
 * the row is already gone (measured: `rows_visible=0, lookup=<NULL>`). Adding
 * `OR DELETE` to the old trigger would have compiled, run, and emitted zero
 * broadcasts. Only reading `competition_id` off the row works — and only a test
 * that subscribes for real can tell the two apart.
 */
describe("109 broadcast trigger — a game appears or disappears", () => {
  it("broadcasts on INSERT of a game in a competition", async (t) => {
    if (!requireRealtime(t)) return;

    const id = rid("game-new");
    const r = await ctx.admin.from("games").insert({
      id,
      trip_id: tripId,
      competition_id: competitionId,
      game_type_id: "gtt_manual",
      name: "Freshly added",
    });
    expect(r.error).toBeNull();

    await waitFor(1);
    expect(received).toHaveLength(1);
    expect(received[0].gameId).toBe(id);
    expect(received[0].competitionId).toBe(competitionId);

    await ctx.admin.from("games").delete().eq("id", id);
  }, 60_000);

  it("broadcasts on DELETE — the case the lookup could not serve", async (t) => {
    if (!requireRealtime(t)) return;

    const id = rid("game-doomed");
    const ins = await ctx.admin.from("games").insert({
      id,
      trip_id: tripId,
      competition_id: competitionId,
      game_type_id: "gtt_manual",
      name: "Doomed",
    });
    expect(ins.error).toBeNull();
    await waitFor(1); // the INSERT broadcast
    received.length = 0;

    const del = await ctx.admin.from("games").delete().eq("id", id);
    expect(del.error).toBeNull();

    await waitFor(1);
    expect(received).toHaveLength(1);
    expect(received[0].gameId).toBe(id);
    // Resolved from OLD.competition_id, since the row no longer exists to look up.
    expect(received[0].competitionId).toBe(competitionId);
  }, 60_000);

  it("stays silent for a STANDALONE game on both insert and delete", async (t) => {
    if (!requireRealtime(t)) return;

    // ~40% of production games have no competition. There is no board to update,
    // so the null-competition early return must still hold on the new triggers —
    // and the writes must still succeed.
    const id = rid("game-solo-new");
    const ins = await ctx.admin.from("games").insert({
      id,
      trip_id: tripId,
      competition_id: null,
      game_type_id: "gtt_manual",
      name: "Standalone",
    });
    expect(ins.error).toBeNull();

    const del = await ctx.admin.from("games").delete().eq("id", id);
    expect(del.error).toBeNull();

    await settle();
    expect(received).toEqual([]);
  }, 60_000);
});
