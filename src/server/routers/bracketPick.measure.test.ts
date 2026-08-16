import { describe, it, beforeAll, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";
import { buildDraw } from "../../lib/bracket";
import { resolveDraw, matchKey } from "../../lib/bracketAdvance";

/**
 * PHASE 0 MEASUREMENT — what one bracket pick costs (spec item 7).
 *
 * Excluded from the default suite by filename (`*.measure.test.ts`) and opted
 * back in with `MEASURE=1`, the same switch every other measurement here uses.
 * It prints; it does not assert.
 *
 *     MEASURE=1 npx vitest run src/server/routers/bracketPick.measure.test.ts
 *
 * ── What is being measured, and why this shape ──────────────────────────────
 * #829 established that the transferable figure is the **number of sequential
 * DB round trips**, not the local wall clock: the local stack answers in ~1ms,
 * so a chain of N dependent queries costs ~N ms here and ~N × RTT in prod. The
 * `criticalPath` / `waterfall` helpers below are lifted unchanged from
 * `slowPaths.measure.test.ts` so the two runs are directly comparable.
 *
 * The bracket adds a SECOND question that a per-procedure timing cannot answer.
 * A pick invalidates four queries, and all four share one `httpBatchLink`
 * (`src/lib/providers.tsx` splits out `games.configHash` and nothing else). A
 * batch resolves at the speed of its slowest member — the property CLAUDE.md #16
 * records as a measured 0.5s → 21s regression — so the figure that decides
 * whether the check-mark paints quickly is not `bracketDraw`'s own cost but the
 * MAX across everything sharing its tick. Both are reported.
 *
 * ── TWO THINGS THIS FILE OVERSTATES, ON PURPOSE ─────────────────────────────
 * Read the numbers with both in mind; they are why "TAP → all four settled" is
 * an upper bound rather than what a real tap costs.
 *
 *   1. **The four do not share a tick.** `bracketDraw` is invalidated inline by
 *      `pickWinner.onSuccess`; the other three arrive via migration 118's
 *      broadcast through `invalidationCoalescer`'s 100 ms trailing window. The
 *      window SEPARATES the ticks rather than merging them, so the coalescer
 *      costs ≤100 ms and never delays the check-mark. The batched-together row
 *      is the pessimistic case (a broadcast landing in the same tick), kept
 *      because it bounds the damage if that timing ever changes.
 *
 *   2. **`scores.listByGame` is INERT on a bracket page.** It is queried only by
 *      the three golf views (`MatchGameView` / `RackGameView` /
 *      `StrokeGameView`); no non-golf surface mounts it. React Query refetches
 *      only ACTIVE queries on invalidate, so on a bracket that key has no
 *      observer and no request is issued. This file calls it directly through
 *      the tRPC caller, which forces the round trip a browser would skip.
 *
 * The second one is worth stating loudly because it looks like obvious waste —
 * a bracket writes no `score_entries` at all, so invalidating them reads as a
 * bug. It costs nothing, and "fixing" it would mean teaching the deliberately
 * format-agnostic score-event handler about formats (a two-sided trigger/client
 * contract, per CLAUDE.md #20) to save zero requests.
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
      if (sorted[j].end <= r.start + 0.001) best = Math.max(best, depths[j]);
    }
    depths[i] = best + 1;
    max = Math.max(max, depths[i]);
  });
  return max;
}

function maxInFlight(reqs: Req[]): number {
  const events = reqs
    .flatMap((r) => [{ t: r.start, d: 1 }, { t: r.end, d: -1 }])
    .sort((a, b) => a.t - b.t || a.d - b.d);
  let cur = 0, max = 0;
  for (const e of events) { cur += e.d; max = Math.max(max, cur); }
  return max;
}

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

const results: Record<string, { wall: number; depth: number; reqs: number }> = {};

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
  results[name] = { wall, depth, reqs: reqs.length };
  const byTable = reqs.reduce<Record<string, number>>((a, r) => ((a[r.path] = (a[r.path] ?? 0) + 1), a), {});
  const tables = Object.entries(byTable)
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => `${t}×${n}`)
    .join(" ");
  const projections = RTT_PROFILES.map((rtt) => `${rtt}ms:${Math.round(wall + depth * rtt)}ms`).join("  ");
  console.log(
    `${name.padEnd(38)} wall ${wall.toFixed(0).padStart(5)}ms | reqs ${String(reqs.length).padStart(3)} | ` +
      `maxInFlight ${maxInFlight(reqs)} | CRITICAL PATH ${String(depth).padStart(2)} | ${projections}\n` +
      `${" ".repeat(40)}${tables}` +
      (detail ? `\n${waterfall(reqs)}` : "")
  );
  return out;
}

const CARD = "gtt_generic_card";

let ctx: TestContext;
let tripId: string;
let competitionId: string;
let teamA: string, teamB: string;
let owner: string, planner: string, member: string, outsider: string;
const gameIds: string[] = [];

interface Entrant {
  seed: number;
  teamId: string | null;
  userIds: string[];
}

async function newBracket(name: string, entrants: Entrant[]): Promise<string> {
  const g = (await ctx.caller().games.create({ tripId, gameTypeId: CARD, name, competitionId })) as { id: string };
  gameIds.push(g.id);
  const hash = (await ctx.caller().games.configHash({ tripId, gameId: g.id })).hash;
  await ctx.caller().games.saveConfig({
    tripId,
    gameId: g.id,
    baseHash: hash,
    payload: {
      name,
      rulesForToday: null,
      scoringEnabled: true,
      pointsTotal: 4,
      pointsDistribution: null,
      courseId: null,
      backCourseId: null,
      scorecardSchema: null,
      delegates: [],
      competitionFormat: "bracket" as const,
      bracketConfig: {
        elimination: "single" as const,
        entrants: "singles" as const,
        seeding: "manual" as const,
        consolation: false,
      },
      bracketEntrants: entrants,
      bracketDraw: buildDraw(entrants.length),
    },
  });
  return g.id;
}

/**
 * A finalized 1v1 match game — ballast, so `competitions.leaderboard` has the
 * live-projection work a real cup gives it. Measuring a pick against an
 * otherwise-empty competition would understate the batch's slowest member,
 * which is the whole question here.
 */
async function makeMatchGame(name: string, holes = 18): Promise<string> {
  const id = genId("bperf-match");
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
    { id: genId("p"), game_id: id, user_id: owner, handicap_strokes: 3 },
    { id: genId("p"), game_id: id, user_id: member, handicap_strokes: 0 },
  ]);
  const entries = [];
  for (let h = 1; h <= holes; h++) {
    entries.push(
      { id: genId("se"), game_id: id, participant_id: owner, participant_type: "user", unit_label: String(h), value: 4 },
      { id: genId("se"), game_id: id, participant_id: member, participant_type: "user", unit_label: String(h), value: 5 }
    );
  }
  await ctx.admin.from("score_entries").insert(entries);
  await ctx.admin.from("game_matches").insert({
    id: genId("gm"), game_id: id, match_number: 1, display_order: 0,
    side_a: { type: "user", id: owner }, side_b: { type: "user", id: member },
    result: "a_win", margin: "18up", status: "complete",
  });
  await ctx.admin.from("game_results").insert([
    { id: genId("gr"), game_id: id, entity_id: owner, entity_type: "user", position: 1, raw_score: 18 },
    { id: genId("gr"), game_id: id, entity_id: member, entity_type: "user", position: 2, raw_score: 0 },
  ]);
  return id;
}

