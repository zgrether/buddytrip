import { describe, it, expect } from "vitest";
import { computeCompetitionLeaderboard } from "./competitionLeaderboard";
import { computeLiveProjections } from "./liveProjection";

/**
 * THE `points_distribution` CONVENTION COLLAPSE — one class, three doors.
 *
 * `standingsByGame` folds two opposite conventions into one number with
 * `position ?? raw_score`: `position` ranks LOW-wins, `raw_score` is points and
 * ranks HIGH-wins. Past that line nothing can tell them apart, and each arm
 * picks its `direction` independently with nothing checking the two agree.
 *
 * The `isPlacement` arm ranks `low_wins`. Hand it a legitimate winner-takes-all
 * `[8]` on a game whose rows carry `position = NULL` and it pays the whole pot
 * to the side that won LEAST. That is #1245's exact mechanism in the arm
 * immediately below the one #1245 patched.
 *
 * Lived on bbmi.app, BBMI 2026, 2026-09-12: Cornhole won 3 matches of 4 and the
 * board paid 8-0 to the other side. Repaired in DATA (the row now carries
 * `per_match`); the CODE is untouched, so the collapse is still there and this
 * file pins it.
 *
 * ── Why a fake client rather than the local stack ───────────────────────────
 *
 * The condition under test is a COLUMN VALUE (`points_distribution`'s shape)
 * against a specific set of standings. A seeded local game can express that,
 * but the thing that makes this test worth having is that it reproduces the
 * PRODUCTION guard line byte for byte — which needs production's own ids. The
 * fake is what lets the real row values sit in front of the real function.
 *
 * ── The ids are real, and that is the point ─────────────────────────────────
 *
 * The competition/game/team ids below are BBMI 2026's. `GUARD_LINE` is the
 * verbatim string this code emitted into the Vercel runtime log while the bug
 * was live. Asserting the whole line — not a substring of it — is what makes
 * this a fidelity oracle rather than a restatement of the code: nothing about
 * the fixture can drift without the assertion noticing.
 *
 * ── WHAT TO DO WHEN THE COLLAPSE IS FIXED ───────────────────────────────────
 *
 * Two tests below are CHARACTERIZATION tests — they assert the CURRENT, WRONG
 * behaviour, and they are named so. They will go red the moment the fix lands.
 * That is deliberate and it is the forcing function: when they fail, delete
 * them and keep `pays the winner` (which must stay green either way).
 */

const COMPETITION = "f1769d45-8c7f-4a86-9b4a-ba0b3277c8e4";
const GAME = "63a0b359-9f99-4382-aa12-9f19cf74b4c0"; // Cornhole
const WINNER = "56a19ee9-5e81-4171-9590-255028e47a76"; // won 3 of 4 matches
const LOSER = "aa3858b3-a0e3-4d04-abdc-5c4085dcac70"; // won 1 of 4

/** The exact line production logged while the bug was live. */
const GUARD_LINE =
  "[leaderboard] ranking-convention mismatch: game 63a0b359-9f99-4382-aa12-9f19cf74b4c0 " +
  "has results with a NULL position (so its values are raw_score POINTS) but is being ranked " +
  "low_wins, which will award the LOWEST scorer first. Evidence: " +
  '{"competitionId":"f1769d45-8c7f-4a86-9b4a-ba0b3277c8e4",' +
  '"gameId":"63a0b359-9f99-4382-aa12-9f19cf74b4c0","direction":"low_wins",' +
  '"standings":[{"entityId":"56a19ee9-5e81-4171-9590-255028e47a76","value":6},' +
  '{"entityId":"aa3858b3-a0e3-4d04-abdc-5c4085dcac70","value":2}],' +
  '"distribution":[8],"pointsTotal":8}';

const PLAYERS = [
  ["u1", WINNER], ["u2", WINNER], ["u3", WINNER], ["u4", WINNER],
  ["u5", LOSER], ["u6", LOSER], ["u7", LOSER], ["u8", LOSER],
] as const;

