import { describe, it, beforeAll, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";

/**
 * PHASE 0 MEASUREMENT — the SERVER half of the three slow paths.
 *
 * Excluded from the default suite by filename (`*.measure.test.ts`) and opted
 * back in with `MEASURE=1`, the same switch the Playwright measurement projects
 * use. It prints; it does not assert.
 *
 *     MEASURE=1 npx vitest run src/server/routers/slowPaths.measure.test.ts
 *
 * ── What this measures and why ───────────────────────────────────────────────
 * #829 established the transferable figure is the **number of sequential DB
 * round trips**, not the local wall clock: the local stack answers in ~1 ms, so
 * a chain of N dependent queries costs ~N ms here and ~N × RTT in production.
 * This file measures that chain for each procedure on the three paths.
 *
 * `criticalPath` is the real serialization depth, not `total - maxInFlight`:
 * for each request, depth = 1 + max(depth of every request that had already
 * FINISHED when it started. Requests issued together (Promise.all) share a
 * depth and cost one RTT between them, which is exactly the property that
 * matters on a phone.
 */

const RTT_PROFILES = [0, 50, 120] as const;

type Req = { proc: string; start: number; end: number; path: string };

let log: Req[] = [];
let currentProc: string | null = null;
let realFetch: typeof globalThis.fetch;

function installFetchProbe() {
  realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!currentProc) return realFetch(input, init);
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const start = performance.now();
    try {
      return await realFetch(input, init);
    } finally {
      log.push({
        proc: currentProc,
        start,
        end: performance.now(),
        // `/rest/v1/games?select=…` → `games`; `/rest/v1/rpc/save_game_config` → `rpc/save_game_config`
        path: (url.split("/rest/v1/")[1] ?? url).split("?")[0],
      });
    }
  }) as typeof globalThis.fetch;
}

/** Serialization depth of a set of overlapping requests. */
function criticalPath(reqs: Req[]): number {
  const sorted = [...reqs].sort((a, b) => a.start - b.start);
  const depths: number[] = [];
  let max = 0;
  sorted.forEach((r, i) => {
    let best = 0;
    for (let j = 0; j < i; j++) {
      // Only a request that had already FINISHED can have forced this one to wait.
      if (sorted[j].end <= r.start + 0.001) best = Math.max(best, depths[j]);
    }
    depths[i] = best + 1;
    max = Math.max(max, depths[i]);
  });
  return max;
}

function maxInFlight(reqs: Req[]): number {
  const events = reqs.flatMap((r) => [{ t: r.start, d: 1 }, { t: r.end, d: -1 }]).sort((a, b) => a.t - b.t || a.d - b.d);
  let cur = 0, max = 0;
  for (const e of events) { cur += e.d; max = Math.max(max, cur); }
  return max;
}

/** Print the full waterfall — each request with its serialization depth, so the
 *  chain is readable rather than just counted. */
function waterfall(reqs: Req[]): string {
  const sorted = [...reqs].sort((a, b) => a.start - b.start);
  const t0 = sorted[0]?.start ?? 0;
  const depths: number[] = [];
  return sorted
    .map((r, i) => {
      let best = 0;
      for (let j = 0; j < i; j++) if (sorted[j].end <= r.start + 0.001) best = Math.max(best, depths[j]);
      depths[i] = best + 1;
      return `      d${String(depths[i]).padStart(2)}  ${(r.start - t0).toFixed(0).padStart(4)}→${(r.end - t0).toFixed(0).padStart(4)}ms  ${r.path}`;
    })
    .join("\n");
}

async function measure<T>(name: string, fn: () => Promise<T>, detail = false): Promise<T> {
  log = [];
  currentProc = name;
  const t0 = performance.now();
  let out: T;
  try {
    out = await fn();
  } finally {
    currentProc = null;
  }
  const wall = performance.now() - t0;
  const reqs = log.slice();
  const depth = criticalPath(reqs);
  const byTable = reqs.reduce<Record<string, number>>((a, r) => ((a[r.path] = (a[r.path] ?? 0) + 1), a), {});
  const tables = Object.entries(byTable)
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => `${t}×${n}`)
    .join(" ");
  const projections = RTT_PROFILES.map((rtt) => `${rtt}ms:${Math.round(wall + depth * rtt)}ms`).join("  ");
  console.log(
    `${name.padEnd(34)} wall ${wall.toFixed(0).padStart(5)}ms | reqs ${String(reqs.length).padStart(3)} | ` +
      `maxInFlight ${maxInFlight(reqs)} | CRITICAL PATH ${String(depth).padStart(2)} | ${projections}\n` +
      `${" ".repeat(36)}${tables}` +
      (detail ? `\n${waterfall(reqs)}` : "")
  );
  return out;
}

