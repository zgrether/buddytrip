import { describe, it, expect } from "vitest";
import { computeCompetitionLeaderboard } from "./competitionLeaderboard";
import { computeLiveProjections } from "./liveProjection";

/**
 * THE `points_distribution` CONVENTION COLLAPSE — one class, three doors.
 *
 * `standingsByGame` USED TO fold two opposite conventions into one number with
 * `position ?? raw_score`: `position` ranks LOW-wins, `raw_score` is points and
 * ranks HIGH-wins. Past that line nothing could tell them apart, and each arm
 * picked its `direction` independently with nothing checking the two agreed.
 *
 * The `isPlacement` arm ranks `low_wins`. Handed a legitimate winner-takes-all
 * `[8]` on a game whose rows carry `position = NULL`, it paid the whole pot
 * to the side that won LEAST. That is #1245's exact mechanism in the arm
 * immediately below the one #1245 patched.
 *
 * Lived on bbmi.app, BBMI 2026, 2026-09-12: Cornhole won 3 matches of 4 and the
 * board paid 8-0 to the other side. Repaired in DATA that day (the row now
 * carries `per_match`) and FIXED IN CODE by #1381: the rows' convention now
 * travels with the standings and `reconcileConvention` ranks by it, so the
 * `isPlacement` arm can no longer re-rank points as places.
 *
 * ── Why a fake client rather than the local stack ───────────────────────────
 *
 * The condition under test is a COLUMN VALUE (`points_distribution`'s shape)
 * against a specific set of standings. The ids are BBMI 2026's own, so the case
 * pinned here is the production case, not a reconstruction of it.
 *
 * ── The fixture rows carry `value_kind` because the real writers do ───────
 *
 * Migration 191 made it NOT NULL, so a row without one cannot exist in the
 * database. Leaving it off here would have kept every case green while
 * silently measuring `resolveConvention`'s UNDECLARED fallback instead of the
 * path production takes — a fixture that does not send what the real caller
 * sends, reporting a confident number about a path that does not exist. The
 * MIXED cases declare one of each ON PURPOSE: rows disagreeing with each other
 * is what `mixed` means, and it is still distinct from a row disagreeing with
 * itself (`conflicted`, covered in `resultConvention.test.ts`).
 *
 * ── The characterization tests are gone, as they said they would be ────────
 *
 * This file used to pin the WRONG behaviour (placement paid the loser 8-0, the
 * guard line emitted verbatim, the dev-mode throw, the 0-0 projection), each
 * named so it would go red when the collapse was fixed and be deleted. They
 * went red and were replaced by the correct behaviour below. `per_match pays
 * the WINNER` was the lasting guard and stays.
 */

const COMPETITION = "f1769d45-8c7f-4a86-9b4a-ba0b3277c8e4";
const GAME = "63a0b359-9f99-4382-aa12-9f19cf74b4c0"; // Cornhole
const WINNER = "56a19ee9-5e81-4171-9590-255028e47a76"; // won 3 of 4 matches
const LOSER = "aa3858b3-a0e3-4d04-abdc-5c4085dcac70"; // won 1 of 4

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

type Overrides = { results?: Record<string, unknown>[] };

function fakeClient(distribution: unknown, overrides: Overrides = {}) {
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
    game_results: overrides.results ?? [
      { game_id: GAME, entity_id: WINNER, entity_type: "team", position: null, raw_score: 6, value_kind: "points" },
      { game_id: GAME, entity_id: LOSER, entity_type: "team", position: null, raw_score: 2, value_kind: "points" },
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

/** Run the roll-up in a given NODE_ENV, capturing error and warn lines. */
async function payoutIn(env: "production" | "test", distribution: unknown, overrides: Overrides = {}) {
  const prev = process.env.NODE_ENV;
  const errors: string[] = [];
  const warns: string[] = [];
  const realError = console.error;
  const realWarn = console.warn;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process.env as any).NODE_ENV = env;
  console.error = (...a: unknown[]) => { errors.push(String(a[0])); };
  console.warn = (...a: unknown[]) => { warns.push(String(a[0])); };
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await computeCompetitionLeaderboard(fakeClient(distribution, overrides) as any, COMPETITION);
    const cell = (teamId: string) => out.cells.find((c) => c.gameId === GAME && c.teamId === teamId)?.points ?? null;
    return { winner: cell(WINNER), loser: cell(LOSER), totals: out.teamTotals, errors, warns };
  } finally {
    console.error = realError;
    console.warn = realWarn;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process.env as any).NODE_ENV = prev;
  }
}

