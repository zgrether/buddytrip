import { describe, it, expect, vi, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeMatchPlayResults } from "./matchPlay";
import { computeRackNStackResults } from "./rackNStack";
import { computeStrokePlayResults } from "./strokePlay";
import { computeSkinsResults } from "./skins";
import { computePickemResults } from "./pickemResults";
import type { WriteFailureMode } from "./writeGameResults";

/**
 * #1470 — a result writer never writes on the strength of a failed read.
 *
 * Every engine reads rosters, participants, matches or scores and then REPLACES
 * the game's rows through `write_game_results` (`scope: "all"` deletes before it
 * inserts). A read that came back empty on failure used to be written as the
 * answer: zeros for every team in a Match Play cup, or no rows at all, which is
 * a delete. `games.finish` then marked the game complete on top.
 *
 * The fake fails EVERY read of exactly ONE table and records every write the
 * engine could make: the `write_game_results` RPC (the door the results go
 * through — an `.update()` watcher would stay green against the bug, #1467) and
 * any `update` / `insert` / `delete` / `upsert` (pick'em voids its unresolved
 * slate games before scoring). Each engine has a CONTROL on the same fixture
 * showing the write happens, with the value a failed read would have replaced.
 *
 * Finalize mode ("throw") must reject with the family's own sentence — a
 * failure from any other door produces a different one. Setup mode ("log") must
 * leave the rows alone and NOT throw: a setup recompute runs after its own write
 * has committed, and throwing would report a failed save for a change that
 * landed (`failClosedOnRead`).
 *
 * "Nothing" means NOTHING, for every read, with no allowance for writes that
 * came before it. This file's first draft allowed match play one: it writes its
 * side rows and then read the rosters for its team rows, and a roster failure
 * left fresh side rows behind, which looked harmless. It was not — on a
 * finalize the side write is `scope: "all"`, which deletes the TEAM rows too,
 * and the DB test (`resultWritersFailClosed.test.ts`) found a re-finalize
 * leaving the game with none. Every read now precedes every write.
 */

const SENTENCE = (what: string) => `Couldn't check the ${what} just now. This is temporary — try again in a moment.`;

const G = "g1";
const C = "c1";
const BLUE = "tBlue";
const RED = "tRed";
const HOLES = Array.from({ length: 18 }, (_, i) => i + 1);

type Row = Record<string, unknown>;

interface Writes {
  rpc: { name: string; args: { p_rows: Row[]; p_scope: string } }[];
  mutations: { table: string; op: string }[];
}

function fakeDb(tables: Record<string, Row[]>, failTable: string | null) {
  const writes: Writes = { rpc: [], mutations: [] };
  const failure = { data: null, count: null, error: { code: "PGRST003", message: "simulated read failure" } };
  const from = (name: string) => {
    let cur = [...(tables[name] ?? [])];
    let mutating = false;
    const reads = () => name === failTable && !mutating;
    const api: Record<string, unknown> = {
      select: () => api,
      eq: (k: string, v: unknown) => { cur = cur.filter((r) => r[k] === v); return api; },
      in: (k: string, vals: unknown[]) => { cur = cur.filter((r) => vals.includes(r[k])); return api; },
      is: () => api,
      order: () => api,
      maybeSingle: async () => (reads() ? failure : { data: cur[0] ?? null, error: null }),
      single: async () => (reads() ? failure : { data: cur[0] ?? null, error: null }),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
        Promise.resolve(reads() ? failure : { data: cur, error: null }).then(res, rej),
    };
    for (const op of ["update", "insert", "delete", "upsert"]) {
      api[op] = () => { mutating = true; writes.mutations.push({ table: name, op }); return api; };
    }
    return api;
  };
  const rpc = async (name: string, args: Writes["rpc"][number]["args"]) => {
    writes.rpc.push({ name, args });
    return { data: null, error: null };
  };
  return { client: { from, rpc } as unknown as SupabaseClient, writes };
}

const cup = () => ({
  competitions: [{ id: C, scoring_model: "match_play" }],
  teams: [{ id: BLUE, competition_id: C }, { id: RED, competition_id: C }],
  team_assignments: [
    { user_id: "alice", team_id: BLUE, competition_id: C },
    { user_id: "carol", team_id: RED, competition_id: C },
  ],
});

/** Team rows the writes carried, as { team: raw_score } — across every call. */
function teamRows(w: Writes): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of w.rpc) for (const r of c.args.p_rows) if (r.entity_type === "team") out[r.entity_id as string] = r.raw_score as number;
  return out;
}

