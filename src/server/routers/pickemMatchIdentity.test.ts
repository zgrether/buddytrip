import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { TestContext } from "../../__tests__/helpers/test-setup";
import {
  configToPickemDraft,
  pickemDraftToPayload,
  type PickemConfigDraft,
} from "@/lib/configDraft";

/**
 * A pick'em game must not be able to trap itself in a config desync.
 *
 * ── The bug, and why it read as something else ─────────────────────────────
 *
 * `matchesToSaveRows` drops unfilled matches and PRESERVES each survivor's own
 * `matchNumber`, so clearing a pairing in the middle stores 1,3 — a gap. The
 * view then mapped stored rows back to the draft as `matchNumber: i + 1`,
 * densely by index, because `pickem.get` never returned the real column. So the
 * draft said 1,2 while the table said 1,2… and 3.
 *
 * Every later save that did NOT change the pairing took the RPC's fields-only
 * branch, which looks a row up BY `match_number`, found nothing for 2, and
 * raised `STRUCTURE_MISMATCH` — whose message is *"This game changed on another
 * device — reload before saving."*, the SAME SENTENCE the optimistic-concurrency
 * check uses.
 *
 * That is why it was reported as a concurrency bug on a game nobody else had
 * open, and why it looked like #1170 or #1172 had not landed. It is a third
 * cause, and unlike a stale hash it never healed: nothing about reading again
 * changes a number that was never stored.
 *
 * ── What these assert ──────────────────────────────────────────────────────
 *
 * The reproduction, end to end, through the real payload builder. A version
 * asserting only "the second save succeeds" would pass against a build that
 * stopped sending `matches` at all, so the pairing is read back afterwards.
 */

let ctx: TestContext;
let members: string[];
const madeGames: string[] = [];

/**
 * EVERY CASE BUILDS ITS OWN GAME (#1527). They shared one: the first case
 * created the gapped pairing, and "stays saveable" and "CLEARING the pairings"
 * both depended on it — shuffled ahead of it, CLEARING found no pairings to
 * clear (`expected 0 to be greater than 0`). Each case now builds an
 * individual-matches game, and those that need the gap make it themselves.
 */
type Game = { tripId: string; gameId: string };

async function identityGame(label: string): Promise<Game> {
  const tripId = await ctx.createTrip(`pickem match identity ${label}`);
  await ctx.addTripMember(tripId, "member", "Member");
  await ctx.addTripMember(tripId, "planner", "Organizer");
  await ctx.addTripMember(tripId, "outsider", "Member");
  const competitionId = await ctx.createCompetition(tripId, `identity cup ${label}`);
  const teamA = await ctx.createTeam(competitionId, "Alpha");
  const teamB = await ctx.createTeam(competitionId, "Bravo");
  const ta = await ctx.admin.from("team_assignments").insert([
    { competition_id: competitionId, user_id: members[0], team_id: teamA },
    { competition_id: competitionId, user_id: members[1], team_id: teamA },
    { competition_id: competitionId, user_id: members[2], team_id: teamB },
    { competition_id: competitionId, user_id: members[3], team_id: teamB },
  ]);
  if (ta.error) throw new Error(`seed assignments: ${ta.error.message}`);
  const g = (await ctx.caller().games.create({
    tripId,
    gameTypeId: "gtt_pickem",
    name: "Identity",
    competitionId,
  })) as { id: string };
  madeGames.push(g.id);
  const pg = await ctx.admin.from("pickem_games").upsert({
    game_id: g.id,
    roll_up: "individual_matches",
    use_confidence: true,
  });
  if (pg.error) throw new Error(`seed pickem_games: ${pg.error.message}`);
  return { tripId, gameId: g.id };
}

beforeAll(async () => {
  ctx = await TestContext.create();
  members = [
    ctx.user.id,
    ctx.getUser("planner").id,
    ctx.getUser("member").id,
    ctx.getUser("outsider").id,
  ];
}, 120_000);

