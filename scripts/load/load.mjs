// Load test: N people scoring one game, M people watching its cup board.
//
//   node scripts/load/load.mjs --scorers 4 --watchers 20 --duration 60 --hole-every 20
//
// LOCAL ONLY (lib.mjs refuses any other host). Needs: the scratch stack, the app
// served at LOAD_APP_URL, and seed-scaffold + seed-games run (one live game).
//
// What each virtual client does, and why it is shaped that way:
//
//   scorer   Every --hole-every seconds, enters 4 scores about a second apart
//            (a foursome's hole, entered together: the clustered arrival shape
//            src/lib/invalidationCoalescer.ts measured), through the app's own
//            `scores.upsertEntry`. Real pace is one hole per ~12 minutes;
//            --hole-every compresses it.
//   watcher  Holds ONE Realtime socket subscribed to the board's broadcast topic
//            (`competition_events:{id}`, event `score_changed`). On an event it
//            starts a 2 s window, then refetches `competitions.leaderboard`
//            once: what an open board does (useRealtimeScoreEvents +
//            COALESCE_WINDOW_MS). With --watch game it refetches
//            `scores.listByGame` instead, as an open game view does.
//
// Not modelled: the 20 s game-view polls, the 5 min board poll, chat, the other
// nine Realtime topics a real tab joins, and browsers' HTTP batching.
//
// Verdict: exits 1 when the run breaches the bar below. A green run is only
// evidence because a red one has been seen: SCALE_AUDIT.md records the run
// against a stopped PostgREST, which must fail.
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import {
  assertLocal, admin, signIn, trpcQuery, trpcMutation, userEmail, summarize,
  SUPABASE_URL, ANON_KEY, FOCUS_TRIP, FOCUS_COMP,
} from "./lib.mjs";

assertLocal();

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? dflt : process.argv[i + 1];
};
const SCORERS = Number(arg("scorers", 4));
const WATCHERS = Number(arg("watchers", 20));
const DURATION_S = Number(arg("duration", 60));
const HOLE_EVERY_S = Number(arg("hole-every", 20));
const WATCH = arg("watch", "board"); // board | game
const USERS = Number(arg("users", 40)); // distinct accounts to spread clients over
const DB_CONTAINER = arg("db-container", null); // optional: sample Postgres from docker
const BAR = { errorRate: 0.01, writeP95: 1000, readP95: 2000, delivery: 0.99 };
const COALESCE_MS = 2000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const db = admin();
const { data: live, error: liveErr } = await db
  .from("games")
  .select("id")
  .eq("trip_id", FOCUS_TRIP)
  .eq("scoring_enabled", true)
  .neq("status", "complete")
  .order("created_at", { ascending: false })
  .limit(1)
  .maybeSingle();
if (liveErr || !live) throw new Error("no live game on the focus trip: run seed-games.mjs 0 1 0");
const gameId = arg("game", live.id);
const { data: parts } = await db.from("game_participants").select("user_id").eq("game_id", gameId);
const players = parts.map((p) => p.user_id);

// Sessions: owner scores (an Owner may score any player); watchers are Members.
const owner = await signIn(userEmail(1));
const memberSessions = [];
for (let n = 2; n <= USERS; n++) memberSessions.push(await signIn(userEmail(n)));

