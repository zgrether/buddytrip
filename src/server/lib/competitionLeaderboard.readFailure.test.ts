import { describe, it, expect } from "vitest";
import { computeCompetitionLeaderboard } from "./competitionLeaderboard";
import { reconcileClinchClaim, notifyCupClinchedIfDecided } from "./gameFinishNotify";

/**
 * A failed read is never data to anything that writes (#1411, #1468).
 *
 * Every read `computeCompetitionLeaderboard` makes either succeeds or throws. A
 * failed read used to become the empty answer, the board came back
 * well-formed and wrong, and the two clinch WRITERS acted on it:
 *
 *  - `reconcileClinchClaim` RELEASED a held claim (next finalize: the same
 *    clinch announced twice);
 *  - the clinch check, with a failed games read, saw nothing left to play, read
 *    the defending team as decided, and CLAIMED a clinch that never happened.
 *
 * The fake client (the shape `competitionLeaderboard.cannotProject.test` uses)
 * fails exactly ONE table, and every "nothing was written" case has a control
 * showing the fake CAN express the write — so a green cannot come from a door
 * the test is not watching. (#1467's first draft watched `.update()` while the
 * release is an RPC, and could not fail.)
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
    insert: () => api,
    maybeSingle: async () => (fail ? { data: null, error: { message: fail } } : { data: cur[0] ?? null, error: null }),
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej),
  };
  return api;
}

interface Opts {
  /** The ONE table whose read fails. */
  failTable?: string | null;
  heldClaim?: string | null;
  defendingTeam?: string | null;
  /** "blueWon": one finished 4-point game, all 4 to Blue (Blue has clinched).
   *  "undecided": the same game still live, nothing banked (nobody has). */
  state: "blueWon" | "undecided";
  onRpc?: (name: string, args: unknown) => void;
}

