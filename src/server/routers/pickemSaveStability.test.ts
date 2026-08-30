import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";
import {
  configToPickemDraft,
  pickemDraftToPayload,
  type PickemConfigDraft,
} from "@/lib/configDraft";

/**
 * A pick'em save that changes nothing must not move the config fingerprint.
 *
 * ── What churned, and why it mattered ──────────────────────────────────────
 *
 * `save_game_config` defaults `matchesStructureDirty` to TRUE when the key is
 * absent, and `pickemDraftToPayload` never sent it. So every save — a rename, a
 * points total, anything — clean-replaced `game_matches`: DELETE every row,
 * re-INSERT with fresh `gen_random_uuid()` ids. Those ids are hashed AND are the
 * `.order()` sort key in `readGameConfigHash`, so the fingerprint moved on a
 * save that changed nothing.
 *
 * Cost: every other open device re-pulls the whole game config for a non-change
 * (#16's cross-device sync), and anyone holding a base hash from before that
 * save gets a spurious "This game changed on another device" conflict.
 *
 * ── Asserted on the HASH, not on the row ids ───────────────────────────────
 *
 * The ids are the mechanism, not the requirement. A future fix that made them
 * deterministic, or that dropped `id` from the hashed columns, would keep this
 * green while an id-based assertion would fail for no reason. The hash is what
 * the sync and the concurrency check actually read.
 *
 * The payload goes through `pickemDraftToPayload` — the real client builder —
 * so this cannot pass on a hand-rolled shape the app never sends.
 */

let ctx: TestContext;
let tripId: string;
let competitionId: string;
let gameId: string;
let users: string[];

const hashOf = async () =>
  ((await ctx.caller().games.configHash({ tripId, gameId })) as { hash: string | null }).hash!;

const snapshot = async () => {
  const { data } = await ctx.admin.from("games").select("*").eq("id", gameId).single();
  return data as unknown as Parameters<typeof configToPickemDraft>[0];
};

/**
 * The stored pairings, mapped exactly as `PickemGameView` maps them into its
 * server mirror.
 *
 * Building the baseline WITHOUT them leaves every save looking structurally new,
 * so the dirty flag reports true and the churn survives the fix — the bug
 * wearing a fixture. The first version of this file did exactly that and failed
 * against correct code.
 */
async function storedMatches() {
  const { data } = await ctx.admin
    .from("game_matches")
    .select("display_order, side_a, side_b")
    .eq("game_id", gameId)
    .order("display_order");
  return (data ?? []).map((m, i) => ({
    matchNumber: i + 1,
    playersPerSide: 1 as const,
    a: (m.side_a as { id?: string } | null)?.id ? [(m.side_a as { id: string }).id] : [],
    b: (m.side_b as { id?: string } | null)?.id ? [(m.side_b as { id: string }).id] : [],
    handicap: 0,
    pointValue: null,
  }));
}

/** The settings page's Save, built the way the page builds it. */
async function save(over: Partial<PickemConfigDraft> = {}) {
  const base = configToPickemDraft(
    await snapshot(),
    [],
    { rollUp: "individual_matches", useConfidence: true },
    await storedMatches()
  );
  const draft: PickemConfigDraft = { ...base, ...over };
  await ctx.caller().games.saveConfig({
    tripId,
    gameId,
    baseHash: await hashOf(),
    payload: pickemDraftToPayload(draft, base),
  });
}

const PAIRING = (u: string[]) => [
  { matchNumber: 1, playersPerSide: 1 as const, a: [u[0]], b: [u[1]], handicap: 0, pointValue: null },
  // A spare player with no opponent — the reported setup, and the shape a naive
  // dirty-check reports as changed on every save.
  { matchNumber: 2, playersPerSide: 1 as const, a: [u[2]], b: [], handicap: 0, pointValue: null },
];

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("pickem save stability");
  await ctx.addTripMember(tripId, "member", "Member");
  await ctx.addTripMember(tripId, "planner", "Organizer");
  competitionId = await ctx.createCompetition(tripId, "stability cup");
  users = [ctx.user.id, ctx.getUser("member").id, ctx.getUser("planner").id];

  const g = (await ctx.caller().games.create({
    tripId,
    gameTypeId: "gtt_pickem",
    name: "Stability",
    competitionId,
  })) as { id: string };
  gameId = g.id;

  // Establish the pairing. This save SHOULD move the hash — the structure is new.
  await save({ pointsTotal: 24, matches: PAIRING(users) });
}, 120_000);

afterAll(async () => {
  await ctx.admin.from("game_matches").delete().eq("game_id", gameId);
  await ctx.admin.from("games").delete().eq("id", gameId);
  await ctx.cleanup();
}, 60_000);

describe("an identical pick'em save", () => {
  it("does NOT move the config hash", async () => {
    const before = await hashOf();
    await save({ pointsTotal: 24, matches: PAIRING(users) });
    expect(await hashOf()).toBe(before);
  }, 120_000);

  it("is still stable on a THIRD save — not merely different once", async () => {
    const before = await hashOf();
    await save({ pointsTotal: 24, matches: PAIRING(users) });
    await save({ pointsTotal: 24, matches: PAIRING(users) });
    expect(await hashOf()).toBe(before);
  }, 120_000);

  it("keeps the pairing — stability must not come from writing nothing", async () => {
    /**
     * The control. "The hash did not move" is also true of a build that dropped
     * the matches on the floor, which is the failure mode a too-eager
     * not-dirty flag produces. The rows have to still be there and still be
     * paired.
     */
    const { data } = await ctx.admin
      .from("game_matches")
      .select("match_number, side_a, side_b")
      .eq("game_id", gameId);
    expect(data).toHaveLength(1);
    expect((data ?? [])[0]?.side_a).toBeTruthy();
    expect((data ?? [])[0]?.side_b).toBeTruthy();
  }, 60_000);

  it("STILL moves the hash when the pairing genuinely changes", async () => {
    /**
     * The other half of the rule, and the case that fails against a build which
     * simply always reports clean. Without it, "does not churn" is satisfied by
     * never propagating anything.
     */
    const before = await hashOf();
    await save({
      pointsTotal: 24,
      matches: [
        { matchNumber: 1, playersPerSide: 1 as const, a: [users[0]], b: [users[2]], handicap: 0, pointValue: null },
      ],
    });
    expect(await hashOf()).not.toBe(before);
  }, 120_000);
});