beforeAll(async () => {
  installFetchProbe();
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("Bracket Perf Trip");
  await ctx.addTripMember(tripId, "planner", "Organizer");
  await ctx.addTripMember(tripId, "member", "Member");
  await ctx.addTripMember(tripId, "outsider", "Member");
  owner = ctx.user.id;
  planner = ctx.getUser("planner").id;
  member = ctx.getUser("member").id;
  outsider = ctx.getUser("outsider").id;
  competitionId = await ctx.createCompetition(tripId, "Bracket Perf Cup", { scoringModel: "match_play" });
  teamA = await ctx.createTeam(competitionId, "Manhattans");
  teamB = await ctx.createTeam(competitionId, "Old Fashioneds");
}, 180000);

afterAll(async () => {
  globalThis.fetch = realFetch;
  if (gameIds.length > 0) {
    await ctx.admin.from("bracket_matches").delete().in("game_id", gameIds);
    await ctx.admin.from("bracket_entrants").delete().in("game_id", gameIds);
    await ctx.admin.from("games").delete().in("id", gameIds);
  }
  await ctx.cleanup();
}, 120000);

describe("PHASE 0 — what one bracket pick costs", () => {
  it("measures the pick, and the four queries it invalidates", async () => {
    // Ballast first, so the leaderboard has real work to do.
    await makeMatchGame("Ballast 1");
    await makeMatchGame("Ballast 2");

    const eight: Entrant[] = [
      { seed: 1, teamId: teamA, userIds: [owner] },
      { seed: 2, teamId: teamB, userIds: [planner] },
      { seed: 3, teamId: teamA, userIds: [member] },
      { seed: 4, teamId: teamB, userIds: [outsider] },
      { seed: 5, teamId: teamA, userIds: [owner] },
      { seed: 6, teamId: teamB, userIds: [planner] },
      { seed: 7, teamId: teamA, userIds: [member] },
      { seed: 8, teamId: teamB, userIds: [outsider] },
    ];
    const gameId = await newBracket("Perf Bracket", eight);
    const caller = ctx.caller();

    console.log("\n─── ITEM 7: the pick MUTATION itself ───");
    await measure(
      "games.pickWinner",
      () => caller.games.pickWinner({ tripId, gameId, bracket: "main", round: 1, slot: 1, winnerSeed: 1 }),
      true
    );

    /**
     * The CASCADING pick — the one the clear-cascade added.
     *
     * It issues a SECOND write (nulling the orphaned downstream picks) and must
     * still cost four sequential levels: the two writes touch disjoint rows, so
     * they go out together rather than one after the other. If this ever prints
     * 5, the cascade has been made to cost a round trip on the path that was
     * just made instant.
     */
    console.log("\n─── a CASCADING pick (clears a downstream result) ───");
    await caller.games.pickWinner({ tripId, gameId, bracket: "main", round: 1, slot: 2, winnerSeed: 5 });
    // RESOLVE first: `bracketDraw` returns stored rows, and a round-2 row's
    // seats are always null there because occupants are derived.
    const stored = await caller.games.bracketDraw({ tripId, gameId });
    const semi = resolveDraw(
      stored.map((m) => ({ bracket: m.bracket, round: m.round, slot: m.slot, aSeed: m.aSeed, bSeed: m.bSeed })),
      Object.fromEntries(stored.map((m) => [matchKey(m), m.winnerSeed]))
    ).find((m) => m.bracket === "main" && m.round === 2 && m.aSeed !== null && m.bSeed !== null);
    if (!semi) throw new Error("measurement setup: expected a decidable round-2 match");
    await caller.games.pickWinner({ tripId, gameId, bracket: "main", round: 2, slot: semi.slot, winnerSeed: semi.aSeed! });
    await measure(
      "games.pickWinner (CASCADING)",
      // Clearing round 1 slot 1 orphans the round-2 pick made just above.
      () => caller.games.pickWinner({ tripId, gameId, bracket: "main", round: 1, slot: 1, winnerSeed: null }),
      true
    );

    console.log("\n─── the four queries a pick invalidates ───");
    console.log("    bracketDraw  ← games.pickWinner.onSuccess (the one that paints the check)");
    console.log("    the other three ← migration 118's broadcast → useRealtimeScoreEvents\n");
    await measure("games.bracketDraw", () => caller.games.bracketDraw({ tripId, gameId }));
    await measure("competitions.faceBootstrap", () => caller.competitions.faceBootstrap({ tripId }));
    await measure("competitions.leaderboard", () => caller.competitions.leaderboard({ tripId, competitionId }));
    await measure("scores.listByGame", () => caller.scores.listByGame({ tripId, gameId }));

    /** An undecided round-1 match, taken from the draw rather than hardcoded —
     *  `buildDraw`'s seed order is its business, not this file's. */
    async function nextOpen(): Promise<{ slot: number; seed: number }> {
      const draw = await caller.games.bracketDraw({ tripId, gameId });
      const m = draw.find(
        (x) => x.bracket === "main" && x.round === 1 && x.winnerSeed === null && x.aSeed !== null && x.bSeed !== null
      )!;
      return { slot: m.slot, seed: m.aSeed! };
    }

    console.log("\n─── ONE TAP, end to end (mutation, then the invalidated set) ───");
    const tap1 = await nextOpen();
    await measure("TAP → all four settled", async () => {
      await caller.games.pickWinner({ tripId, gameId, bracket: "main", round: 1, slot: tap1.slot, winnerSeed: tap1.seed });
      await Promise.all([
        caller.games.bracketDraw({ tripId, gameId }),
        caller.competitions.faceBootstrap({ tripId }),
        caller.competitions.leaderboard({ tripId, competitionId }),
        caller.scores.listByGame({ tripId, gameId }),
      ]);
    });

    console.log("\n─── the same tap if bracketDraw did NOT share the batch ───");
    const tap2 = await nextOpen();
    await measure("TAP → bracketDraw only", async () => {
      await caller.games.pickWinner({ tripId, gameId, bracket: "main", round: 1, slot: tap2.slot, winnerSeed: tap2.seed });
      await caller.games.bracketDraw({ tripId, gameId });
    });

    console.log("\n─── REPLACEMENT: switching the winner without clearing first ───");
    console.log("    (item 8 — does the server already accept it?)\n");
    const target = (await caller.games.bracketDraw({ tripId, gameId })).find(
      (m) => m.bracket === "main" && m.round === 1 && m.winnerSeed !== null && m.aSeed !== null && m.bSeed !== null
    )!;
    const other = target.winnerSeed === target.aSeed ? target.bSeed! : target.aSeed!;
    await measure("pickWinner (straight replace)", () =>
      caller.games.pickWinner({ tripId, gameId, bracket: "main", round: 1, slot: target.slot, winnerSeed: other })
    );
    const after = (await caller.games.bracketDraw({ tripId, gameId })).find(
      (m) => m.bracket === "main" && m.round === 1 && m.slot === target.slot
    )!;
    console.log(
      `    winner ${target.winnerSeed} → ${other}: server returned ${after.winnerSeed === other ? "ACCEPTED" : "REJECTED"}` +
        ` (draw now reads seed ${after.winnerSeed})`
    );

    console.log("\n─── SUMMARY ───");
    const line = (k: string) =>
      results[k]
        ? `${k.padEnd(30)} wall ${results[k].wall.toFixed(0).padStart(5)}ms  depth ${String(results[k].depth).padStart(2)}  reqs ${results[k].reqs}`
        : `${k}  (not measured)`;
    for (const k of [
      "games.pickWinner",
      "games.bracketDraw",
      "competitions.faceBootstrap",
      "competitions.leaderboard",
      "scores.listByGame",
      "TAP → all four settled",
      "TAP → bracketDraw only",
    ]) {
      console.log(`    ${line(k)}`);
    }
  }, 600000);
});
