import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

/**
 * Game reset, asserted against its TARGET STATE — not against a list of columns.
 *
 * ── Why the assertion is shaped this way ────────────────────────────────────
 * The bug this replaces was not a wrong column; it was a FORGOTTEN one. Reset was
 * written as "clear the config columns and the scoring rows", and five columns
 * (`config`, `tee_time`, `back_course_id`, `entry_mode`, `bracket_config`) plus the
 * whole bracket and every delegate drifted out of that list without anything failing.
 * A test that lists the columns it expects to be cleared has exactly the same failure
 * mode as the code it is testing: it checks what someone remembered.
 *
 * So this asserts an EQUIVALENCE instead:
 *
 *   level 2 (clear settings)  a played, fully-configured game, after reset, is
 *                             indistinguishable from a game just added with the same
 *                             name and point value.
 *   level 1 (clear scores)    a played game, after reset, is indistinguishable from
 *                             its own pre-play snapshot.
 *
 * Nothing here enumerates what reset should touch. A column added next year is covered
 * the day it is added, because the comparison reads the LIVE SCHEMA rather than a list
 * in this file — tables and columns both come from PostgREST's OpenAPI document, which
 * describes the database as it actually is right now.
 *
 * That generality is what makes it catch the three things a column scan structurally
 * cannot:
 *   - JSONB payloads — `game_matches.side_a/side_b` hold `{type,id}` person references
 *     that no `information_schema` query on column NAMES would ever surface.
 *   - tables with no `game_id` — `bracket_entrant_members` hangs off its entrant, and
 *     is reached here the only way it can be.
 *   - columns nobody classified — the five above, and whatever the next five are.
 *
 * ── What is excluded, and why that is not a loophole ────────────────────────
 * Minted ids and creation timestamps cannot match between two different games, so
 * comparing them literally would fail on every run. They are NORMALISED rather than
 * dropped: an id-like column becomes `"«set»"` or `null`. That keeps the signal that
 * actually matters — `bracket_matches.winner_entrant_id` being null vs set IS the
 * assertion that level 1 cleared the picks — while ignoring the value nobody can
 * control. Dropping those columns instead would have made the bracket finding
 * invisible, which is the mistake this whole approach exists to avoid.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

let ctx: TestContext;
let tripId: string;
let competitionId: string;
let teamId: string;

/** Every public table carrying a `game_id`, read from the live schema. */
let gameScopedTables: string[] = [];

/**
 * Tables and their columns, straight from the running database.
 *
 * PostgREST's root document lists every exposed table with its properties, so this
 * needs no schema privileges, no `information_schema` access (which PostgREST does not
 * expose), and — the point — no list maintained by hand.
 */
async function liveSchema(): Promise<Record<string, string[]>> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!res.ok) throw new Error(`OpenAPI read failed: ${res.status}`);
  const spec = (await res.json()) as { definitions?: Record<string, { properties?: Record<string, unknown> }> };
  const out: Record<string, string[]> = {};
  for (const [table, def] of Object.entries(spec.definitions ?? {})) {
    out[table] = Object.keys(def.properties ?? {});
  }
  return out;
}

const ID_LIKE = /^id$|_id$/;
const MINTED_TS = /^(created_at|updated_at)$/;

/** One row, with unmatchable values normalised but their PRESENCE preserved. */
function normalise(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (MINTED_TS.test(k)) continue;
    if (k === "game_id" || k === "trip_id" || k === "competition_id") continue; // scope, not content
    out[k] = ID_LIKE.test(k) ? (v === null || v === undefined ? null : "«set»") : v;
  }
  return out;
}

const stable = (rows: Record<string, unknown>[]) =>
  rows.map(normalise).map((r) => JSON.stringify(r, Object.keys(r).sort())).sort();

/**
 * The complete observable state of a game: its own row plus every row in every
 * game-scoped table, normalised. `bracket_entrant_members` is included via its
 * entrants — it has no `game_id`, which is exactly why it was missed before.
 */
