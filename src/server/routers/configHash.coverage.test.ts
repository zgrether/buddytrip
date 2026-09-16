import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TestContext } from "../../__tests__/helpers/test-setup";
import { HASH_COLS } from "./games";
import { buildDraw } from "../../lib/bracket";
import { canonicalize, computeConfigHash } from "../../lib/configHash";

/**
 * The OBSERVATIONAL hash-coverage guard — the mechanical backstop for "everything the
 * RPC writes must be in the hash." The paired guard (games.saveConfig.p2.test.ts)
 * proves a HAND-PICKED field moves/doesn't-churn; this one OBSERVES the live schema —
 * `select('*')` on a fully-populated game returns every real column — and asserts each
 * column of each hashed table is CLASSIFIED: either in `HASH_COLS` (contributes to the
 * fingerprint) or in the explicit `NOT_HASHED` allowlist below (deliberately excluded).
 *
 * A migration that adds a column to a hashed table trips this test until someone decides
 * which it is. That's the fix for the gap that went silent FOUR times by hand
 * (`.from("matches")`, game_delegates, point_value/handicap_strokes, play_groups.tee_time)
 * — the RPC gained a write and nobody remembered to check the hash. Now CI remembers.
 *
 * NOT_HASHED reasons (why each is safe to exclude):
 *   • identity / scope / FK: id (where re-minted on clean-replace), game_id, trip_id,
 *     competition_id, schedule_item_id — not config content.
 *   • provenance (re-minted every write — hashing churns the fingerprint): created_at,
 *     granted_by. (The game_delegates churn trap, generalized.)
 *   • score-DERIVED (must never churn the config hash when scores change): game_matches
 *     result / margin / status. (CLAUDE.md #16: score-derived fields are excluded on
 *     purpose so entering scores never moves the config hash.)
 *   • scheduling (not part of the config the RPC writes): scheduled_at.
 *   • BOARD PRESENTATION (not game config): display_order. Same category as
 *     scheduled_at. The hash is polled per-GAME by open game surfaces to detect
 *     config drift, and nothing a game surface renders or computes depends on
 *     where the game sits on the leaderboard. Hashing it would move the
 *     fingerprint on every reorder and make every open game view on every device
 *     re-pull its whole config for a change that doesn't affect it. Propagation
 *     is the leaderboard's job — the reorder mutation invalidates
 *     `competitions.leaderboard` AND `competitions.faceBootstrap` (CLAUDE.md #10).
 */

const NOT_HASHED: Record<keyof typeof HASH_COLS, string[]> = {
  games: ["id", "trip_id", "competition_id", "scheduled_at", "created_at", "schedule_item_id", "display_order"],
  game_participants: ["id", "game_id", "created_at"],
  play_groups: ["game_id", "created_at"],
  game_matches: ["game_id", "result", "margin", "status", "created_at"],
  game_delegates: ["game_id", "granted_by", "created_at"],
  // `id` is deterministic here (`<game_id>:e<seed>`, migration 115) rather than
  // minted, so excluding it is about REDUNDANCY, not churn — `seed` already carries
  // everything the id encodes.
  bracket_entrants: ["id", "game_id", "created_at"],
  // `entrant_id` is the parent link this row is read THROUGH (an embedded select
  // under bracket_entrants), not content of its own.
  bracket_entrant_members: ["entrant_id"],
  // `winner_entrant_id` is the bracket's SCORE — the same category as
  // game_matches.result/margin/status above, and excluded for the same reason:
  // hashing a result would churn the config fingerprint every time someone
  // advanced a match, and would fail a concurrent settings save on a game whose
  // config nobody touched. Picks propagate by broadcast (#20), not by this hash.
  bracket_matches: ["id", "game_id", "winner_entrant_id", "created_at"],
  // The three CLOCK columns are the same category as `game_matches.status` and
  // `bracket_matches.winner_entrant_id`: the game's STATE, not its config.
  // `save_game_config` never writes them — `set_pickem_phase` and
  // `set_pickem_deadline` do — so the "everything the RPC writes must be
  // hashed" rule does not reach them. Hashing them would churn the fingerprint
  // every time the runner locked picks, forcing a full config refetch on every
  // open device and failing a concurrent settings save on a game whose config
  // nobody touched. They propagate by realtime (#19) plus the 60s poll.
  pickem_games: ["game_id", "picks_opened_at", "picks_deadline", "picks_locked_at", "created_at"],
};

