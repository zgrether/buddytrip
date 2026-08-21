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
 * On the GitHub runner the container starts but channel joins never complete
 * (#1013). These tests therefore FAIL there — see the throw at the end of
 * `beforeAll` — and skip only locally.
 *
 * This comment used to say they "SKIP there rather than failing a merge gate on
 * infrastructure", and that sentence is why the rule above it now exists: it
 * described the intent accurately and the consequence not at all. The tests
 * skipped, the summary said `15 skipped` among 3036 passed, and for months
 * every green run was read as evidence about a file that never executed — while
 * one of its assertions was wrong the whole time (#1011). "A silently-skipped
 * test is worse than no test, because it reads as coverage" was already written
 * here, three lines below the thing that made it silent.
 *
 * The emit/listen contract is still enforced everywhere by
 * `useRealtimeScoreEvents.contract.test.ts`, which needs no infrastructure;
 * this file is the deeper runtime proof.
 */
let realtimeUp = false;
let lastStatus = "not attempted";

/**
 * Skip with a visible reason when Realtime isn't available here.
 *
 * LOCAL ONLY. In CI this is unreachable — `beforeAll` throws before any case
 * runs, because a silent skip there is the defect (#1013, and the comment at
 * that throw). A contributor without a working stack still gets a skip.
 */
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
  // Postgres. Retry to a deadline — a contended local stack can miss the first
  // join — then branch on where we are (see the throw below).
  //
  // Trimmed from 15s/60s because this budget is spent IN FULL every time
  // Realtime is missing — ~83s per CI run to learn nothing.
  //
  // 13s, NOT 10s, and the 3s matters: realtime-js's own channel timeout is
  // 10s, and the sentinel below only exists to catch `subscribe()` never
  // calling back at all. At 10s the two race and the sentinel usually wins,
  // which replaces realtime-js's `TIMED_OUT` — "the socket opened and the JOIN
  // went unanswered" — with our uninformative `LOCAL_TIMEOUT`. Observed in CI:
  // the status regressed from `TIMED_OUT after 6 attempts` to `LOCAL_TIMEOUT
  // after 4`. Sitting just above their timeout keeps the more specific status,
  // which is the one #1013 needs to tell "never connected" from "connected,
  // join ignored".
  const deadline = Date.now() + 45_000;
  let attempt = 0;
  for (;;) {
    attempt += 1;
    channel = rt.channel(scoreEventsTopic(competitionId));
    channel.on("broadcast", { event: SCORE_EVENT }, (m) => {
      received.push((m?.payload ?? {}) as Record<string, unknown>);
    });

    const status = await new Promise<string>((resolve) => {
      const t = setTimeout(() => resolve("LOCAL_TIMEOUT"), 13_000);
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

  // ── The skip is LOUD in CI, and that is the point ───────────────────────
  //
  // These 15 cases are the whole migration 096/118 broadcast contract,
  // including CLAUDE.md #20's rule that a payload on a PUBLIC topic carries no
  // data — a security invariant about what an unauthenticated listener
  // receives. They had never once executed in CI, because Realtime is
  // unreachable there and the file skipped itself politely:
  //
  //     Tests  3036 passed | 15 skipped (3051)
  //
  // which reads as normal in a passing summary. Every green run was cited as
  // evidence for a file that never ran, and one of its assertions had in fact
  // been wrong for weeks (#1011).
  //
  // The defect was never "these do not run" — plenty of things legitimately do
  // not run. It was that NOTHING SAID SO anywhere a person would look. An
  // exclusion that is declared and visibly failing is a known gap; a quiet one
  // is an unknown one, and this project has now been bitten by the same shape
  // twice (see the vitest.config.mts note on broadcastAmplification, where a
  // file's header claimed an exclusion it did not have).
  //
  // So: locally, skip — a contributor without a working stack should not be
  // blocked. In CI, fail. Deliberately in `beforeAll`, for two reasons: it
  // reports ONCE rather than fifteen times, and vitest's `retry: 2` does not
  // wrap hooks, so a deterministic infrastructure gap cannot be papered over by
  // a retry that was meant for a transient PostgREST 502.
  //
  // Tracked as #1013. If Realtime turns out to be impractical on a runner, the
  // fix is to say so explicitly — not to make this quiet again.
  if (!realtimeUp && process.env.CI) {
    throw new Error(
      `Realtime is unreachable in CI (${lastStatus}), so the 15 broadcast-contract ` +
        `cases in this file did not run. That includes the public-topic payload rule ` +
        `(CLAUDE.md #20). This is a HARD FAILURE on purpose: these used to skip ` +
        `silently, and a green CI run was never evidence about any of them. ` +
        `See issue #1013 — either make Realtime reachable in CI, or declare the ` +
        `exclusion explicitly. Do not restore the silent skip.`,
    );
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

    // The go-live patch writes all three columns a real go-live writes, not
    // just `scoring_enabled`. Migration 135 refuses scoring opening on a game
    // that is still `pending` and was never published, so the bare flag is now
    // an impossible state rather than a convenient poke — and the point of this
    // test is that a LIFECYCLE CHANGE broadcasts, which a genuine go-live
    // exercises better anyway.
    for (const patch of [
      { scoring_enabled: true, status: "active", pairings_published_at: new Date().toISOString() },
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

/**
 * Migration 118 — a bracket PICK reaches the other devices.
 *
 * The pick is the one game-state change the `configHash` poll deliberately
 * cannot carry: `winner_entrant_id` is excluded from the hash on purpose (a test
 * in the 115 suite pins that), because hashing it would refetch every open
 * device's whole config on each advance AND fail a concurrent settings save's
 * concurrency check. So the pick propagates as a SCORE does — by broadcast.
 *
 * The WHEN guard is the half worth testing: `bracket_matches` rows are also
 * written wholesale by `save_game_config`'s draw rebuild, which the config hash
 * already covers, and firing there would emit one broadcast per match for a
 * change every device is about to refetch anyway.
 */
describe("118 broadcast trigger — a bracket pick", () => {
  /** Seed a two-entrant draw directly, so these cases stay about the trigger
   *  rather than about the save path that normally builds one. */
  async function seedDraw(gameId: string): Promise<string> {
    // Entrant ids are DETERMINISTIC (`<gameId>:e1`), and each case cleans up at
    // its END — so a case that fails mid-way leaves its rows behind and the next
    // two die on a duplicate key instead of running. That is how ONE real
    // failure in this block presented as three, and how the leftovers then
    // survived in the local database run after run, looking like flake.
    //
    // Clearing first makes each case independent of whether the last one
    // finished. Cheap, and it keeps a genuine failure legible as one failure.
    await ctx.admin.from("bracket_entrants").delete().eq("game_id", gameId);
    const rows = [1, 2].map((seed) => ({ id: `${gameId}:e${seed}`, game_id: gameId, team_id: null, seed }));
    const e = await ctx.admin.from("bracket_entrants").insert(rows);
    if (e.error) throw new Error(`seed entrants: ${e.error.message}`);
    const matchId = rid("bm");
    const m = await ctx.admin.from("bracket_matches").insert({
      id: matchId,
      game_id: gameId,
      bracket: "main",
      round: 1,
      slot: 1,
      entrant_a_id: `${gameId}:e1`,
      entrant_b_id: `${gameId}:e2`,
    });
    if (m.error) throw new Error(`seed match: ${m.error.message}`);
    return matchId;
  }

  it("broadcasts when a winner is recorded, changed, and cleared", async (t) => {
    if (!requireRealtime(t)) return;

    const matchId = await seedDraw(compGameId);
    await settle(1500);
    received = [];

    for (const winner of [`${compGameId}:e1`, `${compGameId}:e2`, null]) {
      const u = await ctx.admin.from("bracket_matches").update({ winner_entrant_id: winner }).eq("id", matchId);
      expect(u.error).toBeNull();
    }

    // Clearing is a real change — it un-decides everything above the match,
    // which is exactly what the other devices need to hear about.
    await waitFor(3);
    expect(received.length).toBe(3);
    expect(received.every((p) => p.gameId === compGameId && p.competitionId === competitionId)).toBe(true);

    await ctx.admin.from("bracket_matches").delete().eq("id", matchId);
    await ctx.admin.from("bracket_entrants").delete().eq("game_id", compGameId);
  }, 60_000);

  it("carries a SIGNAL ONLY — the winner never reaches an anonymous subscriber", async (t) => {
    if (!requireRealtime(t)) return;

    // Same rule as every other payload on this topic (#20): the topic is public,
    // so the payload is what an UNAUTHENTICATED listener gets. Who won is a
    // result; the client's tRPC refetch is what re-applies auth to read it.
    const matchId = await seedDraw(compGameId);
    await settle(1500);
    received = [];

    await ctx.admin.from("bracket_matches").update({ winner_entrant_id: `${compGameId}:e1` }).eq("id", matchId);
    await waitFor(1);
    expect(received).toHaveLength(1);
    // Same key set as the 096 twin above, `id` included — that is the message
    // uuid `realtime.send` stamps on when the payload has no `id` of its own,
    // not a field of ours. This copy was written without it and had been failing
    // since; nothing caught it because the whole file SKIPS in CI, where the
    // Realtime websocket never comes up.
    //
    // The 096 twin's warning applies here verbatim: if this fails because
    // someone added a field, REMOVE the field rather than widening this.
    expect(Object.keys(received[0]).sort()).toEqual(["competitionId", "gameId", "id"]);

    await ctx.admin.from("bracket_matches").delete().eq("id", matchId);
    await ctx.admin.from("bracket_entrants").delete().eq("game_id", compGameId);
  }, 60_000);

  it("stays silent on the draw REBUILD — that is the config hash's job", async (t) => {
    if (!requireRealtime(t)) return;

    // INSERT and DELETE of bracket_matches only happen during a rebuild, which
    // the hash already covers. Firing here would make an 8-entrant redraw emit
    // seven broadcasts for one edit, and every device would refetch twice.
    const matchId = await seedDraw(compGameId);
    await settle();
    expect(received).toEqual([]);

    const del = await ctx.admin.from("bracket_matches").delete().eq("id", matchId);
    expect(del.error).toBeNull();
    await settle();
    expect(received).toEqual([]);

    await ctx.admin.from("bracket_entrants").delete().eq("game_id", compGameId);
  }, 60_000);

  it("does not re-broadcast when the winner is written to its current value", async (t) => {
    if (!requireRealtime(t)) return;

    // `IS DISTINCT FROM`, not `<>` — and a no-op re-write is what a client
    // re-sending its state looks like.
    const matchId = await seedDraw(compGameId);
    await ctx.admin.from("bracket_matches").update({ winner_entrant_id: `${compGameId}:e1` }).eq("id", matchId);
    await waitFor(1);
    await settle(1500);
    received = [];

    await ctx.admin.from("bracket_matches").update({ winner_entrant_id: `${compGameId}:e1` }).eq("id", matchId);
    await settle();
    expect(received).toEqual([]);

    await ctx.admin.from("bracket_matches").delete().eq("id", matchId);
    await ctx.admin.from("bracket_entrants").delete().eq("game_id", compGameId);
  }, 60_000);

  it("stays silent for a STANDALONE bracket", async (t) => {
    if (!requireRealtime(t)) return;

    // The null-competition early return, on the newest trigger. ~40% of
    // production games have no competition, so this path is the common case.
    const matchId = await seedDraw(soloGameId);
    await settle(1500);
    received = [];

    const u = await ctx.admin.from("bracket_matches").update({ winner_entrant_id: `${soloGameId}:e1` }).eq("id", matchId);
    expect(u.error).toBeNull();
    await settle();
    expect(received).toEqual([]);

    await ctx.admin.from("bracket_matches").delete().eq("id", matchId);
    await ctx.admin.from("bracket_entrants").delete().eq("game_id", soloGameId);
  }, 60_000);
});
