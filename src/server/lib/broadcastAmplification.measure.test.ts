import { describe, it, beforeAll, afterAll } from "vitest";
import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import { TestContext } from "../../__tests__/helpers/test-setup";
import { scoreEventsTopic, SCORE_EVENT } from "../../hooks/useRealtimeScoreEvents";

/**
 * PHASE 0 MEASUREMENT — how many broadcasts does ONE user action emit?
 *
 * The outage spec reads N duplicate `faceBootstrap,leaderboard` pairs in a single
 * tRPC batch URL as N accumulated HANDLERS. That is one of two multipliers.
 * Migration 096's triggers are all `FOR EACH ROW`, so a write touching R rows
 * emits R broadcasts, and the pairs in a batch are:
 *
 *     pairs  =  broadcasts delivered in the tick  ×  handlers on the channel
 *
 * This file measures the FIRST factor with a real Realtime client, so the browser
 * measurement can attribute what is left to the second. Counting, not asserting —
 * it prints and is excluded from the default suite by filename.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

let ctx: TestContext;
let tripId: string;
let competitionId: string;
let gameId: string;
let rt: SupabaseClient;
let channel: RealtimeChannel;
let received: Array<Record<string, unknown>> = [];
let realtimeUp = false;

const rid = (p: string) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

/**
 * Wait for arrivals to STOP rather than for a count, since the whole question is
 * how many there are.
 *
 * Two phases on purpose: the FIRST message on a freshly-joined channel can take
 * seconds, so a plain quiet-period timer starting at t=0 returns 0 before
 * anything lands (it did, on the first run of this file). So: wait up to
 * `firstMs` for message one, then `quietMs` of silence to call it done.
 */
async function drain(quietMs = 3000, firstMs = 15_000, maxMs = 60_000): Promise<number> {
  const start = Date.now();
  while (received.length === 0 && Date.now() - start < firstMs) {
    await new Promise((r) => setTimeout(r, 100));
  }
  if (received.length === 0) return 0;
  let last = received.length;
  let lastChange = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, 100));
    if (received.length !== last) {
      last = received.length;
      lastChange = Date.now();
    }
    if (Date.now() - lastChange > quietMs) return received.length;
    if (Date.now() - start > maxMs) return received.length;
  }
}

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("Amplification trip");
  await ctx.addTripMember(tripId, "member", "Member");
  competitionId = await ctx.createCompetition(tripId, "Amplification Cup", { scoringModel: "points" });
  await ctx.createTeam(competitionId, "Blue", { shortName: "BLU" });
  await ctx.createTeam(competitionId, "Red", { shortName: "RED" });

  gameId = rid("game");
  const g = await ctx.admin.from("games").insert({
    id: gameId,
    trip_id: tripId,
    competition_id: competitionId,
    game_type_id: "gtt_stroke_play",
    name: "Amplification game",
    status: "active",
    scoring_enabled: true,
  });
  if (g.error) throw new Error(`seed game: ${g.error.message}`);

  rt = createClient(SUPABASE_URL, ANON_KEY);
  const deadline = Date.now() + 60_000;
  for (;;) {
    channel = rt.channel(scoreEventsTopic(competitionId));
    channel.on("broadcast", { event: SCORE_EVENT }, (m) => {
      received.push((m?.payload ?? {}) as Record<string, unknown>);
    });
    const status = await new Promise<string>((resolve) => {
      let settled = false;
      channel.subscribe((s) => {
        if (!settled) {
          settled = true;
          resolve(s);
        }
      });
      setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve("TIMED_OUT");
        }
      }, 8000);
    });
    if (status === "SUBSCRIBED") {
      realtimeUp = true;
      break;
    }
    await rt.removeChannel(channel);
    if (Date.now() > deadline) break;
  }
}, 120_000);

afterAll(async () => {
  if (channel) await rt.removeChannel(channel);
  await ctx.admin.from("score_entries").delete().eq("game_id", gameId);
  await ctx.admin.from("game_results").delete().eq("game_id", gameId);
  await ctx.admin.from("game_participants").delete().eq("game_id", gameId);
  await ctx.admin.from("games").delete().eq("id", gameId);
  await ctx.cleanup();
}, 60_000);

describe("broadcast amplification — how many events does one action emit?", () => {
  it("counts broadcasts for a single write, and for a full reset", async () => {
    if (!realtimeUp) {
      console.warn("[amplification] SKIPPED — no Realtime websocket in this environment.");
      return;
    }

    // ── Baseline: ONE row changed → how many broadcasts? ────────────────────
    received = [];
    await ctx.admin
      .from("games")
      .update({ corrections_open: true })
      .eq("id", gameId);
    const single = await drain();
    console.log(`\n=== broadcast amplification (local stack) ===`);
    console.log(`ONE games-lifecycle row UPDATE          -> ${single} broadcast(s)`);
    await ctx.admin.from("games").update({ corrections_open: false }).eq("id", gameId);
    await drain(1500);

    // ── A realistically-scored round: 4 players × 18 holes ──────────────────
    const players = [
      ctx.getUser("owner").id,
      ctx.getUser("member").id,
      ctx.getUser("planner").id,
      ctx.getUser("outsider").id,
    ];
    const parts = players.map((uid) => ({
      id: crypto.randomUUID(),
      game_id: gameId,
      user_id: uid,
    }));
    const p = await ctx.admin.from("game_participants").insert(parts);
    if (p.error) throw new Error(`seed participants: ${p.error.message}`);

    const rows: Record<string, unknown>[] = [];
    for (const uid of players) {
      for (let h = 1; h <= 18; h++) {
        rows.push({
          id: crypto.randomUUID(),
          game_id: gameId,
          participant_id: uid,
          participant_type: "user",
          unit_label: String(h),
          value: 4,
        });
      }
    }
    received = [];
    const ins = await ctx.admin.from("score_entries").insert(rows);
    if (ins.error) throw new Error(`seed scores: ${ins.error.message}`);
    const onInsert = await drain();
    console.log(`INSERT of ${rows.length} score rows (one stmt)   -> ${onInsert} broadcast(s)`);

    // ── The reset — the action that preceded the outage ─────────────────────
    const { count: before } = await ctx.admin
      .from("score_entries")
      .select("*", { count: "exact", head: true })
      .eq("game_id", gameId);

    received = [];
    await ctx.caller().games.resetScoring({ tripId, gameId });
    const onReset = await drain();

    console.log(`games.resetScoring over ${before} score rows -> ${onReset} broadcast(s)`);
    console.log(
      `\nEach broadcast runs EVERY handler on the channel, and each handler` +
        `\ninvalidates faceBootstrap + leaderboard. So one batch carries` +
        `\n  pairs = broadcasts x handlers  =  ${onReset} x H` +
        `\nfor this reset. H is measured in the browser.\n`
    );
  }, 300_000);
});
