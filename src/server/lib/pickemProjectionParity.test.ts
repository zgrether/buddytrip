import { describe, it, expect } from "vitest";
import { computeCompetitionLeaderboard } from "./competitionLeaderboard";
import { computePickemResults } from "./pickemResults";

/**
 * PROJECTION == FINALIZE, for pick'em (3c; rulings 13 and 14, and the PR 3 test
 * "projection at the final state equals finalize, for every format fixture").
 *
 * ONE fake database, read by BOTH paths:
 *   - the board's live projection, through `computeCompetitionLeaderboard` →
 *     `computeLiveProjections` → `projectPickem` — which also proves the
 *     leaderboard's live filter admits pick'em at all;
 *   - the real finalize, `computePickemResults`, whose returned `awards` are
 *     what it writes.
 *
 * The slate deliberately leaves one contest UNRESOLVED. Finalize voids it (a
 * real write, captured here) before it scores, and the projection scores it
 * void too. That is NOT visible in any award — `pickPoints` pays 0 on a null
 * result and on `cancelled` alike, which a mutant removing the fold proved by
 * leaving every award green — so the one place it shows, finalize's
 * `unresolved` count, is asserted directly.
 *
 * Built by the app's own builder on both sides (`buildPickemFinalizeInput`),
 * which is the point — but a test that only called that builder twice would be
 * a tautology. This drives the two real entry points over the same rows, so a
 * divergence anywhere between the tables and the award (the reads, the filter,
 * `pointsMode`'s source, the team map) shows up as unequal numbers.
 */

const COMP = "c1";
const GAME = "pk1";
const BLUE = "tBlue";
const RED = "tRed";

type Rows = Record<string, unknown>[];

interface Extra {
  rollUp?: "team_totals" | "individual_matches";
  assignments?: Rows;
  picks?: Rows;
  matches?: Rows;
}

function db(scoringModel: "match_play" | "points", distribution: unknown, extra: Extra = {}) {
  const writes: { rpc: unknown[]; voided: unknown[] } = { rpc: [], voided: [] };
  const tables: Record<string, Rows> = {
    teams: [
      { id: BLUE, name: "Blue", short_name: "BLU", color: "#3b82f6", competition_id: COMP },
      { id: RED, name: "Red", short_name: "RED", color: "#ef4444", competition_id: COMP },
    ],
    competitions: [{ id: COMP, defending_team_id: null, scoring_model: scoringModel }],
    games: [{
      id: GAME, name: "Pick'em", competition_id: COMP, points_distribution: distribution,
      points_total: 8, status: "active", game_type_id: "gtt_pickem",
      competition_format: null, course_id: null, back_course_id: null, scoring_enabled: true,
      entry_mode: "score", corrections_open: false, display_order: 1, config: {}, modifiers: {},
      bracket_config: {}, rules_for_today: null, scorecard_schema: null, tee_time: null,
    }],
    team_assignments: [
      ...(extra.assignments ?? []),
      { user_id: "alice", team_id: BLUE, competition_id: COMP },
      { user_id: "bob", team_id: RED, competition_id: COMP },
    ],
    pickem_games: [{
      game_id: GAME, picks_opened_at: "2026-09-01T00:00:00Z", picks_deadline: null,
      picks_locked_at: "2026-09-02T00:00:00Z", roll_up: extra.rollUp ?? "team_totals", use_confidence: true,
    }],
    pickem_slate_games: [
      { game_id: GAME, id: "s1", multiplier: 1, result: "home" },
      { game_id: GAME, id: "s2", multiplier: 2, result: "away" },
      { game_id: GAME, id: "s3", multiplier: 1, result: null }, // unresolved → void
    ],
    pickem_picks: [
      ...(extra.picks ?? []),
      { game_id: GAME, user_id: "alice", slate_game_id: "s1", pick: "home", confidence: 3 },
      { game_id: GAME, user_id: "alice", slate_game_id: "s2", pick: "home", confidence: 1 },
      { game_id: GAME, user_id: "alice", slate_game_id: "s3", pick: "away", confidence: 2 },
      { game_id: GAME, user_id: "bob", slate_game_id: "s1", pick: "away", confidence: 1 },
      { game_id: GAME, user_id: "bob", slate_game_id: "s2", pick: "away", confidence: 3 },
      { game_id: GAME, user_id: "bob", slate_game_id: "s3", pick: "home", confidence: 2 },
    ],
    game_results: [],
    game_matches: extra.matches ?? [],
    game_participants: [], play_groups: [], game_started: [{ game_id: GAME }],
    bracket_entrants: [], score_entries: [], match_hole_outcomes: [],
  };

  function table(name: string) {
    let cur = [...tables[name]];
    let pendingUpdate: Record<string, unknown> | null = null;
    const api: Record<string, unknown> = {
      select: () => api,
      eq: (k: string, v: unknown) => { cur = cur.filter((r) => r[k] === v); return api; },
      in: (k: string, vals: unknown[]) => {
        if (pendingUpdate) {
          writes.voided.push(...vals);
          return Promise.resolve({ data: null, error: null });
        }
        cur = cur.filter((r) => vals.includes(r[k]));
        return api;
      },
      update: (patch: Record<string, unknown>) => { pendingUpdate = patch; return api; },
      order: () => api,
      maybeSingle: async () => ({ data: cur[0] ?? null, error: null }),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
        Promise.resolve({ data: cur, error: null }).then(res, rej),
    };
    return api;
  }

  const client = {
    from: (n: string) => {
      if (!(n in tables)) throw new Error(`fake client has no table "${n}"`);
      return table(n);
    },
    rpc: async (fn: string, args: unknown) => { writes.rpc.push({ fn, args }); return { data: null, error: null }; },
  };
  return { client, writes };
}