const TABLES = Object.keys(HASH_COLS) as (keyof typeof HASH_COLS)[];
const cols = (t: keyof typeof HASH_COLS) => HASH_COLS[t].split(",").map((s) => s.trim());

/**
 * How to reach a table's rows for THIS game. Everything hangs off `game_id`
 * except `bracket_entrant_members`, which has none — it is scoped by its entrant,
 * which is exactly why the hash reads it as an embed rather than a table.
 */
const FILTER: Partial<Record<keyof typeof HASH_COLS, { col: string; via: "game" | "entrant" }>> = {
  games: { col: "id", via: "game" },
  bracket_entrant_members: { col: "entrant_id", via: "entrant" },
};

let ctx: TestContext;
let tripId: string;
let competitionId: string;
let gameId: string;
/** The bracket game — a SECOND populated game, because the bracket tables hang off
 *  a non-golf format and the match-play game above can never have rows in them. */
let bracketGameId: string;
/** A third game, for the same reason the bracket needs a second: a match-play
 *  game has no `pickem_games` row, and a table with no row makes this guard
 *  vacuous for it. */
let pickemGameId: string;
let entrantIds: string[] = [];

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("hash coverage Trip");
  await ctx.addTripMember(tripId, "planner", "Organizer");
  await ctx.addTripMember(tripId, "member", "Member");
  await ctx.addTripMember(tripId, "outsider", "Member");
  competitionId = await ctx.createCompetition(tripId, "hash coverage Cup");

  // A fully-populated game so `select('*')` returns a row for EVERY hashed table:
  // a 2v2 match mints game_matches + 4 game_participants + 2 play_groups; a delegate
  // grant writes game_delegates; games always has its row.
  const g = (await ctx.caller().games.create({ tripId, gameTypeId: "gtt_match_play", name: "Populated", competitionId })) as { id: string };
  gameId = g.id;
  const owner = ctx.user.id;
  const planner = ctx.getUser("planner").id;
  const member = ctx.getUser("member").id;
  const outsider = ctx.getUser("outsider").id;
  const draft = (await ctx.caller().games.getById({ tripId, gameId })) as Record<string, unknown>;
  await ctx.caller().games.saveConfig({
    tripId,
    gameId,
    baseHash: (await ctx.caller().games.configHash({ tripId, gameId })).hash,
    payload: {
      name: (draft.name as string) ?? "Populated",
      rulesForToday: null,
      scoringEnabled: false,
      entryMode: "score",
      modifiers: {},
      pointsTotal: 4,
      pointsDistribution: null,
      courseId: null,
      backCourseId: null,
      scorecardSchema: null,
      delegates: [],
      matches: [
        { matchNumber: 1, playersPerSide: 2, a: [owner, planner], b: [member, outsider], strokesA: 1, strokesB: 0, pointValue: null },
      ],
      matchesStructureDirty: true,
    },
  });
  await ctx.caller().games.addOrganizer({ tripId, gameId, userId: member });

  // Values whose JSON SPELLING could differ between PostgREST's serializer and
  // `jsonb_build_object` (migration 188): a fractional numeric, a numeric with a
  // trailing zero, a timestamptz, a text tee time. The parity test below is only
  // as good as the shapes put in front of it, and a null column proves nothing.
  {
    const up = await ctx.admin
      .from("games")
      .update({ points_total: 4.5, tee_time: "08:30", pairings_published_at: "2026-09-12T17:43:00.123456+00:00" })
      .eq("id", gameId);
    if (up.error) throw new Error(`seed game values: ${up.error.message}`);
    const pv = await ctx.admin.from("game_matches").update({ point_value: 1.250 }).eq("game_id", gameId);
    if (pv.error) throw new Error(`seed point_value: ${pv.error.message}`);
    const tt = await ctx.admin.from("play_groups").update({ tee_time: "09:10" }).eq("game_id", gameId);
    if (tt.error) throw new Error(`seed group tee_time: ${tt.error.message}`);
  }

  // A populated BRACKET game (115). Separate from the match-play game above
  // because the two are mutually exclusive: a bracket is a non-golf format, so
  // the game seeded for game_matches/play_groups can never carry entrants, and a
  // table with no row makes this whole guard vacuous for it (the `toBeTruthy`
  // below is what turns that into a failure rather than a silent pass).
  const teamId = await ctx.createTeam(competitionId, "Bracket Team");
  const bg = (await ctx.caller().games.create({ tripId, gameTypeId: "gtt_generic_card", name: "Bracket", competitionId })) as { id: string };
  bracketGameId = bg.id;
  const bDraft = (await ctx.caller().games.getById({ tripId, gameId: bracketGameId })) as Record<string, unknown>;
  await ctx.caller().games.saveConfig({
    tripId,
    gameId: bracketGameId,
    baseHash: (await ctx.caller().games.configHash({ tripId, gameId: bracketGameId })).hash,
    payload: {
      name: (bDraft.name as string) ?? "Bracket",
      rulesForToday: null,
      scoringEnabled: false,
      pointsTotal: 4,
      pointsDistribution: null,
      courseId: null,
      backCourseId: null,
      scorecardSchema: null,
      delegates: [],
      competitionFormat: "bracket",
      bracketConfig: { elimination: "single", entrants: "singles", seeding: "manual", consolation: false },
      // Three entrants → a 4-seat draw, so this also seeds the BYE shape
      // (`entrant_b_id IS NULL`) rather than only the tidy full-field one.
      bracketEntrants: [
        { seed: 1, teamId, userIds: [owner] },
        { seed: 2, teamId, userIds: [planner] },
        { seed: 3, teamId, userIds: [member] },
      ],
      bracketDraw: buildDraw(3).map((m) => ({ ...m })),
    },
  });
  const { data: ents } = await ctx.admin.from("bracket_entrants").select("id").eq("game_id", bracketGameId);
  entrantIds = (ents ?? []).map((e) => e.id as string);

  // A pick'em game with its config row (157/158). Seeded through the RPC rather
  // than a raw insert so the row is the shape the app actually writes.
  const pg = (await ctx
    .caller()
    .games.create({ tripId, gameTypeId: "gtt_pickem", name: "Populated pick'em", competitionId })) as {
    id: string;
  };
  pickemGameId = pg.id;
  await ctx.caller().games.saveConfig({
    tripId,
    gameId: pickemGameId,
    baseHash: (await ctx.caller().games.configHash({ tripId, gameId: pickemGameId })).hash,
    payload: {
      name: "Populated pick'em",
      rulesForToday: null,
      scoringEnabled: false,
      pointsTotal: 6,
      pointsDistribution: null,
      courseId: null,
      backCourseId: null,
      scorecardSchema: null,
      pickem: { rollUp: "individual_matches", useConfidence: false },
    },
  });
});

