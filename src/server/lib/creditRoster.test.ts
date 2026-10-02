import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeMatchPlayResults } from "./matchPlay";
import { computeRackNStackResults } from "./rackNStack";
import { computeStrokePlayResults } from "./strokePlay";
import { computeSkinsResults } from "./skins";
import { computePickemResults } from "./pickemResults";
import { parseCreditedRoster } from "./creditRoster";
import type { WriteFailureMode } from "./writeGameResults";

/**
 * A FINISHED GAME IS CREDITED THROUGH THE ROSTER IT FINALIZED WITH (203, PR 8a).
 *
 * Every writer used to rebuild its team rows from the CURRENT roster, so a
 * player traded after a finished game, followed by a correction (which re-runs
 * the writer), carried their result to the new team. The roster lock made that
 * unreachable; PR 8 lifts the lock, so this has to hold first.
 *
 * Each writer is checked three ways, on one fixture in which Alice has been
 * TRADED from Blue to Red since the game finalized:
 *
 *   1. with the game's credited roster stored, the team rows follow IT (Alice
 *      still pays Blue) — the case every writer got wrong before 203;
 *   2. CONTROL: the same trade with NO stored roster moves the credit — proving
 *      the trade in the fixture is real, so (1) staying put is the snapshot's
 *      doing and not a fixture that never moved anyone;
 *   3. a finalize records the roster it used, and a live recompute records
 *      nothing (ruling 15: points are not earned until the game finalizes).
 *
 * A fake client, not the database: the database half — the wrapper keeping the
 * FIRST roster, the reset clearing it, the guest merge re-keying it — is in
 * `creditRoster.db.test.ts` and `creditedRosterMigration.db.test.ts`.
 */

const G = "g1";
const C = "c1";
const BLUE = "tBlue";
const RED = "tRed";
const HOLES = Array.from({ length: 18 }, (_, i) => i + 1);

type Row = Record<string, unknown>;
interface RpcCall { name: string; args: { p_rows: Row[]; p_credited_roster: unknown } }

function fakeDb(tables: Record<string, Row[]>) {
  const rpcs: RpcCall[] = [];
  const from = (name: string) => {
    let cur = [...(tables[name] ?? [])];
    const api: Record<string, unknown> = {
      select: () => api,
      eq: (k: string, v: unknown) => { cur = cur.filter((r) => r[k] === v); return api; },
      in: (k: string, vals: unknown[]) => { cur = cur.filter((r) => vals.includes(r[k])); return api; },
      is: () => api,
      order: () => api,
      maybeSingle: async () => ({ data: cur[0] ?? null, error: null }),
      single: async () => ({ data: cur[0] ?? null, error: null }),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
        Promise.resolve({ data: cur, error: null }).then(res, rej),
    };
    for (const op of ["update", "insert", "delete", "upsert"]) api[op] = () => api;
    return api;
  };
  const rpc = async (name: string, args: RpcCall["args"]) => {
    rpcs.push({ name, args });
    return { data: null, error: null };
  };
  return { client: { from, rpc } as unknown as SupabaseClient, rpcs };
}

/** Today's roster: Alice has been TRADED to Red. */
const TRADED = [
  { user_id: "alice", team_id: RED, competition_id: C },
  { user_id: "carol", team_id: RED, competition_id: C },
];
/** Before the trade. */
const ORIGINAL = [
  { user_id: "alice", team_id: BLUE, competition_id: C },
  { user_id: "carol", team_id: RED, competition_id: C },
];
/** The roster the game finalized with: Alice on Blue. */
const CREDITED = { alice: BLUE, carol: RED };

const cup = () => ({
  competitions: [{ id: C, scoring_model: "match_play" }],
  teams: [{ id: BLUE, competition_id: C }, { id: RED, competition_id: C }],
  team_assignments: TRADED,
});

/** Team rows the writes carried, as { team: raw_score } — across every call. */
function teamRows(rpcs: RpcCall[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of rpcs) for (const r of c.args.p_rows) if (r.entity_type === "team") out[r.entity_id as string] = r.raw_score as number;
  return out;
}

interface Engine {
  name: string;
  /** The game row's own columns, without `credited_roster`. */
  game: Row;
  tables: () => Record<string, Row[]>;
  run: (db: SupabaseClient, onFailure: WriteFailureMode) => Promise<unknown>;
  /** Team rows when credited through CREDITED (Alice on Blue). */
  credited: Record<string, number>;
  /** Team rows when credited through TRADED (Alice on Red). */
  traded: Record<string, number>;
}