async function snapshotGame(gameId: string): Promise<Record<string, string[]>> {
  const admin = ctx.admin;
  const snap: Record<string, string[]> = {};

  const { data: game, error: gErr } = await admin.from("games").select("*").eq("id", gameId).maybeSingle();
  if (gErr) throw new Error(`snapshot games: ${gErr.message}`);
  // `display_order` is board presentation and legitimately differs between two games.
  const gameRow = { ...(game as Record<string, unknown>) };
  delete gameRow.display_order;
  snap.games = stable([gameRow]);

  for (const table of gameScopedTables) {
    const { data, error } = await admin.from(table).select("*").eq("game_id", gameId);
    if (error) throw new Error(`snapshot ${table}: ${error.message}`);
    snap[table] = stable((data ?? []) as Record<string, unknown>[]);
  }

  const { data: entrants } = await admin.from("bracket_entrants").select("id").eq("game_id", gameId);
  const entrantIds = (entrants ?? []).map((e) => (e as { id: string }).id);
  if (entrantIds.length > 0) {
    const { data, error } = await admin.from("bracket_entrant_members").select("*").in("entrant_id", entrantIds);
    if (error) throw new Error(`snapshot bracket_entrant_members: ${error.message}`);
    snap.bracket_entrant_members = stable((data ?? []) as Record<string, unknown>[]);
  } else {
    snap.bracket_entrant_members = [];
  }
  return snap;
}

/** Check every write. A silent insert failure would make this suite pass on nothing. */
async function ck<T extends { error: { message: string } | null }>(label: string, p: PromiseLike<T>): Promise<T> {
  const r = await p;
  if (r.error) throw new Error(`${label}: ${r.error.message}`);
  return r;
}

async function addGame(name: string, points: number): Promise<string> {
  const id = crypto.randomUUID();
  await ck(
    `create ${name}`,
    ctx.admin.from("games").insert({
      id, trip_id: tripId, competition_id: competitionId,
      game_type_id: "gtt_match_play", name, points_total: points, status: "pending",
    }),
  );
  return id;
}

/** Everything a fully set-up game carries — the state level 1 must PRESERVE. */
async function configure(gameId: string) {
  const owner = ctx.user.id;
  const groupId = crypto.randomUUID();
  await ck("play_group", ctx.admin.from("play_groups").insert({
    id: groupId, game_id: gameId, display_name: "Group 1", handicap_strokes: 2, tee_time: "09:10",
  }));
  await ck("participant", ctx.admin.from("game_participants").insert({
    id: crypto.randomUUID(), game_id: gameId, user_id: owner,
    play_group_id: groupId, team_id: teamId, handicap_strokes: 3,
  }));
  const matchId = crypto.randomUUID();
  await ck("match", ctx.admin.from("game_matches").insert({
    id: matchId, game_id: gameId, play_group_id: groupId, match_number: 1, display_order: 1,
    side_a: { type: "user", id: owner },          // JSONB person ref — invisible to a column scan
    side_b: { type: "user", id: ctx.getUser("member").id },
    point_value: 2,
  }));
  await ck("delegate", ctx.admin.from("game_delegates").insert({ game_id: gameId, user_id: ctx.getUser("member").id }));

  const entrantId = `${gameId}:e1`;
  await ck("entrant", ctx.admin.from("bracket_entrants").insert({
    id: entrantId, game_id: gameId, team_id: teamId, seed: 1,
  }));
  await ck("entrant_member", ctx.admin.from("bracket_entrant_members").insert({
    entrant_id: entrantId, user_id: owner,
  }));
  await ck("bracket_match", ctx.admin.from("bracket_matches").insert({
    id: crypto.randomUUID(), game_id: gameId, bracket: "main", round: 1, slot: 1, entrant_a_id: entrantId,
  }));

  await ck("config cols", ctx.admin.from("games").update({
    course_id: null, back_course_id: null,
    scorecard_schema: { units: [{ label: "1" }] },
    config: { some: "thing" }, modifiers: { glorious_holes: { holes: 3 } },
    bracket_config: { size: 4 }, rules_for_today: "No gimmes.",
    competition_format: "bracket_se", tee_time: "09:00",
    points_distribution: { type: "placement", split: [3, 1] },
    pairings_published_at: new Date(0).toISOString(), scoring_enabled: true, entry_mode: "outcome",
  }).eq("id", gameId));
  return { matchId, groupId };
}