afterAll(async () => {
  await ctx.admin.from("game_matches").delete().eq("game_id", gameId);
  await ctx.admin.from("game_participants").delete().eq("game_id", gameId);
  await ctx.admin.from("play_groups").delete().eq("game_id", gameId);
  await ctx.admin.from("game_delegates").delete().eq("game_id", gameId);
  // Matches before entrants (FK), members cascade off the entrants delete.
  await ctx.admin.from("bracket_matches").delete().eq("game_id", bracketGameId);
  await ctx.admin.from("bracket_entrants").delete().eq("game_id", bracketGameId);
  // pickem_games cascades off the game row.
  await ctx.admin.from("games").delete().in("id", [gameId, bracketGameId, pickemGameId]);
  await ctx.cleanup();
});

describe("configHash coverage — every column of a hashed table is classified", () => {
  it.each(TABLES)("%s: no live column is unclassified (hash it or exclude it)", async (table) => {
    const f = FILTER[table] ?? { col: "game_id", via: "game" as const };
    const isBracketTable = table.startsWith("bracket_");
    const isPickemTable = table.startsWith("pickem_");
    const forGame = isBracketTable ? bracketGameId : isPickemTable ? pickemGameId : gameId;
    const q = ctx.admin.from(table).select("*");
    const { data, error } =
      f.via === "entrant" ? await q.in(f.col, entrantIds).limit(1) : await q.eq(f.col, forGame).limit(1);
    expect(error).toBeNull();
    const row = (data ?? [])[0] as Record<string, unknown> | undefined;
    expect(row, `no ${table} row — the seed must populate it`).toBeTruthy();

    const live = Object.keys(row!);
    const classified = new Set([...cols(table), ...NOT_HASHED[table]]);

    // (1) The catch: a live column that's neither hashed nor explicitly excluded. A new
    // migration column lands here until it's classified — the mechanical gap-#5 guard.
    const unclassified = live.filter((c) => !classified.has(c));
    expect(unclassified, `unclassified ${table} column(s) — add to HASH_COLS or NOT_HASHED`).toEqual([]);

    // (2) The inverse: a HASH_COLS entry that no longer exists (a renamed/dropped column
    // silently hashing nothing). Keeps the select honest against the schema.
    const stale = cols(table).filter((c) => !live.includes(c));
    expect(stale, `stale HASH_COLS entry for ${table} — column not in the live schema`).toEqual([]);
  });
});