async function both(scoringModel: "match_play" | "points", distribution: unknown, extra: Extra = {}) {
  const { client, writes } = db(scoringModel, distribution, extra);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const board = await computeCompetitionLeaderboard(client as any, COMP);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const finalized = await computePickemResults(client as any, GAME, { onFailure: "throw" });
  return {
    projection: board.projections[GAME],
    awards: Object.fromEntries(finalized.awards),
    unresolved: finalized.unresolved,
    writes,
  };
}

describe("pick'em: the board's projection is what finalize pays", () => {
  it("match-play cup, team totals — equal, and equal to the hand-worked 0 / 8", async () => {
    const r = await both("match_play", null);
    expect(r.projection).toEqual(r.awards);
    // The numbers themselves, so "equal" cannot be two identical wrong answers.
    expect(r.awards).toEqual({ [BLUE]: 0, [RED]: 8 });
    // Finalize really did void the unresolved contest the projection scored as void.
    expect(r.writes.voided).toEqual(["s3"]);
    // …and scored as VOID, not as unresolved. `pickPoints` pays 0 either way, so
    // no award can show this; the count is the one place the fold is visible,
    // and it was 0 before `buildPickemFinalizeInput` was extracted.
    expect(r.unresolved).toBe(0);
  });

  it("points cup, schedule [6, 2] — equal, and equal to the hand-worked 2 / 6", async () => {
    const r = await both("points", { type: "placement", values: [6, 2] });
    expect(r.projection).toEqual(r.awards);
    expect(r.awards).toEqual({ [BLUE]: 2, [RED]: 6 });
  });
});

/**
 * #1419 — an empty side, through BOTH real entry points.
 *
 * Individual matches, 3 paired matches, points_total 8 → an even share of 8/3:
 *   m1  alice (Blue, 3) v bob (Red, 6)  → a real contest, Red wins   → Red   8/3
 *   m2  carol v dave, NEITHER submitted → nobody                      → —
 *   m3  erin (Blue, submitted, all wrong = 0) v finn (none) → FORFEIT → Blue  8/3
 *
 * The old build halved m2 and m3 at 0–0 (4/3 to each side, twice), paying
 * Blue 4/3 + 4/3 = 8/3 and Red 8/3 + 4/3 + 4/3 = 16/3. Fixed: 8/3 each — Red
 * loses the 8/3 it banked for two matches its people never played. erin's zero is the case a
 * points-based presence test would get wrong — it would call her absent and
 * make m3 empty on both sides.
 */
describe("pick'em individual matches: an empty side, projection == finalize (#1419)", () => {
  const u = (id: string) => ({ type: "user", id });
  const extra: Extra = {
    rollUp: "individual_matches",
    assignments: [
      { user_id: "carol", team_id: BLUE, competition_id: COMP },
      { user_id: "erin", team_id: BLUE, competition_id: COMP },
      { user_id: "dave", team_id: RED, competition_id: COMP },
      { user_id: "finn", team_id: RED, competition_id: COMP },
    ],
    // erin: both resolved games picked WRONG → a submitted sheet worth 0.
    picks: [
      { game_id: GAME, user_id: "erin", slate_game_id: "s1", pick: "away", confidence: 1 },
      { game_id: GAME, user_id: "erin", slate_game_id: "s2", pick: "home", confidence: 2 },
    ],
    matches: [
      { id: "m1", game_id: GAME, side_a: u("alice"), side_b: u("bob"), point_value: null, result: null },
      { id: "m2", game_id: GAME, side_a: u("carol"), side_b: u("dave"), point_value: null, result: null },
      { id: "m3", game_id: GAME, side_a: u("erin"), side_b: u("finn"), point_value: null, result: null },
    ],
  };

  it("projection and finalize agree, and both pay 8/3 to each side — not 16/3", async () => {
    const r = await both("match_play", null, extra);
    expect(r.projection).toEqual(r.awards);
    expect(r.awards[BLUE]).toBeCloseTo(8 / 3, 10);
    expect(r.awards[RED]).toBeCloseTo(8 / 3, 10);
  });
});