const ENGINES: Engine[] = [
  {
    name: "match play (outcome entry)",
    game: {
      id: G, game_type_id: "gtt_match_play", modifiers: {}, entry_mode: "outcome", competition_id: C,
      scorecard_schema: { units: { count: 18 } }, points_distribution: { type: "per_match", value: 3 }, points_total: 3,
    },
    tables: () => ({
      ...cup(),
      game_matches: [{
        id: "m1", game_id: G, side_a: { type: "user", id: "alice" }, side_b: { type: "user", id: "carol" },
        status: "active", result: null, point_value: null,
      }],
      match_hole_outcomes: HOLES.slice(0, 10).map((h) => ({ game_id: G, match_id: "m1", hole_number: h, result: "side_a" })),
      game_participants: [
        { game_id: G, user_id: "alice", play_group_id: null, handicap_strokes: null },
        { game_id: G, user_id: "carol", play_group_id: null, handicap_strokes: null },
      ],
    }),
    run: (db, onFailure) => computeMatchPlayResults(db, G, { onFailure }),
    // Alice wins 10 up: her match pays the team she was on when it finished.
    credited: { [BLUE]: 3, [RED]: 0 },
    // A match-play cup writes both its teams, so the empty Blue reads 0.
    traded: { [BLUE]: 0, [RED]: 3 },
  },
  {
    name: "rack n stack",
    game: {
      id: G, game_type_id: "gtt_rack_n_stack", competition_id: C, points_distribution: { type: "per_match", value: 1 }, points_total: null,
      scorecard_schema: { units: { count: 18, metadata: { par: HOLES.map(() => 4), handicap_index: HOLES } } },
    },
    tables: () => ({
      ...cup(),
      game_participants: [
        { game_id: G, user_id: "alice", handicap_strokes: null },
        { game_id: G, user_id: "carol", handicap_strokes: null },
      ],
      score_entries: HOLES.flatMap((h) => [
        { game_id: G, participant_id: "alice", participant_type: "user", unit_label: String(h), value: 4 },
        { game_id: G, participant_id: "carol", participant_type: "user", unit_label: String(h), value: 5 },
      ]),
    }),
    run: (db, onFailure) => computeRackNStackResults(db, G, { onFailure }),
    // One slot each at value 1; Blue's slot (Alice) wins it.
    credited: { [BLUE]: 1, [RED]: 0 },
    // Traded, nobody is on Blue, and rack writes nothing for a side nobody is on.
    traded: {},
  },
  {
    name: "stroke play",
    game: { id: G, game_type_id: "gtt_stroke_play", competition_id: C, config: {}, scorecard_schema: null },
    tables: () => ({
      ...cup(),
      game_participants: [
        { game_id: G, user_id: "alice", handicap_strokes: null },
        { game_id: G, user_id: "carol", handicap_strokes: null },
      ],
      score_entries: HOLES.flatMap((h) => [
        { game_id: G, participant_id: "alice", participant_type: "user", unit_label: String(h), value: 4 },
        { game_id: G, participant_id: "carol", participant_type: "user", unit_label: String(h), value: 5 },
      ]),
    }),
    run: (db, onFailure) => computeStrokePlayResults(db, G, { onFailure, requireQualified: true }),
    credited: { [BLUE]: 72, [RED]: 90 },
    traded: { [RED]: 162 },
  },
  {
    name: "scramble (a group's team comes through its members)",
    game: { id: G, game_type_id: "gtt_scramble", competition_id: C, config: {}, scorecard_schema: null },
    tables: () => ({
      ...cup(),
      play_groups: [
        { game_id: G, id: "pgA", handicap_strokes: null },
        { game_id: G, id: "pgB", handicap_strokes: null },
      ],
      game_participants: [
        { game_id: G, user_id: "alice", play_group_id: "pgA" },
        { game_id: G, user_id: "carol", play_group_id: "pgB" },
      ],
      score_entries: HOLES.flatMap((h) => [
        { game_id: G, participant_id: "pgA", participant_type: "play_group", unit_label: String(h), value: 4 },
        { game_id: G, participant_id: "pgB", participant_type: "play_group", unit_label: String(h), value: 5 },
      ]),
    }),
    run: (db, onFailure) => computeStrokePlayResults(db, G, { onFailure, requireQualified: true }),
    credited: { [BLUE]: 72, [RED]: 90 },
    traded: { [RED]: 162 },
  },
  {
    name: "skins",
    game: { id: G, game_type_id: "gtt_skins", competition_id: C, modifiers: {}, scorecard_schema: null },
    tables: () => ({
      ...cup(),
      game_participants: [
        { game_id: G, user_id: "alice", play_group_id: "pg1" },
        { game_id: G, user_id: "carol", play_group_id: "pg1" },
      ],
      skins_hole_outcomes: [{ game_id: G, grouping_id: "pg1", hole_number: 1, result: "won", winner_user_id: "alice" }],
    }),
    run: (db, onFailure) => computeSkinsResults(db, G, { onFailure }),
    credited: { [BLUE]: 1, [RED]: 0 },
    traded: { [RED]: 1 },
  },
  {
    name: "pick'em",
    game: { id: G, competition_id: C, points_total: 4, points_distribution: null },
    tables: () => ({
      ...cup(),
      competitions: [{ id: C, scoring_model: "points" }],
      pickem_games: [{
        game_id: G, picks_opened_at: "2026-01-01T00:00:00Z", picks_deadline: null,
        picks_locked_at: "2026-01-02T00:00:00Z", roll_up: null, use_confidence: false,
      }],
      pickem_slate_games: [{ game_id: G, id: "s1", multiplier: 1, result: "home" }],
      pickem_picks: [
        { game_id: G, user_id: "alice", slate_game_id: "s1", pick: "home", confidence: null },
        { game_id: G, user_id: "carol", slate_game_id: "s1", pick: "away", confidence: null },
      ],
      game_matches: [],
    }),
    run: (db, onFailure) => computePickemResults(db, G, { onFailure: onFailure as "throw" }),
    // Rank rows: `raw_score` is the POSITION here. Credited, Blue (Alice's
    // correct pick) is 1st; traded, Red holds both sheets and the empty Blue is 2nd.
    credited: { [BLUE]: 1, [RED]: 2 },
    traded: { [RED]: 1, [BLUE]: 2 },
  },
];