// ── The single-call input (migration 188) ───────────────────────────────────
//
// `game_config_hash_input` returns the eight reads as one document, and its
// column lists are written out in SQL. That is a SECOND copy of HASH_COLS, and a
// second copy is how the four silent gaps above happened. So the same guard now
// closes both links: live schema ↔ HASH_COLS (above), and HASH_COLS ↔ the
// function's output (here). A column added to a hashed table fails the first
// until it is classified, and fails this one until the function returns it.

type HashInput = {
  game: Record<string, unknown> | null;
  participants: Record<string, unknown>[];
  groups: Record<string, unknown>[];
  matches: Record<string, unknown>[];
  delegates: Record<string, unknown>[];
  bracketEntrants: (Record<string, unknown> & { bracket_entrant_members: Record<string, unknown>[] })[];
  bracketDraw: Record<string, unknown>[];
  pickem: Record<string, unknown> | null;
};

async function rpcInput(client: SupabaseClient, forGame: string, forTrip = tripId): Promise<HashInput> {
  const { data, error } = await client.rpc("game_config_hash_input", { p_trip_id: forTrip, p_game_id: forGame });
  expect(error).toBeNull();
  return data as HashInput;
}

/**
 * The PostgREST reads the function replaced, kept here as the PARITY REFERENCE:
 * same selects, same orderings, same null/empty defaults as `readGameConfigHash`
 * had before 188. If the function's document hashes differently from this one,
 * every hash an open client holds is invalidated on deploy, and every settings
 * page open at that moment refuses its next Save as a conflict.
 */
async function postgrestInput(client: SupabaseClient, forGame: string): Promise<HashInput> {
  const [g, parts, groups, matches, delegates, entrants, draw, pickem] = await Promise.all([
    client.from("games").select(HASH_COLS.games).eq("id", forGame).eq("trip_id", tripId).maybeSingle(),
    client.from("game_participants").select(HASH_COLS.game_participants).eq("game_id", forGame).order("user_id", { ascending: true }),
    client.from("play_groups").select(HASH_COLS.play_groups).eq("game_id", forGame).order("id", { ascending: true }),
    client.from("game_matches").select(HASH_COLS.game_matches).eq("game_id", forGame).order("id", { ascending: true }),
    client.from("game_delegates").select(HASH_COLS.game_delegates).eq("game_id", forGame).order("user_id", { ascending: true }),
    client
      .from("bracket_entrants")
      .select(`${HASH_COLS.bracket_entrants}, bracket_entrant_members(${HASH_COLS.bracket_entrant_members})`)
      .eq("game_id", forGame)
      .order("seed", { ascending: true })
      .order("user_id", { referencedTable: "bracket_entrant_members", ascending: true }),
    client
      .from("bracket_matches")
      .select(HASH_COLS.bracket_matches)
      .eq("game_id", forGame)
      .order("bracket", { ascending: true })
      .order("round", { ascending: true })
      .order("slot", { ascending: true }),
    client.from("pickem_games").select(HASH_COLS.pickem_games).eq("game_id", forGame).maybeSingle(),
  ]);
  for (const r of [g, parts, groups, matches, delegates, entrants, draw, pickem]) expect(r.error).toBeNull();
  return {
    game: (g.data as Record<string, unknown> | null) ?? null,
    participants: (parts.data ?? []) as Record<string, unknown>[],
    groups: (groups.data ?? []) as Record<string, unknown>[],
    matches: (matches.data ?? []) as Record<string, unknown>[],
    delegates: (delegates.data ?? []) as Record<string, unknown>[],
    bracketEntrants: (entrants.data ?? []) as HashInput["bracketEntrants"],
    bracketDraw: (draw.data ?? []) as Record<string, unknown>[],
    pickem: (pickem.data as Record<string, unknown> | null) ?? null,
  };
}