/** Four cross-team 2v2 matches; the winning team takes three of them. */
const MATCH_SHAPE = [
  { id: "m1", a: "pgA1", b: "pgB1", result: "a_win" },
  { id: "m2", a: "pgA2", b: "pgB2", result: "a_win" },
  { id: "m3", a: "pgA3", b: "pgB3", result: "a_win" },
  { id: "m4", a: "pgA4", b: "pgB4", result: "b_win" },
];

/**
 * Minimal PostgREST-shaped fake: `.eq`/`.in` filter for real so a query that
 * names the wrong column or table cannot quietly match everything, and the
 * builder is thenable exactly as the real one is.
 */
function table(rows: Record<string, unknown>[]) {
  let cur = [...rows];
  const api: Record<string, unknown> = {
    select: () => api,
    eq: (k: string, v: unknown) => { cur = cur.filter((r) => r[k] === v); return api; },
    in: (k: string, vals: unknown[]) => { cur = cur.filter((r) => vals.includes(r[k])); return api; },
    order: () => api,
    maybeSingle: async () => ({ data: cur[0] ?? null, error: null }),
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve({ data: cur, error: null }).then(res, rej),
  };
  return api;
}

function fakeClient(distribution: unknown) {
  const play_groups = MATCH_SHAPE.flatMap((m) => [m.a, m.b]).map((id) => ({
    game_id: GAME, id, handicap_strokes: null,
  }));
  // Two players per side, each side drawn from ONE team — the shape `setPairings`
  // writes, and what makes every match cross-team.
  const game_participants = MATCH_SHAPE.flatMap((m, i) => [
    { game_id: GAME, user_id: PLAYERS[i][0], team_id: null, play_group_id: m.a, handicap_strokes: null },
    { game_id: GAME, user_id: PLAYERS[(i + 4) % 8][0], team_id: null, play_group_id: m.b, handicap_strokes: null },
  ]);
  const tables: Record<string, Record<string, unknown>[]> = {
    teams: [
      { id: WINNER, name: "Winners", short_name: "W", color: "#3b82f6", competition_id: COMPETITION },
      { id: LOSER, name: "Losers", short_name: "L", color: "#f97316", competition_id: COMPETITION },
    ],
    competitions: [{ id: COMPETITION, defending_team_id: null, scoring_model: "match_play" }],
    games: [{
      id: GAME, name: "Cornhole", competition_id: COMPETITION, points_distribution: distribution,
      points_total: 8, status: "complete", game_type_id: "gtt_generic_yard",
      competition_format: "matches", course_id: null, back_course_id: null, scoring_enabled: true,
      entry_mode: "score", corrections_open: false, display_order: 1, config: {}, modifiers: {},
      bracket_config: {}, rules_for_today: null, scorecard_schema: null, tee_time: null,
    }],
    team_assignments: PLAYERS.map(([user_id, team_id]) => ({ user_id, team_id, competition_id: COMPETITION })),
    // position NULL + points in raw_score: exactly what `writeTeamMatchPoints` writes.
    game_results: [
      { game_id: GAME, entity_id: WINNER, entity_type: "team", position: null, raw_score: 6 },
      { game_id: GAME, entity_id: LOSER, entity_type: "team", position: null, raw_score: 2 },
    ],
    game_matches: MATCH_SHAPE.map((m) => ({
      id: m.id, game_id: GAME, point_value: null, result: m.result,
      side_a: { id: m.a, type: "play_group" }, side_b: { id: m.b, type: "play_group" },
    })),
    game_participants,
    play_groups,
    game_started: [{ game_id: GAME }],
    bracket_entrants: [],
    score_entries: [],
    match_hole_outcomes: [],
  };
  return {
    from: (name: string) => {
      if (!(name in tables)) throw new Error(`fake client has no table "${name}"`);
      return table(tables[name]);
    },
  };
}