const sql = (q) => {
  if (!DB_CONTAINER) return null;
  try {
    return execFileSync("docker", ["exec", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-X", "-q", "-At", "-c", q], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
};

const stats = {
  writes: [], writeFail: 0, writeStatus: {},
  reads: [], readFail: 0, readStatus: {},
  eventsSeen: 0, subscribed: 0, subscribeFailed: 0, socketErrors: 0,
  dbConnPeak: 0, realtimeConnPeak: 0,
};
const bump = (obj, k) => (obj[k] = (obj[k] ?? 0) + 1);
let running = true;
let broadcastsExpected = 0;

// ── watchers ────────────────────────────────────────────────────────────────
const clients = [];
async function startWatcher(i) {
  const session = memberSessions[i % memberSessions.length];
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  await client.realtime.setAuth(session.accessToken);
  clients.push(client);
  let timer = null;
  const refetch = async () => {
    timer = null;
    if (!running) return;
    const r =
      WATCH === "game"
        ? await trpcQuery(session, "scores.listByGame", { tripId: FOCUS_TRIP, gameId })
        : await trpcQuery(session, "competitions.leaderboard", { tripId: FOCUS_TRIP, competitionId: FOCUS_COMP });
    if (r.ok) stats.reads.push(r.ms);
    else {
      stats.readFail++;
      bump(stats.readStatus, r.status);
    }
  };
  await new Promise((resolve) => {
    let settled = false;
    client
      .channel(`competition_events:${FOCUS_COMP}`)
      .on("broadcast", { event: "score_changed" }, () => {
        stats.eventsSeen++;
        if (timer === null) timer = setTimeout(refetch, COALESCE_MS);
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          if (!settled) stats.subscribed++;
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          if (!settled) stats.subscribeFailed++;
          else if (running) stats.socketErrors++;
        } else return;
        settled = true;
        resolve();
      });
    setTimeout(() => {
      if (!settled) {
        settled = true;
        stats.subscribeFailed++;
        resolve();
      }
    }, 15_000);
  });
}

// ── scorers ─────────────────────────────────────────────────────────────────
async function scorer(i) {
  await sleep((i * HOLE_EVERY_S * 1000) / SCORERS); // spread groups across the hole interval
  let hole = 0;
  while (running) {
    hole = (hole % 18) + 1;
    for (let k = 0; k < 4 && running; k++) {
      const participantId = players[(i * 4 + k) % players.length];
      const r = await trpcMutation(owner, "scores.upsertEntry", {
        tripId: FOCUS_TRIP, gameId, participantId, unitLabel: String(hole),
        value: 3 + ((hole + k + i) % 5), participantType: "user",
      });
      if (r.ok) {
        stats.writes.push(r.ms);
        broadcastsExpected++;
      } else {
        stats.writeFail++;
        bump(stats.writeStatus, r.status);
      }
      await sleep(900);
    }
    await sleep(Math.max(0, HOLE_EVERY_S * 1000 - 4 * 900));
  }
}

async function sampler() {
  while (running) {
    const c = sql("select count(*) from pg_stat_activity where datname = 'postgres' and backend_type = 'client backend'");
    if (c) stats.dbConnPeak = Math.max(stats.dbConnPeak, Number(c));
    await sleep(2000);
  }
}

// ── run ─────────────────────────────────────────────────────────────────────
const msgBefore = sql("select count(*) from realtime.messages");
const t0 = Date.now();
for (let i = 0; i < WATCHERS; i += 25) {
  await Promise.all(Array.from({ length: Math.min(25, WATCHERS - i) }, (_, k) => startWatcher(i + k)));
}
const subscribeMs = Date.now() - t0;
const tasks = [sampler(), ...Array.from({ length: SCORERS }, (_, i) => scorer(i))];
await sleep(DURATION_S * 1000);
running = false;
await Promise.all(tasks);
await sleep(COALESCE_MS + 3000); // let the last window and its refetch land
const msgAfter = sql("select count(*) from realtime.messages");
await Promise.all(clients.map((c) => c.removeAllChannels().catch(() => {})));

const writes = summarize(stats.writes);
const reads = summarize(stats.reads);
const attempts = stats.writes.length + stats.writeFail + stats.reads.length + stats.readFail;
const errorRate = attempts ? (stats.writeFail + stats.readFail) / attempts : 1;
const expectedEvents = broadcastsExpected * stats.subscribed;
const delivery = expectedEvents ? stats.eventsSeen / expectedEvents : 0;
const breaches = [];
if (stats.writes.length === 0) breaches.push("no score write succeeded");
if (WATCHERS > 0 && stats.reads.length === 0) breaches.push("no watcher refetch succeeded");
if (errorRate > BAR.errorRate) breaches.push(`error rate ${(errorRate * 100).toFixed(1)}% > ${BAR.errorRate * 100}%`);
if (writes.p95 != null && writes.p95 > BAR.writeP95) breaches.push(`write p95 ${writes.p95}ms > ${BAR.writeP95}ms`);
if (reads.p95 != null && reads.p95 > BAR.readP95) breaches.push(`watcher read p95 ${reads.p95}ms > ${BAR.readP95}ms`);
if (stats.subscribeFailed > 0) breaches.push(`${stats.subscribeFailed} watcher(s) failed to subscribe`);
if (WATCHERS > 0 && delivery < BAR.delivery) breaches.push(`broadcast delivery ${(delivery * 100).toFixed(1)}% < ${BAR.delivery * 100}%`);

console.log(
  JSON.stringify(
    {
      scenario: { scorers: SCORERS, watchers: WATCHERS, durationS: DURATION_S, holeEveryS: HOLE_EVERY_S, watch: WATCH, gameId },
      writes: { ...writes, failed: stats.writeFail, status: stats.writeStatus, perSecond: +(stats.writes.length / DURATION_S).toFixed(2) },
      watcherReads: { ...reads, failed: stats.readFail, status: stats.readStatus, perSecond: +(stats.reads.length / DURATION_S).toFixed(2) },
      realtime: {
        subscribed: stats.subscribed, subscribeFailed: stats.subscribeFailed, subscribeMs, socketErrors: stats.socketErrors,
        eventsSeen: stats.eventsSeen, eventsExpected: expectedEvents, delivery: +delivery.toFixed(4),
        broadcastRowsWritten: msgBefore != null && msgAfter != null ? Number(msgAfter) - Number(msgBefore) : null,
      },
      postgres: { clientConnectionsPeak: DB_CONTAINER ? stats.dbConnPeak : null },
      errorRate: +errorRate.toFixed(4),
      verdict: breaches.length ? "FAIL" : "PASS",
      breaches,
    },
    null,
    1
  )
);
process.exit(breaches.length ? 1 : 0);