afterAll(async () => {
  if (madeGames.length) {
    await ctx.admin.from("game_matches").delete().in("game_id", madeGames);
    await ctx.admin.from("games").delete().in("id", madeGames);
  }
  await ctx.cleanup();
}, 60_000);

const hash = async (g: Game) =>
  ((await ctx.caller().games.configHash({ tripId: g.tripId, gameId: g.gameId })) as { hash: string | null }).hash!;

const snapshot = async (g: Game) => {
  const { data, error } = await ctx.admin.from("games").select("*").eq("id", g.gameId).single();
  if (error) throw new Error(`read game: ${error.message}`);
  return data as unknown as Parameters<typeof configToPickemDraft>[0];
};

const rows = async (g: Game) => {
  const { data, error } = await ctx.admin
    .from("game_matches")
    .select("match_number, display_order, side_a, side_b")
    .eq("game_id", g.gameId)
    .order("display_order");
  if (error) throw new Error(`read matches: ${error.message}`);
  return data ?? [];
};

/**
 * The stored pairings as `PickemGameView` maps them — through `pickem.get`, so
 * this exercises the real column rather than re-deriving it. A fixture that
 * mapped positionally here would be reproducing the bug instead of testing it.
 */
const storedMatches = async (g: Game) => {
  const got = (await ctx.caller().pickem.get({ tripId: g.tripId, gameId: g.gameId })) as {
    matches: { matchNumber: number | null; sideAId: string | null; sideBId: string | null }[];
  };
  return got.matches.map((m, i) => ({
    matchNumber: m.matchNumber ?? i + 1,
    playersPerSide: 1 as const,
    a: m.sideAId ? [m.sideAId] : [],
    b: m.sideBId ? [m.sideBId] : [],
    handicap: 0,
    pointValue: null,
  }));
};

const baseDraft = async (g: Game, rollUp: "team_totals" | "individual_matches") =>
  configToPickemDraft(await snapshot(g), [], { rollUp, useConfidence: true }, await storedMatches(g));

const M = (n: number, a: string[], b: string[]) => ({
  matchNumber: n,
  playersPerSide: 1 as const,
  a,
  b,
  handicap: 0,
  pointValue: null,
});

async function save(g: Game, draft: PickemConfigDraft, base: PickemConfigDraft) {
  return ctx.caller().games.saveConfig({
    tripId: g.tripId,
    gameId: g.gameId,
    baseHash: await hash(g),
    payload: pickemDraftToPayload(draft, base),
  });
}

/**
 * Pair 1 and 3 with a MIDDLE row dropped. The dropped row is deliberately in
 * the middle — a ragged roster leaves its gap at the END, where dense
 * renumbering happens to agree and the bug hides.
 */
async function pairWithGap(g: Game) {
  const base = await baseDraft(g, "individual_matches");
  await save(
    g,
    {
      ...base,
      matches: [
        M(1, [members[0]], [members[2]]),
        M(2, [], []),
        M(3, [members[1]], [members[3]]),
      ],
    },
    base
  );
  // The gap is real and is what makes this worth guarding.
  expect((await rows(g)).map((r) => r.match_number)).toEqual([1, 3]);
}