let ctx: TestContext;
let tripId: string;
let competitionId: string;
let ownerId: string;
let memberId: string;
let plannerId: string;
const gameIds: string[] = [];

/** A finalized 1v1 match game over a full 18 holes — the shape a real BBMI game
 *  has when someone taps "Correct a score". */
async function makeMatchGame(name: string, holes = 18): Promise<string> {
  const id = genId("perf-match");
  gameIds.push(id);
  const par = Array.from({ length: holes }, () => 4);
  await ctx.admin.from("games").insert({
    id, trip_id: tripId, competition_id: competitionId, game_type_id: "gtt_match_play",
    name, status: "complete", corrections_open: false, scoring_enabled: true,
    scorecard_schema: { units: { count: holes, label: "hole", metadata: { par, handicap_index: par.map((_, i) => i + 1) } } },
    points_distribution: { type: "per_match", value: 2 }, points_total: 2,
    modifiers: {}, competition_format: "head_to_head",
    pairings_published_at: new Date(0).toISOString(),
  });
  await ctx.admin.from("game_participants").insert([
    { id: genId("p"), game_id: id, user_id: ownerId, handicap_strokes: 3 },
    { id: genId("p"), game_id: id, user_id: memberId, handicap_strokes: 0 },
  ]);
  const entries = [];
  for (let h = 1; h <= holes; h++) {
    entries.push(
      { id: genId("se"), game_id: id, participant_id: ownerId, participant_type: "user", unit_label: String(h), value: 4 },
      { id: genId("se"), game_id: id, participant_id: memberId, participant_type: "user", unit_label: String(h), value: 5 }
    );
  }
  await ctx.admin.from("score_entries").insert(entries);
  await ctx.admin.from("game_matches").insert({
    id: genId("gm"), game_id: id, match_number: 1, display_order: 0,
    side_a: { type: "user", id: ownerId }, side_b: { type: "user", id: memberId },
    result: "a_win", margin: "18up", status: "complete",
  });
  await ctx.admin.from("game_results").insert([
    { id: genId("gr"), game_id: id, entity_id: ownerId, entity_type: "user", position: 1, raw_score: 18 },
    { id: genId("gr"), game_id: id, entity_id: memberId, entity_type: "user", position: 2, raw_score: 0 },
  ]);
  return id;
}

/** A finalized stroke game — 4 players over 18, the heavier read. */
async function makeStrokeGame(name: string, holes = 18): Promise<string> {
  const id = genId("perf-stroke");
  gameIds.push(id);
  const par = Array.from({ length: holes }, () => 4);
  const players = [ownerId, memberId, plannerId];
  await ctx.admin.from("games").insert({
    id, trip_id: tripId, competition_id: competitionId, game_type_id: "gtt_stroke_play",
    name, status: "complete", corrections_open: false, scoring_enabled: true,
    scorecard_schema: { units: { count: holes, label: "hole", metadata: { par, handicap_index: par.map((_, i) => i + 1) } } },
    points_distribution: { type: "placement", values: [6, 3.5, 1.5] }, points_total: 11,
    modifiers: {},
  });
  const groupId = genId("pg");
  await ctx.admin.from("play_groups").insert({ id: groupId, game_id: id, display_name: "Group 1" });
  await ctx.admin.from("game_participants").insert(
    players.map((u) => ({ id: genId("p"), game_id: id, user_id: u, handicap_strokes: 2, play_group_id: groupId }))
  );
  const entries = [];
  for (let h = 1; h <= holes; h++) {
    for (const u of players) {
      entries.push({ id: genId("se"), game_id: id, participant_id: u, participant_type: "user", unit_label: String(h), value: 4 });
    }
  }
  await ctx.admin.from("score_entries").insert(entries);
  await ctx.admin.from("game_results").insert(
    players.map((u, i) => ({ id: genId("gr"), game_id: id, entity_id: u, entity_type: "user", position: i + 1, raw_score: 72 }))
  );
  return id;
}