/** Where each hashed table's rows sit in the function's document. */
function sampleFor(table: keyof typeof HASH_COLS, doc: HashInput): Record<string, unknown> | null | undefined {
  switch (table) {
    case "games": return doc.game;
    case "game_participants": return doc.participants[0];
    case "play_groups": return doc.groups[0];
    case "game_matches": return doc.matches[0];
    case "game_delegates": return doc.delegates[0];
    case "bracket_entrants": {
      const e = doc.bracketEntrants[0];
      if (!e) return undefined;
      // The embed key is the read path, not a column.
      const { bracket_entrant_members: _members, ...cols } = e;
      void _members;
      return cols;
    }
    case "bracket_entrant_members": return doc.bracketEntrants[0]?.bracket_entrant_members[0];
    case "bracket_matches": return doc.bracketDraw[0];
    case "pickem_games": return doc.pickem;
  }
}

const gameFor = (table: string) =>
  table.startsWith("bracket_") ? bracketGameId : table.startsWith("pickem_") ? pickemGameId : gameId;

describe("game_config_hash_input returns exactly HASH_COLS (migration 188)", () => {
  it.each(TABLES)("%s: the function's keys equal HASH_COLS", async (table) => {
    const doc = await rpcInput(ctx.authedClient("owner"), gameFor(table));
    const row = sampleFor(table, doc);
    expect(row, `the function returned no ${table} row for a game seeded with one`).toBeTruthy();
    expect(Object.keys(row!).sort()).toEqual([...cols(table)].sort());
  });
});

describe("game_config_hash_input hashes identically to the reads it replaced", () => {
  it.each([
    ["match play (participants, groups, matches, delegates, fractional numerics, a timestamp)", () => gameId],
    ["bracket (entrants with members, a draw with a bye)", () => bracketGameId],
    ["pick'em (its config row)", () => pickemGameId],
  ])("%s", async (_label, id) => {
    const client = ctx.authedClient("owner");
    const [viaRpc, viaPostgrest] = await Promise.all([rpcInput(client, id()), postgrestInput(client, id())]);
    // The canonical strings first, so a mismatch shows WHICH value is spelled
    // differently rather than two opaque 8-hex digests.
    expect(canonicalize(viaRpc)).toBe(canonicalize(viaPostgrest));
    expect(computeConfigHash(viaRpc)).toBe(computeConfigHash(viaPostgrest));
    // Premise: the document is not trivially empty, or equality proves nothing.
    expect(viaRpc.game).not.toBeNull();
  });

  it("a game the caller cannot see comes back as game: null, like the games read did", async () => {
    // SECURITY INVOKER (CLAUDE.md #28): RLS decides, as it did for the PostgREST
    // reads. A game in a trip the caller is not on must not be readable through
    // the function either.
    const otherTrip = await ctx.createTrip("hash input — not a member");
    const og = (await ctx.caller().games.create({ tripId: otherTrip, gameTypeId: "gtt_match_play", name: "Private" })) as { id: string };
    const { data: tm } = await ctx.admin
      .from("trip_members")
      .select("user_id")
      .eq("trip_id", otherTrip)
      .eq("user_id", ctx.getUser("outsider").id);
    expect(tm ?? [], "premise: the outsider is not on this trip").toEqual([]);

    const asOutsider = await rpcInput(ctx.authedClient("outsider"), og.id, otherTrip);
    expect(asOutsider.game).toBeNull();
    const asOwner = await rpcInput(ctx.authedClient("owner"), og.id, otherTrip);
    expect(asOwner.game).not.toBeNull();
    await ctx.admin.from("games").delete().eq("id", og.id);
  });

  it("the wrong trip id returns game: null, like the trip-scoped games read did", async () => {
    const doc = await rpcInput(ctx.authedClient("owner"), gameId, "not-this-trip");
    expect(doc.game).toBeNull();
  });
});
