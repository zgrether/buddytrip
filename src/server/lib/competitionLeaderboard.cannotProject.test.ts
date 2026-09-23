import { describe, it, expect } from "vitest";
import { computeCompetitionLeaderboard } from "./competitionLeaderboard";

/**
 * The BOARD's half of "cannot project" (3c): what the payload says about a LIVE
 * game, end to end through `computeCompetitionLeaderboard` →
 * `computeLiveProjections`.
 *
 *  - A projected game names EVERY cup team. The arms report only the teams
 *    they met; the row used to fill the rest with `?? 0`, a number it made up.
 *    The fill now happens server-side, where "this team has no side in this
 *    game" is actually known — so the row can treat a missing key as missing.
 *  - A game that can't project is in `cannotProject` with its reason and is
 *    NOT in `projections`. The two are disjoint.
 *
 * A same-team pairing (Blue v Blue) is what makes the fill observable: the
 * match pays Blue on either result, and Red has no side at all. Pairings are
 * unrestricted in the backend (ruling 10), so this is a real shape, not a
 * contrivance.
 */

const COMP = "c1";
const GAME = "g1";
const BLUE = "tBlue";
const RED = "tRed";

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

/** A LIVE non-golf Matches game (`status: active`, one decided match, so it is
 *  in `game_started`) in a two-team match-play cup. */
function client(pointsTotal: number | null) {
  const tables: Record<string, Record<string, unknown>[]> = {
    teams: [
      { id: BLUE, name: "Blue", short_name: "BLU", color: "#3b82f6", competition_id: COMP },
      { id: RED, name: "Red", short_name: "RED", color: "#ef4444", competition_id: COMP },
    ],
    competitions: [{ id: COMP, defending_team_id: null, scoring_model: "match_play" }],
    games: [{
      id: GAME, name: "Cornhole", competition_id: COMP, points_distribution: null,
      points_total: pointsTotal, status: "active", game_type_id: "gtt_generic_yard",
      competition_format: "matches", course_id: null, back_course_id: null, scoring_enabled: true,
      entry_mode: "score", corrections_open: false, display_order: 1, config: {}, modifiers: {},
      bracket_config: {}, rules_for_today: null, scorecard_schema: null, tee_time: null,
    }],
    team_assignments: [
      { user_id: "alice", team_id: BLUE, competition_id: COMP },
      { user_id: "bob", team_id: BLUE, competition_id: COMP },
      { user_id: "carol", team_id: RED, competition_id: COMP },
    ],
    game_results: [],
    game_matches: [{
      id: "m1", game_id: GAME, point_value: null, result: "a_win",
      side_a: { type: "user", id: "alice" }, side_b: { type: "user", id: "bob" },
    }],
    game_participants: [], play_groups: [], game_started: [{ game_id: GAME }],
    bracket_entrants: [], score_entries: [], match_hole_outcomes: [],
  };
  return {
    from: (n: string) => {
      if (!(n in tables)) throw new Error(`fake client has no table "${n}"`);
      return table(tables[n]);
    },
  };
}

async function board(pointsTotal: number | null) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return computeCompetitionLeaderboard(client(pointsTotal) as any, COMP);
}

describe("the board's live projection payload (3c)", () => {
  it("names EVERY cup team on a projected game — Red, with no side, is an explicit 0, not a missing key", async () => {
    const out = await board(4);
    // One match, even share 4, won by Blue (both sides Blue).
    expect(out.projections[GAME]).toEqual({ [BLUE]: 4, [RED]: 0 });
    expect(GAME in out.cannotProject).toBe(false);
  });

  it("a live game with nothing to award is in `cannotProject` with its reason, and NOT in `projections`", async () => {
    const out = await board(0);
    expect(out.cannotProject[GAME]).toBe("no_points");
    expect(GAME in out.projections).toBe(false);
  });

  it("…the same with no total at all", async () => {
    const out = await board(null);
    expect(out.cannotProject[GAME]).toBe("no_points");
    expect(GAME in out.projections).toBe(false);
  });

  it("a game that can't project contributes nothing to the hero's projected tier", async () => {
    // `hasLiveProjection` gates the whole tier; a cannot-project game is not a
    // projection and must not switch it on.
    const out = await board(0);
    expect(out.hasLiveProjection).toBe(false);
  });
});