beforeAll(async () => {
  installFetchProbe();
  ctx = await TestContext.create();
  ownerId = ctx.user.id;
  tripId = await ctx.createTrip("Perf Trip");
  await ctx.addTripMember(tripId, "planner", "Organizer");
  await ctx.addTripMember(tripId, "member", "Member");
  memberId = ctx.getUser("member").id;
  plannerId = ctx.getUser("planner").id;
  competitionId = await ctx.createCompetition(tripId, "Perf Cup", { scoringModel: "match_play" });
}, 120000);

afterAll(async () => {
  globalThis.fetch = realFetch;
  if (gameIds.length) await ctx.admin.from("games").delete().in("id", gameIds);
  await ctx.cleanup();
}, 60000);

describe("PHASE 0 — server cost of the three slow paths", () => {
  it("path 2 — correction: openCorrection + the reads it forces", async () => {
    const gameId = await makeMatchGame("CorrectMe");
    const caller = ctx.caller();
    console.log("\n─── PATH 2: 'Correct a score' (match, 18 holes) ───");
    await measure("games.openCorrection", () => caller.games.openCorrection({ tripId, gameId }), true);
    await measure("games.getById", () => caller.games.getById({ tripId, gameId }));
    await measure("games.listByTrip", () => caller.games.listByTrip({ tripId }));
    await measure("competitions.faceBootstrap", () => caller.competitions.faceBootstrap({ tripId }));
    await measure("games.configHash", () => caller.games.configHash({ tripId, gameId }));
    // The blocking pair — what the handler actually awaits before the CTA flips.
    await measure("BLOCKING PAIR (open→getById)", async () => {
      await caller.games.openCorrection({ tripId, gameId });
      await caller.games.getById({ tripId, gameId });
    });
  }, 180000);

  it("path 3 — save scoring changes: finish as a RE-LOCK (already complete)", async () => {
    const matchId = await makeMatchGame("RelockMatch");
    const strokeId = await makeStrokeGame("RelockStroke");
    const caller = ctx.caller();
    console.log("\n─── PATH 3: 'Save scoring changes' (re-lock — wasAlreadyComplete) ───");
    await caller.games.openCorrection({ tripId, gameId: matchId });
    await measure("games.finish  MATCH re-lock", () => caller.games.finish({ tripId, gameId: matchId }), true);
    await caller.games.openCorrection({ tripId, gameId: strokeId });
    await measure("games.finish  STROKE re-lock", () => caller.games.finish({ tripId, gameId: strokeId }), true);
    console.log("\n─── what the client awaits AFTER finish returns ───");
    await measure("games.getById (match)", () => caller.games.getById({ tripId, gameId: matchId }));
    await measure("competitions.leaderboard", () => caller.competitions.leaderboard({ tripId, competitionId }));
    await measure("competitions.faceBootstrap", () => caller.competitions.faceBootstrap({ tripId }));
    await measure("scores.listByGame (match)", () => caller.scores.listByGame({ tripId, gameId: matchId }));
    await measure("FULL CLIENT CASCADE (match re-lock)", async () => {
      await caller.games.openCorrection({ tripId, gameId: matchId });
      await caller.games.finish({ tripId, gameId: matchId });
      await caller.games.getById({ tripId, gameId: matchId });
      await Promise.all([
        caller.competitions.leaderboard({ tripId, competitionId }),
        caller.games.listByTrip({ tripId }),
        caller.competitions.faceBootstrap({ tripId }),
      ]);
    });
  }, 300000);

  it("path 1 — Home: what /dashboard's own data costs", async () => {
    const caller = ctx.caller();
    console.log("\n─── PATH 1: Home (/dashboard) server data ───");
    await measure("trips.list", () => caller.trips.list());
  }, 120000);
});