/** Everything PLAYED — the state both levels must remove. */
async function play(gameId: string, matchId: string) {
  const owner = ctx.user.id;
  await ck("score", ctx.admin.from("score_entries").insert({
    id: crypto.randomUUID(), game_id: gameId, participant_id: owner, participant_type: "user",
    unit_label: "1", value: 4, submitted_by: owner,
  }));
  await ck("outcome", ctx.admin.from("match_hole_outcomes").insert({
    id: crypto.randomUUID(), game_id: gameId, match_id: matchId,
    hole_number: 1, result: "side_a", submitted_by: owner,
  }));
  await ck("result", ctx.admin.from("game_results").insert({
    id: crypto.randomUUID(), game_id: gameId, entity_type: "user", entity_id: owner, position: 1,
  }));
  await ck("match result", ctx.admin.from("game_matches")
    .update({ result: "a_win", margin: "2&1", status: "complete" }).eq("id", matchId));
  const { data: bm } = await ctx.admin.from("bracket_matches").select("id, entrant_a_id").eq("game_id", gameId).limit(1);
  if (bm?.[0]) {
    await ck("pick", ctx.admin.from("bracket_matches")
      .update({ winner_entrant_id: (bm[0] as { entrant_a_id: string }).entrant_a_id })
      .eq("id", (bm[0] as { id: string }).id));
  }
  await ck("live", ctx.admin.from("games").update({ status: "complete" }).eq("id", gameId));
}

/** Difference report that names the table AND the rows, so a failure is actionable. */
function diff(a: Record<string, string[]>, b: Record<string, string[]>): string[] {
  const out: string[] = [];
  for (const table of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[table] ?? [], y = b[table] ?? [];
    if (JSON.stringify(x) !== JSON.stringify(y)) {
      out.push(`${table}:\n    expected ${x.length} row(s): ${JSON.stringify(x)}\n    actual   ${y.length} row(s): ${JSON.stringify(y)}`);
    }
  }
  return out;
}

beforeAll(async () => {
  ctx = await TestContext.create();
  const schema = await liveSchema();
  gameScopedTables = Object.keys(schema)
    .filter((t) => schema[t].includes("game_id"))
    // The push log is audit, kept by design at every level (nothing reads it — see 125).
    .filter((t) => t !== "push_send_log")
    .sort();
  expect(gameScopedTables.length, "no game-scoped tables discovered — schema read failed").toBeGreaterThan(5);

  // Sequential, never Promise.all — these race and flake (CLAUDE.md local-stack rules).
  tripId = await ctx.createTrip("Reset Equivalence");
  await ctx.addTripMember(tripId, "member");
  competitionId = await ctx.createCompetition(tripId, "Reset Cup");
  teamId = crypto.randomUUID();
  await ck("team", ctx.admin.from("teams").insert({
    id: teamId, competition_id: competitionId, name: "Alpha", short_name: "ALP",
    color: "#2dd4bf", color_dim: "#1c8f82",
  }));
}, 60_000);

afterAll(async () => { await ctx?.cleanup(); });

describe("game reset — target-state equivalence", () => {
  it("level 2 returns a played, configured game to exactly a newly-added game", async () => {
    const fresh = await addGame("Equivalence Game", 12);
    const played = await addGame("Equivalence Game", 12);

    const { matchId } = await configure(played);
    await play(played, matchId);

    const { error } = await ctx.admin.rpc("_reset_game_to_skeleton", { p_game_id: played });
    expect(error, `reset failed: ${error?.message}`).toBeNull();

    const differences = diff(await snapshotGame(fresh), await snapshotGame(played));
    expect(
      differences,
      "A reset game still differs from a newly-added one. Each entry is a table whose " +
        "state survived the reset — it is either a column reset does not clear, or rows " +
        "it does not delete:\n  " + differences.join("\n  "),
    ).toEqual([]);
  }, 60_000);

  it("level 1 returns a played game to exactly its own pre-play state", async () => {
    const game = await addGame("Scores Only", 8);
    const { matchId } = await configure(game);

    const ready = await snapshotGame(game);   // configured, nothing played
    await play(game, matchId);

    const { error } = await ctx.admin.rpc("_reset_game_scoring", { p_game_id: game });
    expect(error, `reset failed: ${error?.message}`).toBeNull();

    const after = await snapshotGame(game);
    // `status` is knowingly excluded: level 1 leaves it 'pending' while a Ready game
    // was 'pending' too — but see #895, where status moving alone (without
    // scoring_enabled / pairings_published_at) is the open CLAUDE.md #25 violation.
    // Everything else must match exactly.
    const differences = diff(ready, after);
    expect(
      differences,
      "Clearing scores changed something that was not played, or left something that " +
        "was:\n  " + differences.join("\n  "),
    ).toEqual([]);
  }, 60_000);
});