describe("points_distribution convention — carried to the ranking (#1381)", () => {
  it("per_match pays the WINNER, and a game whose config agrees with its rows logs nothing", async () => {
    const r = await payoutIn("production", { type: "per_match", value: 2 });
    expect({ winner: r.winner, loser: r.loser }).toEqual({ winner: 6, loser: 2 });
    expect(r.totals).toEqual({ [WINNER]: 6, [LOSER]: 2 });
    expect(r.errors).toEqual([]);
    expect(r.warns).toEqual([]);
  });

  it("THE CORNHOLE CASE: a placement [8] over points rows pays the points as scored — 6 to the winner", async () => {
    // Before #1381 this paid { winner: 0, loser: 8 } — the BBMI 2026 inversion.
    const r = await payoutIn("production", { type: "placement", values: [8] });
    expect({ winner: r.winner, loser: r.loser }).toEqual({ winner: 6, loser: 2 });
    expect(r.totals).toEqual({ [WINNER]: 6, [LOSER]: 2 });
  });

  it("…and it does not THROW outside production: the ranking is correct now, so a dev run must not blank the board", async () => {
    const r = await payoutIn("test", { type: "placement", values: [8] });
    expect({ winner: r.winner, loser: r.loser }).toEqual({ winner: 6, loser: 2 });
  });

  it("…but the reconciliation SAYS so, with the values, because the game's config disagrees with its results", async () => {
    const r = await payoutIn("production", { type: "placement", values: [8] });
    expect(r.errors).toEqual([]);
    expect(r.warns).toHaveLength(1);
    const line = r.warns[0];
    expect(line.startsWith(`[leaderboard] ranking-convention reconciled: game ${GAME}'s results are raw_score POINTS`)).toBe(true);
    const evidence = JSON.parse(line.slice(line.indexOf("Evidence: ") + "Evidence: ".length));
    expect(evidence).toEqual({
      competitionId: COMPETITION,
      gameId: GAME,
      convention: "points",
      armDirection: "low_wins",
      rankedAs: "points",
      standings: [
        { entityId: WINNER, value: 6 },
        { entityId: LOSER, value: 2 },
      ],
      distribution: { type: "placement", values: [8] },
      pointsTotal: 8,
    });
  });

  it("POSITION rows reaching a points arm are paid by PLACE — the mirror of the same collapse", async () => {
    // Positions 1 and 2 under a per_match arm used to pass straight through as
    // "points": the winner got 1 and the loser 2. By place, winner takes the total.
    const r = await payoutIn("production", { type: "per_match", value: 2 }, {
      results: [
        { game_id: GAME, entity_id: WINNER, entity_type: "team", position: 1, raw_score: 1, value_kind: "rank" },
        { game_id: GAME, entity_id: LOSER, entity_type: "team", position: 2, raw_score: 2, value_kind: "rank" },
      ],
    });
    expect({ winner: r.winner, loser: r.loser }).toEqual({ winner: 8, loser: 0 });
    expect(r.warns).toHaveLength(1);
    expect(r.warns[0]).toContain("results are POSITIONS but its arm ranks high_wins");
  });

  it("MIXED rows pay nothing, keep the pool, and log in production", async () => {
    const r = await payoutIn("production", { type: "per_match", value: 2 }, {
      results: [
        { game_id: GAME, entity_id: WINNER, entity_type: "team", position: 1, raw_score: 6, value_kind: "rank" },
        { game_id: GAME, entity_id: LOSER, entity_type: "team", position: null, raw_score: 2, value_kind: "points" },
      ],
    });
    expect({ winner: r.winner, loser: r.loser }).toEqual({ winner: null, loser: null });
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toContain(`ranking-convention unreadable: game ${GAME}`);
  });

  /**
   * ── THE CONFLICTED ARM, AND WHY IT GETS ITS OWN END-TO-END CASES ─────────
   *
   * `conflicted` is a row that disagrees with ITSELF — it declares one
   * `value_kind` and carries the other. Migration 191 made the declaration NOT
   * NULL and every writer stamps the kind its own columns take, so this has
   * never occurred: measured on production the day 191 landed, all 273 rows
   * have declared and contained agreeing.
   *
   * **That is exactly why it needs a test rather than exactly why it does not.**
   * From the moment a consumer ranks by the declaration, this arm is the only
   * thing between a wrong declaration and a wrong payout — and it is a guard
   * nobody has ever watched fail. A guard with no red proof is the shape this
   * codebase keeps finding: green because it is right, or green because it
   * cannot fire, and the two are indistinguishable from the outside.
   *
   * So the fixture writes the contradiction by hand — the only way to produce
   * it, since no writer will — and the assertions are that the board refuses to
   * rank it, says which game, and says the RIGHT thing about why.
   */
  it("CONFLICTED rows pay nothing: a row declaring points while carrying a position", async () => {
    const r = await payoutIn("production", { type: "per_match", value: 2 }, {
      results: [
        // Both rows declare POINTS. Both carry a POSITION. Under the per_match
        // arm these would otherwise rank high_wins on raw_score and pay 6 and 2
        // — which is what a build WITHOUT this arm does, and is the mutant.
        { game_id: GAME, entity_id: WINNER, entity_type: "team", position: 1, raw_score: 6, value_kind: "points" },
        { game_id: GAME, entity_id: LOSER, entity_type: "team", position: 2, raw_score: 2, value_kind: "points" },
      ],
    });
    expect({ winner: r.winner, loser: r.loser }).toEqual({ winner: null, loser: null });
  });

  it("…and it is reported as a CONTRADICTION, never as the mixed message", async () => {
    const r = await payoutIn("production", { type: "per_match", value: 2 }, {
      results: [
        { game_id: GAME, entity_id: WINNER, entity_type: "team", position: 1, raw_score: 6, value_kind: "points" },
        { game_id: GAME, entity_id: LOSER, entity_type: "team", position: 2, raw_score: 2, value_kind: "points" },
      ],
    });
    // TWO lines, and they are different facts: `resolveConvention` reports the
    // contradiction itself (which game, declared vs contained), and the arm
    // reports that it therefore ranked nothing.
    expect(r.errors.some((e) => e.includes("contradict their own declaration"))).toBe(true);
    expect(r.errors.some((e) => e.includes("ranking-convention contradicted"))).toBe(true);
    // NOT the mixed wording. `mixed` is rows disagreeing with EACH OTHER — a
    // half-rewritten game — and sends a reader to the game's history. This sends
    // them to the writer. A widened condition under an unchanged message is how
    // a refusal starts naming the wrong object.
    expect(r.errors.some((e) => e.includes("carrying BOTH positions and raw_score"))).toBe(false);
    expect(r.errors.some((e) => e.includes("ranking-convention unreadable"))).toBe(false);
  });

  it("…and the contradiction is caught in the OTHER direction too", async () => {
    // Declares rank, carries no position. The mirror case: a build that only
    // checked one direction would pass every case above and fail here.
    const r = await payoutIn("production", { type: "per_match", value: 2 }, {
      results: [
        { game_id: GAME, entity_id: WINNER, entity_type: "team", position: null, raw_score: 6, value_kind: "rank" },
        { game_id: GAME, entity_id: LOSER, entity_type: "team", position: null, raw_score: 2, value_kind: "rank" },
      ],
    });
    expect({ winner: r.winner, loser: r.loser }).toEqual({ winner: null, loser: null });
    expect(r.errors.some((e) => e.includes("ranking-convention contradicted"))).toBe(true);
  });

  it("CONFLICTED rows THROW outside production, exactly as mixed rows do", async () => {
    // The dev-run half. Same reasoning as the mixed case directly above: a
    // write nobody can interpret must not pass a local run quietly.
    await expect(
      payoutIn("test", { type: "per_match", value: 2 }, {
        results: [
          { game_id: GAME, entity_id: WINNER, entity_type: "team", position: 1, raw_score: 6, value_kind: "points" },
          { game_id: GAME, entity_id: LOSER, entity_type: "team", position: 2, raw_score: 2, value_kind: "points" },
        ],
      })
    ).rejects.toThrow(`ranking-convention contradicted: game ${GAME}`);
  });

  it("MIXED rows THROW outside production, so a dev run cannot miss an unreadable write", async () => {
    await expect(
      payoutIn("test", { type: "per_match", value: 2 }, {
        results: [
          { game_id: GAME, entity_id: WINNER, entity_type: "team", position: 1, raw_score: 6, value_kind: "rank" },
          { game_id: GAME, entity_id: LOSER, entity_type: "team", position: null, raw_score: 2, value_kind: "points" },
        ],
      })
    ).rejects.toThrow(`ranking-convention unreadable: game ${GAME}`);
  });
});

