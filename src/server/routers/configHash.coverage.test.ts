import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";
import { HASH_COLS } from "./games";

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
 */

const NOT_HASHED: Record<keyof typeof HASH_COLS, string[]> = {
  games: ["id", "trip_id", "competition_id", "scheduled_at", "created_at", "schedule_item_id"],
  game_participants: ["id", "game_id", "created_at"],
  play_groups: ["game_id", "created_at"],
  game_matches: ["game_id", "result", "margin", "status", "created_at"],
  game_delegates: ["game_id", "granted_by", "created_at"],
};

const TABLES = Object.keys(HASH_COLS) as (keyof typeof HASH_COLS)[];
const cols = (t: keyof typeof HASH_COLS) => HASH_COLS[t].split(",").map((s) => s.trim());

let ctx: TestContext;
let tripId: string;
let competitionId: string;
let gameId: string;

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
});

afterAll(async () => {
  await ctx.admin.from("game_matches").delete().eq("game_id", gameId);
  await ctx.admin.from("game_participants").delete().eq("game_id", gameId);
  await ctx.admin.from("play_groups").delete().eq("game_id", gameId);
  await ctx.admin.from("game_delegates").delete().eq("game_id", gameId);
  await ctx.admin.from("games").delete().eq("id", gameId);
  await ctx.cleanup();
});

describe("configHash coverage — every column of a hashed table is classified", () => {
  it.each(TABLES)("%s: no live column is unclassified (hash it or exclude it)", async (table) => {
    const filterCol = table === "games" ? "id" : "game_id";
    const { data, error } = await ctx.admin.from(table).select("*").eq(filterCol, gameId).limit(1);
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