const withGame = (e: Engine, credited: unknown) => ({
  ...e.tables(),
  games: [{ ...e.game, ...(credited === undefined ? {} : { credited_roster: credited }) }],
});

describe.each(ENGINES)("$name", (e) => {
  it("a finished game stays credited through the roster it finalized with, after a trade", async () => {
    const { client, rpcs } = fakeDb(withGame(e, CREDITED));
    await e.run(client, "throw");
    expect(teamRows(rpcs)).toEqual(e.credited);
  });

  it("CONTROL: with no credited roster yet, the same trade moves the credit", async () => {
    const { client, rpcs } = fakeDb(withGame(e, null));
    await e.run(client, "throw");
    expect(teamRows(rpcs)).toEqual(e.traded);
  });

  it("a finalize records the roster it credited through; a live recompute records nothing", async () => {
    // Today's roster UNtraded here, so every writer has two teams to pay — rack
    // writes nothing at all when one side is empty, and a write that never
    // happens records nothing either.
    const untraded = () => ({ ...withGame(e, null), team_assignments: ORIGINAL });
    const fin = fakeDb(untraded());
    await e.run(fin.client, "throw");
    const recorded = fin.rpcs.map((c) => c.args.p_credited_roster).filter((r) => r != null);
    expect(recorded.length).toBeGreaterThan(0);
    for (const r of recorded) expect(r).toEqual(CREDITED);

    const live = fakeDb(untraded());
    await e.run(live.client, "log");
    expect(live.rpcs.length).toBeGreaterThan(0); // it did write — just not the roster
    for (const c of live.rpcs) expect(c.args.p_credited_roster).toBeNull();
  });
});

describe("absence from a credited roster is a fact (ruling 17)", () => {
  it("a player on no team when the game finalized stays creditless, whatever their team now", async () => {
    // Alice was teamless at finalize and has since joined Blue.
    const tables = {
      ...withGame(ENGINES.find((e) => e.name === "stroke play")!, { carol: RED }),
      team_assignments: [
        { user_id: "alice", team_id: BLUE, competition_id: C },
        { user_id: "carol", team_id: RED, competition_id: C },
      ],
    };
    const { client, rpcs } = fakeDb(tables);
    await computeStrokePlayResults(client, G, { onFailure: "throw", requireQualified: true });
    expect(teamRows(rpcs)).toEqual({ [RED]: 90 });
  });

  it("an EMPTY credited roster is a game credited with nobody on a team — not 'never credited'", async () => {
    const { client, rpcs } = fakeDb(withGame(ENGINES.find((e) => e.name === "stroke play")!, {}));
    await computeStrokePlayResults(client, G, { onFailure: "throw", requireQualified: true });
    expect(teamRows(rpcs)).toEqual({});
  });
});

describe("parseCreditedRoster fails closed", () => {
  it("refuses an array, a scalar, and a player with no team", () => {
    expect(() => parseCreditedRoster([], G)).toThrow(/not a map/);
    expect(() => parseCreditedRoster("x", G)).toThrow(/not a map/);
    expect(() => parseCreditedRoster({ alice: null }, G)).toThrow(/no team for a player/);
    expect(() => parseCreditedRoster({ alice: "" }, G)).toThrow(/no team for a player/);
  });

  it("admits a string map, including an empty one", () => {
    expect(parseCreditedRoster({ alice: BLUE }, G)).toEqual({ alice: BLUE });
    expect(parseCreditedRoster({}, G)).toEqual({});
  });
});