/**
 * SAME ROOT CAUSE, SECOND AND THIRD DOORS. The live projection gated the award
 * on `isPerMatch`, so a placement-carrying Matches game projected 0-0 while
 * live — and 0-0 reads as "not started", which is why the inversion stayed
 * invisible until finalize. The projection now mirrors its writer (which pays
 * from `points_total` whatever the shape), and a game with nothing to divide
 * projects NOTHING rather than zero.
 */
describe("points_distribution convention — live projection (#1381)", () => {
  const input = (isPerMatch: boolean, legacyValue: number | null, pointsTotal: number | null = 8) => ({
    id: GAME, gameTypeId: "gtt_generic_yard", competitionFormat: "matches",
    pointsTotal, isPerMatch, legacyValue, outcomeMode: false,
  });

  it("per_match projects the real split — the positive control", async () => {
    const out = await computeLiveProjections(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fakeClient({ type: "per_match", value: 2 }) as any, COMPETITION, [input(true, 2)]
    );
    expect(out[GAME]).toEqual({ [WINNER]: 6, [LOSER]: 2 });
  });

  it("a placement-carrying Matches game projects the SAME split — not 0-0", async () => {
    const out = await computeLiveProjections(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fakeClient({ type: "placement", values: [8] }) as any, COMPETITION, [input(false, null)]
    );
    expect(out[GAME]).toEqual({ [WINNER]: 6, [LOSER]: 2 });
  });

  it("with nothing to divide (no total, no legacy value, no overrides) it projects NOTHING, not 0-0", async () => {
    const out = await computeLiveProjections(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fakeClient(null) as any, COMPETITION, [input(false, null, null)]
    );
    expect(GAME in out).toBe(false);
  });
});