/** Run the roll-up with the guard on its PRODUCTION branch (log, don't throw). */
async function payout(distribution: unknown) {
  const prev = process.env.NODE_ENV;
  const lines: string[] = [];
  const realError = console.error;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process.env as any).NODE_ENV = "production";
  console.error = (...a: unknown[]) => { lines.push(String(a[0])); };
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await computeCompetitionLeaderboard(fakeClient(distribution) as any, COMPETITION);
    const cell = (teamId: string) => out.cells.find((c) => c.gameId === GAME && c.teamId === teamId)?.points ?? null;
    return { winner: cell(WINNER), loser: cell(LOSER), totals: out.teamTotals, guardLines: lines };
  } finally {
    console.error = realError;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process.env as any).NODE_ENV = prev;
  }
}

describe("points_distribution convention collapse", () => {
  it("per_match pays the WINNER — the guard that must stay green through the fix", async () => {
    const r = await payout({ type: "per_match", value: 2 });
    expect({ winner: r.winner, loser: r.loser }).toEqual({ winner: 6, loser: 2 });
    expect(r.totals).toEqual({ [WINNER]: 6, [LOSER]: 2 });
    expect(r.guardLines).toEqual([]);
  });

  it("CHARACTERIZATION (current WRONG behaviour) — placement pays the LOSER 8-0", async () => {
    // When the collapse is fixed this flips to { winner: 6, loser: 2 }. Delete
    // this test then; `per_match pays the WINNER` above is the lasting guard.
    const r = await payout({ type: "placement", values: [8] });
    expect({ winner: r.winner, loser: r.loser }).toEqual({ winner: 0, loser: 8 });
  });

  it("CHARACTERIZATION (current WRONG behaviour) — emits production's guard line verbatim", async () => {
    // Byte-for-byte the line bbmi.app logged on 2026-09-12. Delete with the test
    // above when the collapse is fixed — a correct arm emits nothing here.
    const r = await payout({ type: "placement", values: [8] });
    expect(r.guardLines).toEqual([GUARD_LINE]);
  });

  it("the guard THROWS outside production, so a dev run cannot miss it", async () => {
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      computeCompetitionLeaderboard(fakeClient({ type: "placement", values: [8] }) as any, COMPETITION)
    ).rejects.toThrow(GUARD_LINE);
  });
});

/**
 * SAME ROOT CAUSE, SECOND DOOR. `liveProjection` gates the per-match award on
 * `isPerMatch`, so a placement-carrying matches game projects zero for every
 * side — and a game that CANNOT compute a projection renders identically to one
 * with nothing yet to project. That is why the payout inversion was invisible
 * for hours before finalize: the board showed 0-0, which reads as "not started".
 *
 * `NonGolfGameView.tsx`'s `matchesPointsPerMatch` is the client mirror of this
 * (`if (dist?.type !== "per_match") return 0`) and fails the same way.
 */
describe("points_distribution convention collapse — live projection", () => {
  const input = (isPerMatch: boolean, legacyValue: number | null) => ({
    id: GAME, gameTypeId: "gtt_generic_yard", competitionFormat: "matches",
    pointsTotal: 8, isPerMatch, legacyValue, outcomeMode: false,
  });

  it("per_match projects the real split — the positive control", async () => {
    const out = await computeLiveProjections(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fakeClient({ type: "per_match", value: 2 }) as any, COMPETITION, [input(true, 2)]
    );
    expect(out[GAME]).toEqual({ [WINNER]: 6, [LOSER]: 2 });
  });

  it("CHARACTERIZATION (current WRONG behaviour) — placement projects 0-0 while live", async () => {
    // Delete when the collapse is fixed; the control above is the lasting guard.
    const out = await computeLiveProjections(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fakeClient({ type: "placement", values: [8] }) as any, COMPETITION, [input(false, null)]
    );
    expect(out[GAME]).toEqual({ [WINNER]: 0, [LOSER]: 0 });
  });
});