interface Engine {
  name: string;
  tables: () => Record<string, Row[]>;
  run: (db: SupabaseClient, onFailure: WriteFailureMode | undefined) => Promise<unknown>;
  /** What the control must write, in a form the wrong build would change. */
  control: (w: Writes) => void;
  /** [table, the noun in the sentence its failure throws]. */
  fails: [string, string][];
}

const ENGINES: Engine[] = [
  {
    name: "match play, outcome entry (computeMatchPlayResults + writeTeamMatchPoints)",
    tables: () => ({
      ...cup(),
      games: [{
        id: G, game_type_id: "gtt_match_play", modifiers: {}, entry_mode: "outcome", competition_id: C,
        scorecard_schema: { units: { count: 18 } }, points_distribution: { type: "per_match", value: 3 }, points_total: 3,
      }],
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
    // Alice 10 up with 8 to play: Blue takes the match's 3. A failed roster read
    // wrote { Blue: 0, Red: 0 } here.
    control: (w) => expect(teamRows(w)).toEqual({ [BLUE]: 3, [RED]: 0 }),
    fails: [
      ["game_matches", "game's matches"],
      // Three reads of `games`; the stroke-index one comes first.
      ["games", "game's course"],
      ["match_hole_outcomes", "game's hole results"],
      ["team_assignments", "cup's rosters"],
      ["game_participants", "game's players"],
      ["teams", "cup's teams"],
      ["competitions", "cup"],
    ],
  },
  {
    name: "match play, score entry (the handicap and score reads)",
    tables: () => ({
      ...cup(),
      games: [{
        id: G, game_type_id: "gtt_match_play", modifiers: {}, entry_mode: "score", competition_id: C,
        scorecard_schema: { units: { count: 18 } }, points_distribution: { type: "per_match", value: 3 }, points_total: 3,
      }],
      game_matches: [{
        id: "m1", game_id: G, side_a: { type: "user", id: "alice" }, side_b: { type: "user", id: "carol" },
        status: "active", result: null, point_value: null,
      }],
      game_participants: [
        { game_id: G, user_id: "alice", play_group_id: null, handicap_strokes: null },
        { game_id: G, user_id: "carol", play_group_id: null, handicap_strokes: null },
      ],
      play_groups: [],
      score_entries: HOLES.slice(0, 10).flatMap((h) => [
        { game_id: G, participant_id: "alice", participant_type: "user", unit_label: String(h), value: 4 },
        { game_id: G, participant_id: "carol", participant_type: "user", unit_label: String(h), value: 5 },
      ]),
    }),
    run: (db, onFailure) => computeMatchPlayResults(db, G, { onFailure }),
    control: (w) => expect(teamRows(w)).toEqual({ [BLUE]: 3, [RED]: 0 }),
    fails: [
      ["game_participants", "game's handicaps"],
      ["play_groups", "game's handicaps"],
      ["score_entries", "game's scores"],
    ],
  },
  {
    name: "rack n stack (computeRackNStackResults)",
    tables: () => ({
      ...cup(),
      games: [{
        id: G, game_type_id: "gtt_rack_n_stack", competition_id: C, points_distribution: { type: "per_match", value: 1 }, points_total: null,
        scorecard_schema: { units: { count: 18, metadata: { par: HOLES.map(() => 4), handicap_index: HOLES } } },
      }],
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
    // Blue's slot beats Red's. A failed participants or scores read wrote 0–0.
    control: (w) => {
      const t = teamRows(w);
      expect(t[BLUE]).toBeGreaterThan(t[RED]);
    },
    fails: [
      ["games", "game"],
      ["teams", "cup's teams"],
      ["team_assignments", "cup's rosters"],
      ["game_participants", "game's players"],
      ["score_entries", "game's scores"],
    ],
  },
  {
    name: "stroke play (computeStrokePlayResults)",
    tables: () => ({
      ...cup(),
      games: [{ id: G, game_type_id: "gtt_stroke_play", competition_id: C, config: {}, scorecard_schema: null }],
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
    // Both teams banked; a failed roster read wrote the player rows with NO team rows.
    control: (w) => expect(teamRows(w)).toEqual({ [BLUE]: 72, [RED]: 90 }),
    fails: [
      ["games", "game"],
      ["game_participants", "game's players"],
      ["score_entries", "game's scores"],
      ["team_assignments", "cup's rosters"],
    ],
  },
  {
    name: "scramble (computeStrokePlayResults' group arm)",
    tables: () => ({
      ...cup(),
      games: [{ id: G, game_type_id: "gtt_scramble", competition_id: C, config: {}, scorecard_schema: null }],
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
    control: (w) => expect(teamRows(w)).toEqual({ [BLUE]: 72, [RED]: 90 }),
    fails: [
      ["play_groups", "game's players"],
      ["game_participants", "game's groups"],
    ],
  },
  {
    name: "skins (computeSkinsResults)",
    tables: () => ({
      ...cup(),
      games: [{ id: G, game_type_id: "gtt_skins", competition_id: C, modifiers: {}, scorecard_schema: null }],
      game_participants: [
        { game_id: G, user_id: "alice", play_group_id: "pg1" },
        { game_id: G, user_id: "carol", play_group_id: "pg1" },
      ],
      skins_hole_outcomes: [{ game_id: G, grouping_id: "pg1", hole_number: 1, result: "won", winner_user_id: "alice" }],
    }),
    run: (db, onFailure) => computeSkinsResults(db, G, { onFailure }),
    // Alice's skin banks to Blue. A failed participants or outcomes read made
    // the write empty, and `scope: "all"` deleted every row.
    control: (w) => {
      const alice = w.rpc[0].args.p_rows.find((r) => r.entity_id === "alice");
      expect(alice?.raw_score).toBe(1);
      expect(teamRows(w)[BLUE]).toBe(1);
    },
    fails: [
      ["games", "game"],
      ["game_participants", "game's players"],
      ["skins_hole_outcomes", "game's hole results"],
      ["team_assignments", "cup's rosters"],
    ],
  },
  {
    name: "pick'em (computePickemResults), including its void write",
    tables: () => ({
      ...cup(),
      competitions: [{ id: C, scoring_model: "points" }],
      games: [{ id: G, competition_id: C, points_total: 4, points_distribution: null }],
      pickem_games: [{
        game_id: G, picks_opened_at: "2026-01-01T00:00:00Z", picks_deadline: null,
        picks_locked_at: "2026-01-02T00:00:00Z", roll_up: null, use_confidence: false,
      }],
      pickem_slate_games: [
        { game_id: G, id: "s1", multiplier: 1, result: "home" },
        // Unresolved: finalize VOIDS it with an update before scoring — a
        // second write door, and it must stay shut on a failed read too.
        { game_id: G, id: "s2", multiplier: 1, result: null },
      ],
      pickem_picks: [
        { game_id: G, user_id: "alice", slate_game_id: "s1", pick: "home", confidence: null },
        { game_id: G, user_id: "carol", slate_game_id: "s1", pick: "away", confidence: null },
      ],
      game_matches: [],
    }),
    run: (db, onFailure) => computePickemResults(db, G, { onFailure }),
    control: (w) => {
      expect(w.mutations).toEqual([{ table: "pickem_slate_games", op: "update" }]);
      expect(w.rpc).toHaveLength(1);
      expect(w.rpc[0].args.p_rows.length).toBeGreaterThan(0);
    },
    fails: [
      ["games", "game"],
      ["pickem_games", "pick'em settings"],
      ["pickem_slate_games", "slate"],
      ["pickem_picks", "sheets"],
      ["game_matches", "game's matches"],
      ["competitions", "cup"],
      ["teams", "cup's teams"],
      ["team_assignments", "cup's rosters"],
    ],
  },
];

afterEach(() => vi.restoreAllMocks());

describe.each(ENGINES)("$name", (e) => {
  it("CONTROL: real reads — the result is written", async () => {
    const { client, writes } = fakeDb(e.tables(), null);
    await e.run(client, "throw");
    expect(writes.rpc.every((c) => c.name === "write_game_results")).toBe(true);
    e.control(writes);
  });

  it.each(e.fails)("finalize: a failed %s read throws '%s' and writes nothing", async (table, what) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { client, writes } = fakeDb(e.tables(), table);
    await expect(e.run(client, "throw")).rejects.toThrow(SENTENCE(what));
    expect(writes.rpc).toEqual([]);
    expect(writes.mutations).toEqual([]);
  });

  it.each(e.fails)("setup: a failed %s read is logged, NOT thrown, and writes nothing", async (table, what) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client, writes } = fakeDb(e.tables(), table);
    await e.run(client, "log");
    expect(writes.rpc).toEqual([]);
    expect(writes.mutations).toEqual([]);
    expect(log).toHaveBeenCalledWith(
      "[writeGameResults] a read failed, results left as they were (setup path, not surfaced)",
      { gameId: G, what }
    );
  });
});

describe("setup mode swallows ONLY a failed read", () => {
  it("a refusal raised inside the compute still reaches the caller (pick'em, picks still open)", async () => {
    const tables = ENGINES.find((e) => e.name.startsWith("pick'em"))!.tables();
    tables.pickem_games = [{ ...tables.pickem_games[0], picks_locked_at: null }];
    const { client, writes } = fakeDb(tables, null);
    await expect(computePickemResults(client, G)).rejects.toThrow("Close picking before finalizing");
    expect(writes.rpc).toEqual([]);
  });
});
