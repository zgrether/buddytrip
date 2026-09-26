import { describe, it, expect } from "vitest";
import { computeCompetitionLeaderboard } from "./competitionLeaderboard";
import { reconcileClinchClaim } from "./gameFinishNotify";

/**
 * #1411 — a failed RESULTS read is an error, never an empty board.
 *
 * Every format's standings come from one `game_results` read. Unchecked, a
 * failure rendered a decided cup as nobody having scored — and since PR 5 an
 * absent row means "wasn't in it", so a failed read faked "didn't play" for
 * every team at once. Now it throws, and each reader gets the failure:
 *
 *  - the board's query errors, and `CompetitionLeaderboard` keeps its last good
 *    data (a failed first load shows "Couldn't load", never an empty board);
 *  - `reconcileClinchClaim` catches it instead of RELEASING a held claim because
 *    the empty board said the holder was no longer decided — which let the next
 *    finalize announce the same clinch twice.
 *
 * The fake client (the same shape `competitionLeaderboard.cannotProject.test`
 * uses) fails ONLY the results read, and a successful-read control runs on the
 * same data, so a red can only come from that one read.
 */

const COMP = "c1";
const GAME = "g1";
const BLUE = "tBlue";
const RED = "tRed";

type Row = Record<string, unknown>;

function table(rows: Row[], fail: string | null) {
  let cur = [...rows];
  const result = () => (fail ? { data: null, error: { message: fail } } : { data: cur, error: null });
  const api: Record<string, unknown> = {
    select: () => api,
    eq: (k: string, v: unknown) => { cur = cur.filter((r) => r[k] === v); return api; },
    is: () => api,
    in: (k: string, vals: unknown[]) => { cur = cur.filter((r) => vals.includes(r[k])); return api; },
    order: () => api,
    maybeSingle: async () => (fail ? { data: null, error: { message: fail } } : { data: cur[0] ?? null, error: null }),
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej),
  };
  return api;
}

/** A cup Blue has DECIDED: one finished 4-point game, all 4 to Blue. */
function client(opts: { failResults: boolean; heldClaim?: string | null; onRpc?: (name: string) => void }) {
  const tables: Record<string, Row[]> = {
    teams: [
      { id: BLUE, name: "Blue", short_name: "BLU", color: "#3b82f6", competition_id: COMP },
      { id: RED, name: "Red", short_name: "RED", color: "#ef4444", competition_id: COMP },
    ],
    competitions: [{ id: COMP, defending_team_id: null, scoring_model: "match_play", clinch_notified_team_id: opts.heldClaim ?? null }],
    games: [{
      id: GAME, name: "Cornhole", competition_id: COMP, points_distribution: { type: "per_match", value: 4 },
      points_total: 4, status: "complete", game_type_id: "gtt_generic_yard",
      competition_format: "matches", course_id: null, back_course_id: null, scoring_enabled: true,
      entry_mode: "score", corrections_open: false, display_order: 1, config: {}, modifiers: {},
      bracket_config: {}, rules_for_today: null, scorecard_schema: null, tee_time: null,
    }],
    team_assignments: [
      { user_id: "alice", team_id: BLUE, competition_id: COMP },
      { user_id: "carol", team_id: RED, competition_id: COMP },
    ],
    game_results: [
      { game_id: GAME, entity_id: BLUE, entity_type: "team", raw_score: 4, position: null, value_kind: "points", credited_team_id: null },
      { game_id: GAME, entity_id: RED, entity_type: "team", raw_score: 0, position: null, value_kind: "points", credited_team_id: null },
    ],
    game_matches: [{
      id: "m1", game_id: GAME, point_value: null, result: "a_win", status: "complete",
      side_a: { type: "user", id: "alice" }, side_b: { type: "user", id: "carol" },
    }],
    game_participants: [], play_groups: [], game_started: [{ game_id: GAME }],
    bracket_entrants: [], score_entries: [], match_hole_outcomes: [],
  };
  return {
    from: (n: string) => {
      if (!(n in tables)) throw new Error(`fake client has no table "${n}"`);
      const fail = n === "game_results" && opts.failResults ? "upstream 502" : null;
      return table(tables[n], fail);
    },
    // The release is an RPC (`release_clinch_claim`), not a table update — the
    // first draft of this file watched `.update()` and so could not fail.
    rpc: async (name: string) => { opts.onRpc?.(name); return { data: true, error: null }; },
  };
}

describe("#1411 — the board refuses to render from a failed results read", () => {
  it("CONTROL: the same data, read successfully, is a board where Blue has clinched", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const board = await computeCompetitionLeaderboard(client({ failResults: false }) as any, COMP);
    expect(board.teamTotals[BLUE]).toBe(4);
    expect(board.pointsToClinch[BLUE]).toBeLessThanOrEqual(0);
  });

  it("a failed read THROWS, naming the cause — not a board of zeros", async () => {
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      computeCompetitionLeaderboard(client({ failResults: true }) as any, COMP),
    ).rejects.toThrow("Couldn't read this cup's results, so the board can't be shown yet: upstream 502");
  });
});

describe("#1411 — a failed read never releases a held clinch claim", () => {
  it("CONTROL: with the read working and Blue still decided, the claim is left alone", async () => {
    const rpcs: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await reconcileClinchClaim(COMP, client({ failResults: false, heldClaim: BLUE, onRpc: (n) => rpcs.push(n) }) as any);
    expect(rpcs).not.toContain("release_clinch_claim");
  });

  it("with the read FAILING, the claim is still left alone — the board did not say the holder lost it", async () => {
    // Before #1411 the empty board read Blue as undecided, and this RELEASED the
    // claim through `release_clinch_claim`.
    const rpcs: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await reconcileClinchClaim(COMP, client({ failResults: true, heldClaim: BLUE, onRpc: (n) => rpcs.push(n) }) as any);
    expect(rpcs).not.toContain("release_clinch_claim");
  });
});