function client(o: Opts) {
  const finished = o.state === "blueWon";
  const tables: Record<string, Row[]> = {
    teams: [
      { id: BLUE, name: "Blue", short_name: "BLU", color: "#3b82f6", competition_id: COMP },
      { id: RED, name: "Red", short_name: "RED", color: "#ef4444", competition_id: COMP },
    ],
    competitions: [{
      id: COMP, defending_team_id: o.defendingTeam ?? null, scoring_model: "match_play",
      clinch_notified_team_id: o.heldClaim ?? null,
    }],
    games: [{
      id: GAME, name: "Cornhole", competition_id: COMP, points_distribution: { type: "per_match", value: 4 },
      points_total: 4, status: finished ? "complete" : "active", game_type_id: "gtt_generic_yard",
      competition_format: "matches", course_id: null, back_course_id: null, scoring_enabled: true,
      entry_mode: "score", corrections_open: false, display_order: 1, config: {}, modifiers: {},
      bracket_config: {}, rules_for_today: null, scorecard_schema: null, tee_time: null,
    }],
    team_assignments: [
      { user_id: "alice", team_id: BLUE, competition_id: COMP },
      { user_id: "carol", team_id: RED, competition_id: COMP },
    ],
    game_results: finished
      ? [
          { game_id: GAME, entity_id: BLUE, entity_type: "team", raw_score: 4, position: null, value_kind: "points", credited_team_id: null },
          { game_id: GAME, entity_id: RED, entity_type: "team", raw_score: 0, position: null, value_kind: "points", credited_team_id: null },
        ]
      : [],
    game_matches: [{
      id: "m1", game_id: GAME, point_value: null, result: finished ? "a_win" : null, status: finished ? "complete" : "pending",
      side_a: { type: "user", id: "alice" }, side_b: { type: "user", id: "carol" },
    }],
    game_participants: [], play_groups: [], game_started: [{ game_id: GAME }],
    bracket_entrants: [], score_entries: [], match_hole_outcomes: [], push_send_log: [],
  };
  return {
    from: (n: string) => {
      if (!(n in tables)) throw new Error(`fake client has no table "${n}"`);
      return table(tables[n], n === o.failTable ? "upstream 502" : null);
    },
    rpc: async (name: string, args: unknown) => {
      o.onRpc?.(name, args);
      // The claim reports success for whichever team it was asked about.
      return { data: name === "claim_clinch_notification" ? (args as { p_team_id?: string }).p_team_id ?? true : true, error: null };
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const board = (o: Opts) => computeCompetitionLeaderboard(client(o) as any, COMP);

describe("the board is computed from successful reads, or not at all", () => {
  it("CONTROL: every read succeeding gives the board where Blue has clinched", async () => {
    const b = await board({ state: "blueWon" });
    expect(b.teamTotals[BLUE]).toBe(4);
    expect(b.pointsToClinch[BLUE]).toBeLessThanOrEqual(0);
  });

  // Every read the board's numbers depend on. A table failed here that the
  // compute does NOT read would resolve, and the case would go red — so this
  // list cannot quietly include a table nothing reads.
  it.each([
    ["game_results", "cup's results"],
    ["teams", "cup's teams"],
    ["competitions", "cup"],
    ["games", "cup's games"],
    ["team_assignments", "cup's rosters"],
    ["game_matches", "cup's matches"],
    ["game_participants", "cup's participants"],
    ["game_started", "cup's started games"],
  ])("a failed %s read THROWS, naming what could not be checked", async (failTable, what) => {
    await expect(board({ state: "blueWon", failTable })).rejects.toThrow(
      `Couldn't check the ${what} just now. This is temporary — try again in a moment.`,
    );
  });
});

describe("a failed read never releases a held clinch claim", () => {
  it("CONTROL: reads succeeding and Blue still decided — nothing released", async () => {
    const rpcs: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await reconcileClinchClaim(COMP, client({ state: "blueWon", heldClaim: BLUE, onRpc: (n) => rpcs.push(n) }) as any);
    expect(rpcs).not.toContain("release_clinch_claim");
  });

  it("CONTROL: the fake CAN express a release — Blue held, the cup genuinely undecided", async () => {
    const rpcs: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await reconcileClinchClaim(COMP, client({ state: "undecided", heldClaim: BLUE, onRpc: (n) => rpcs.push(n) }) as any);
    expect(rpcs).toContain("release_clinch_claim");
  });

  it.each(["game_results", "teams"])("a failed %s read leaves the claim alone", async (failTable) => {
    // Before #1411 (results) and #1468 (teams) the empty board read Blue as
    // undecided and this RELEASED the claim.
    const rpcs: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await reconcileClinchClaim(COMP, client({ state: "blueWon", heldClaim: BLUE, failTable, onRpc: (n) => rpcs.push(n) }) as any);
    expect(rpcs).not.toContain("release_clinch_claim");
  });
});

describe("a failed games read never claims a clinch that did not happen (#1468)", () => {
  const notify = (o: Opts) =>
    notifyCupClinchedIfDecided({
      tripId: "trip",
      competitionId: COMP,
      actorUserId: "alice",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      admin: client(o) as any,
    });

  it("CONTROL: the fake CAN express a claim — Blue genuinely clinched is claimed", async () => {
    const claims: unknown[] = [];
    await notify({ state: "blueWon", onRpc: (n, a) => { if (n === "claim_clinch_notification") claims.push(a); } });
    expect(claims.length).toBe(1);
  });

  it("CONTROL: an undecided cup with a defending team claims nothing when the reads succeed", async () => {
    const claims: unknown[] = [];
    await notify({ state: "undecided", defendingTeam: RED, onRpc: (n, a) => { if (n === "claim_clinch_notification") claims.push(a); } });
    expect(claims).toEqual([]);
  });

  it("a FAILED games read on that same cup claims nothing — it used to read the defender as decided", async () => {
    // Unchecked, the failed read left no games: nothing left to play, so the
    // defender's points-to-retain fell to 0, it read decided, and this claimed
    // and pushed "Red clinched" to the whole cup.
    const claims: unknown[] = [];
    await notify({ state: "undecided", defendingTeam: RED, failTable: "games", onRpc: (n, a) => { if (n === "claim_clinch_notification") claims.push(a); } });
    expect(claims).toEqual([]);
  });
});