describe("a gap in match_number does not trap the game", () => {
  it("pairs, drops a MIDDLE row, then saves an unrelated change", async () => {
    const g = await identityGame("trap");
    await pairWithGap(g);

    // Now change ONLY the roll-up. This is the save that used to be refused,
    // and to go on being refused forever.
    const base = await baseDraft(g, "individual_matches");
    await expect(save(g, { ...base, rollUp: "team_totals" }, base)).resolves.toBeDefined();

    // ...and the pairings survived it. Without this, "the save succeeded" is
    // also true of a build that stopped sending `matches` at all.
    expect((await rows(g)).map((r) => r.match_number)).toEqual([1, 3]);
  }, 180_000);

  it("stays saveable — the trap was permanent, not transient", async () => {
    // It never healed on its own: nothing about reading again changes a number
    // that was never stored. So a second attempt is the assertion that this is
    // fixed rather than merely retried past — on a game that HAS the gap.
    const g = await identityGame("permanent");
    await pairWithGap(g);
    const base = await baseDraft(g, "team_totals");
    await expect(save(g, { ...base, rollUp: "individual_matches" }, base)).resolves.toBeDefined();
    await expect(save(g, { ...base, rollUp: "team_totals" }, base)).resolves.toBeDefined();
  }, 180_000);

  it("CLEARING the pairings removes them, and the empty list is sent", async () => {
    /**
     * Clear used to hand back one blank row per person, which `matchesToSaveRows`
     * then dropped — so the grid showed eight rows, none of them a match, and
     * the save discarded all of them.
     *
     * Clearing to `[]` alone would have been worse: the payload only carried
     * `matches` when the DRAFT held some, so an emptied draft omitted the key
     * and the RPC preserved what was there. The condition now also asks whether
     * the BASELINE had any, which is what makes a clear a clear.
     */
    const g = await identityGame("clear");
    await pairWithGap(g);
    const base = await baseDraft(g, "individual_matches");
    expect(base.matches.length).toBeGreaterThan(0);

    const payload = pickemDraftToPayload({ ...base, matches: [] }, base) as {
      matches?: unknown[];
      matchesStructureDirty?: boolean;
    };
    expect(payload.matches, "an emptied draft must still send the key").toEqual([]);
    expect(payload.matchesStructureDirty).toBe(true);

    await save(g, { ...base, matches: [] }, base);
    expect(await rows(g)).toHaveLength(0);
  }, 180_000);

  it("a game that never had pairings still sends NO matches key", () => {
    /**
     * The inverse, and the reason the condition is not simply "always send".
     * An unconditional `matches: []` on a team-totals game reads as "clear every
     * pairing" — a destructive instruction from a screen that has no pairings on
     * it.
     */
    const empty = {
      ...({} as PickemConfigDraft),
      matches: [],
      pointsDistribution: null,
      rollUp: "team_totals" as const,
      useConfidence: true,
      delegates: [],
      name: "n",
      rulesForToday: null,
      gameTypeId: "gtt_pickem",
      competitionFormat: null,
      bracketConfig: null,
      scoringEnabled: false,
      pointsTotal: null,
    } as PickemConfigDraft;
    const payload = pickemDraftToPayload(empty, empty) as { matches?: unknown[] };
    expect("matches" in payload).toBe(false);
  });
});

/**
 * SOURCE GUARD — the VIEW's half, which the cases above cannot see.
 *
 * Written because a mutation exposed the gap rather than because the shape felt
 * worth pinning. Reverting `PickemGameView`'s mapping to `i + 1` — the exact
 * bug — broke NOTHING above, because those cases build their draft from
 * `pickem.get` directly rather than through the view. The fixture reproduces the
 * view's mapping instead of exercising it, so mutating the view is invisible to
 * it.
 *
 * That is the honest limit: this suite has no React renderer, so the view's
 * memo cannot be run. Mutating the SERVER half does fail two of them, so the
 * round trip is genuinely covered — it is only the client's use of the column
 * that needs saying here.
 */
describe("the view uses the stored match number (source)", () => {
  const SRC = readFileSync(
    resolve(__dirname, "../../components/games/PickemGameView.tsx"),
    "utf8"
  );
  const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");

  it("the scan can see the mapping — not passing vacuously", () => {
    expect(CODE).toContain("configToPickemDraft");
    expect(CODE).toContain("matchNumber:");
    // ...and the stripping happened: the paragraph above the mapping explains
    // the bug by naming the thing this asserts is gone.
    expect(CODE).not.toContain("positional fiction");
  });

  it("does not renumber positionally", () => {
    expect(
      /matchNumber:\s*m\.matchNumber\s*\?\?\s*i \+ 1/.test(CODE),
      "PickemGameView is not reading the stored match number. Renumbering by " +
        "index is only correct while no row has ever been dropped — and " +
        "matchesToSaveRows drops unfilled ones, so a pairing cleared in the " +
        "middle leaves a gap the RPC then cannot find. That trapped a game " +
        "permanently, behind the same sentence the baseHash check uses."
    ).toBe(true);
  });
});
