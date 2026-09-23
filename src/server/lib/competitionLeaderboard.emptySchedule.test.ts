import { describe, it, expect } from "vitest";
import { computeCompetitionLeaderboard } from "./competitionLeaderboard";
import { payingSchedule } from "@/lib/pointsDistribution";

/**
 * A SCHEDULE THAT PAYS NOTHING IS NO SCHEDULE (#1410).
 *
 * `effectiveDistribution` returns `[]` for a game worth nothing, and `[]` is
 * truthy. Handed to `placementDetail`, it assigns every team a real PLACE worth
 * zero, and the board's Game-by-game table printed `0 | 0` where "no payout
 * configured" belonged — a decided prize of nothing. Reproduced before this fix
 * by driving the real leaderboard into the real `PointsMatrix` (#1410's RUN
 * comment); `1st · 0 pts`, the symptom the issue was filed with, is printed by
 * no surface at all.
 *
 * The fix is at the SEAM — `reconcileConvention`, which every positions arm
 * passes through — not in the pick'em arm where it was caught. So the cases
 * below are one per ARM that can hand over a schedule paying nothing, plus the
 * control that proves the instrument can tell a real payout from none.
 *
 * `cells` is the assertion, not `teamTotals`: the totals were 0 either way, and
 * a test on them would pass against the unfixed build. The cells are what the
 * table renders.
 */

const COMP = "c1";
const GAME = "g1";
const A = "tA";
const B = "tB";

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

/** A finished game with the RANK rows its finalize writes (position 1 and 2,
 *  rank mirrored into raw_score, as `computePickemResults` and
 *  `writeManualResults` both do). */
function client(game: { gameTypeId: string; pointsTotal: number | null; distribution: unknown }) {
  const tables: Record<string, Record<string, unknown>[]> = {
    teams: [
      { id: A, name: "Alpha", short_name: "ALP", color: "#3b82f6", competition_id: COMP },
      { id: B, name: "Bravo", short_name: "BRV", color: "#f97316", competition_id: COMP },
    ],
    competitions: [{ id: COMP, defending_team_id: null, scoring_model: "points" }],
    games: [{
      id: GAME, name: "G", competition_id: COMP, points_distribution: game.distribution,
      points_total: game.pointsTotal, status: "complete", game_type_id: game.gameTypeId,
      competition_format: null, course_id: null, back_course_id: null, scoring_enabled: true,
      entry_mode: "score", corrections_open: false, display_order: 1, config: {}, modifiers: {},
      bracket_config: {}, rules_for_today: null, scorecard_schema: null, tee_time: null,
    }],
    team_assignments: [],
    game_results: [
      { game_id: GAME, entity_id: A, entity_type: "team", position: 1, raw_score: 1, value_kind: "rank" },
      { game_id: GAME, entity_id: B, entity_type: "team", position: 2, raw_score: 2, value_kind: "rank" },
    ],
    game_matches: [], game_participants: [], play_groups: [], game_started: [{ game_id: GAME }],
    bracket_entrants: [], score_entries: [], match_hole_outcomes: [],
  };
  return {
    from: (n: string) => {
      if (!(n in tables)) throw new Error(`fake client has no table "${n}"`);
      return table(tables[n]);
    },
  };
}

async function cellsFor(game: Parameters<typeof client>[0]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out = await computeCompetitionLeaderboard(client(game) as any, COMP);
  return out.cells
    .filter((c) => c.gameId === GAME)
    .map((c) => ({ teamId: c.teamId, place: c.place, points: c.points }));
}

describe("a schedule that pays nothing emits NO cells (#1410)", () => {
  it("the positive control: a pick'em points-cup game worth 8 pays 8 to first", async () => {
    // If this ever reads [] the instrument is broken, not the fix.
    expect(await cellsFor({ gameTypeId: "gtt_pickem", pointsTotal: 8, distribution: null })).toEqual([
      { teamId: A, place: 1, points: 8 },
      { teamId: B, place: 2, points: 0 },
    ]);
  });

  it("THE #1410 CASE: a pick'em points-cup game worth 0 — `effectiveDistribution` gives []", async () => {
    // Before: [{A, place 1, 0}, {B, place 2, 0}] — the `0 | 0` row.
    expect(await cellsFor({ gameTypeId: "gtt_pickem", pointsTotal: 0, distribution: null })).toEqual([]);
  });

  it("…and with no total at all (null), the same", async () => {
    expect(await cellsFor({ gameTypeId: "gtt_pickem", pointsTotal: null, distribution: null })).toEqual([]);
  });

  it("the placement arm with `[0]` — NOT empty, still pays nothing (stroke's save path writes it for a total of 0)", async () => {
    // The case a `length > 0` check would wave through. Production holds none
    // today (19 of 19 placement games pay a positive value, 2026-09-23); the
    // writer that can produce it is `strokeDraftToPayload`.
    expect(
      await cellsFor({ gameTypeId: "gtt_stroke_play", pointsTotal: 0, distribution: { type: "placement", values: [0] } })
    ).toEqual([]);
  });

  it("a split that pays SOMEBODY is kept whole, zeros included — `[0, 3]` is a payout", async () => {
    // Guards the opposite over-reach: collapsing on "contains a zero" would
    // erase a real schedule whose first place happens to be worth nothing.
    expect(
      await cellsFor({ gameTypeId: "gtt_stroke_play", pointsTotal: 3, distribution: { type: "placement", values: [0, 3] } })
    ).toEqual([
      { teamId: A, place: 1, points: 0 },
      { teamId: B, place: 2, points: 3 },
    ]);
  });
});

describe("payingSchedule — the predicate on its own", () => {
  it("is null for every shape that pays nothing", () => {
    expect(payingSchedule(null)).toBeNull();
    expect(payingSchedule(undefined)).toBeNull();
    expect(payingSchedule([])).toBeNull();
    expect(payingSchedule([0])).toBeNull();
    expect(payingSchedule([0, 0, 0])).toBeNull();
  });

  it("returns the schedule, unchanged, when any place pays", () => {
    expect(payingSchedule([8])).toEqual([8]);
    expect(payingSchedule([0, 3])).toEqual([0, 3]);
    expect(payingSchedule([6, 3.5, 1.5])).toEqual([6, 3.5, 1.5]);
  });
});
