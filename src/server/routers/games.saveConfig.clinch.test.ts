import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";
import { configToDraft, configDraftToPayload, type ConfigDraft } from "../../lib/configDraft";
import { computeCompetitionLeaderboard } from "../lib/competitionLeaderboard";

/**
 * `games.saveConfig` must reconcile the clinch claim — the hole #841 left.
 *
 * #841's rule is that the claim is released on EVERY un-clinching path, and it
 * was implemented by wiring the individual setters: `setPointsTotal`,
 * `setPointsDistribution`, `games.delete`, both resets, `teams.delete`. It
 * missed the composite RPC.
 *
 * Which is the one that matters: all four formats commit their WHOLE settings
 * page through `save_game_config` and nothing self-persists per row
 * (CLAUDE.md #18). So the wired setters are the ones nobody takes, and the path
 * the settings page actually uses was the uncovered one.
 *
 * ── The failure it produces ─────────────────────────────────────────────────
 * A cup clinches and announces. An owner opens game settings and raises a point
 * total enough that the leader is no longer decided. No reconcile runs, so the
 * claim stays held on a cup that is no longer clinched. When the cup genuinely
 * re-clinches later, the claim is already held, the check takes the
 * `already_claimed` exit, and nothing is sent. The suppression is correct given
 * a stale claim — the bug is entirely that the claim went stale.
 */

const MATCH_PLAY = "gtt_match_play";

let ctx: TestContext;

/**
 * EVERY CASE BUILDS ITS OWN CUP (#1527). The cases shared one cup and one
 * "lever" game, each moving the lever's points total and the claim and leaving
 * them for the next: "un-clinches releases" needed a cup that was decided and
 * unclaimed, and "creates a clinch stays silent" cleared the column by hand
 * first. Shuffled, the un-clinch case met a lever another case had left at 100.
 * Each case now builds a decided cup, asserts it IS decided (the old cases
 * assumed it), and sets the claim through the real function.
 */
type Cup = { tripId: string; competitionId: string; teamWin: string; teamLose: string; leverGameId: string };

async function reconcileCup(label: string): Promise<Cup> {
  const tripId = await ctx.createTrip(`saveConfig clinch ${label}`);
  const competitionId = await ctx.createCompetition(tripId, `Reconcile Cup ${label}`, { scoringModel: "match_play" });
  const teamWin = await ctx.createTeam(competitionId, "Winner", { shortName: "WIN" });
  const teamLose = await ctx.createTeam(competitionId, "Loser", { shortName: "LOS" });

  // A finished game worth 2, banked entirely by `teamWin`. On its own the cup is
  // decided: pointsAvailable 2, winNumber 1.5, teamWin holds 2.
  const bankedGameId = crypto.randomUUID();
  const g = await ctx.admin.from("games").insert({
    id: bankedGameId,
    trip_id: tripId,
    competition_id: competitionId,
    game_type_id: "gtt_generic_yard",
    name: "banked",
    status: "complete",
    scoring_enabled: true,
    points_total: 2,
    points_distribution: { type: "placement", values: [2] },
  });
  if (g.error) throw new Error(`seed banked game: ${g.error.message}`);
  const r = await ctx.admin.from("game_results").insert([
    { id: crypto.randomUUID(), game_id: bankedGameId, entity_id: teamWin, entity_type: "team", value_kind: "rank", position: 1, raw_score: 1 },
    { id: crypto.randomUUID(), game_id: bankedGameId, entity_id: teamLose, entity_type: "team", value_kind: "rank", position: 2, raw_score: 2 },
  ]);
  if (r.error) throw new Error(`seed results: ${r.error.message}`);

  // The lever: a real game created through the real path, so its settings can be
  // saved through the real front door. Its points total is what moves
  // `pointsAvailable`, and therefore `winNumber`, and therefore the decision.
  const lever = (await ctx.caller().games.create({
    tripId,
    gameTypeId: MATCH_PLAY,
    name: "lever",
    competitionId,
  })) as { id: string };
  return { tripId, competitionId, teamWin, teamLose, leverGameId: lever.id };
}

/** Read the claim straight from the row — never inferred from a return value. */
async function heldClaim(cup: Cup): Promise<string | null> {
  const { data, error } = await ctx.admin
    .from("competitions")
    .select("clinch_notified_team_id")
    .eq("id", cup.competitionId)
    .single();
  if (error) throw new Error(`read claim: ${error.message}`);
  return (data?.clinch_notified_team_id as string | null) ?? null;
}

/** Put the claim in the state a DELIVERED clinch push would leave behind. */
async function claimFor(cup: Cup, teamId: string): Promise<boolean> {
  const { data, error } = await ctx.admin.rpc("claim_clinch_notification", {
    p_competition_id: cup.competitionId,
    p_team_id: teamId,
  });
  if (error) throw new Error(`claim: ${error.message}`);
  return data as boolean;
}

/** Is the cup decided for `teamWin`, by the predicate the clinch check uses? */
async function decidedForWinner(cup: Cup): Promise<boolean> {
  const board = await computeCompetitionLeaderboard(ctx.admin, cup.competitionId);
  const toClinch = (board.pointsToClinch ?? {}) as Record<string, number>;
  return toClinch[cup.teamWin] !== undefined && toClinch[cup.teamWin] <= 0;
}

/** Save `lever`'s settings through the REAL front door, mutating one slice. */
async function saveLever(cup: Cup, mutate: (d: ConfigDraft) => ConfigDraft): Promise<void> {
  const { tripId, leverGameId } = cup;
  const game = await ctx.caller().games.getById({ tripId, gameId: leverGameId });
  const delegates = (await ctx.caller().games.listOrganizers({
    tripId,
    gameId: leverGameId,
  })) as { user_id: string }[];
  const seeded = configToDraft(
    game as Parameters<typeof configToDraft>[0],
    [],
    delegates.map((d) => d.user_id)
  );
  const { hash } = await ctx.caller().games.configHash({ tripId, gameId: leverGameId });
  await ctx.caller().games.saveConfig({
    tripId,
    gameId: leverGameId,
    baseHash: hash,
    payload: configDraftToPayload(mutate(seeded), seeded),
  });
}

beforeAll(async () => {
  ctx = await TestContext.create();
}, 120_000);

afterAll(async () => {
  await ctx.cleanup();
}, 60_000);

describe("saveConfig reconciles the clinch claim", () => {
  it("a save that UN-CLINCHES releases the claim", async () => {
    // The cup is decided for teamWin and the claim is held, exactly as a
    // delivered clinch push leaves it.
    const cup = await reconcileCup("unclinch");
    expect(await decidedForWinner(cup)).toBe(true);
    expect(await claimFor(cup, cup.teamWin)).toBe(true);
    expect(await heldClaim(cup)).toBe(cup.teamWin);

    // Raise the lever's total to 100. `pointsAvailable` becomes 102 and
    // `winNumber` 51.5, so teamWin's banked 2 no longer decides anything.
    await saveLever(cup, (d) => ({ ...d, pointsTotal: 100 }));
    expect(await decidedForWinner(cup)).toBe(false);

    expect(
      await heldClaim(cup),
      "the claim must be released — otherwise a genuine re-clinch is suppressed as already announced"
    ).toBeNull();
  }, 60_000);

  it("a save that leaves the SAME team clinched does NOT release", async () => {
    const cup = await reconcileCup("still-clinched");
    expect(await decidedForWinner(cup)).toBe(true);
    expect(await claimFor(cup, cup.teamWin)).toBe(true);
    expect(await heldClaim(cup)).toBe(cup.teamWin);

    // An edit that touches settings but not the decision.
    await saveLever(cup, (d) => ({ ...d, name: "lever renamed" }));
    expect(await decidedForWinner(cup)).toBe(true);

    expect(
      await heldClaim(cup),
      "releasing here would re-announce a clinch that never stopped being true"
    ).toBe(cup.teamWin);
  }, 60_000);

  it("reconciling never CLAIMS — a save that creates a clinch stays silent", async () => {
    // The direction that must NOT fire. With no claim held, a save that leaves
    // the cup decided has to leave the column null: announcing a newly-decided
    // cup from a config edit is a separate, larger gap (documented on
    // `reconcileClinchClaim`), and quietly claiming here would both fire
    // retroactively and suppress the real announcement when it comes.
    const cup = await reconcileCup("never-claims");
    expect(await decidedForWinner(cup)).toBe(true); // premise: there IS a clincher to (not) claim
    expect(await heldClaim(cup)).toBeNull();

    await saveLever(cup, (d) => ({ ...d, name: "lever renamed again" }));

    expect(await heldClaim(cup), "reconcile is release-only").toBeNull();
  }, 60_000);

  it("a side game's save is unaffected — no competition, no reconcile", async () => {
    // A side game (no competition) takes the null-competition path, and it must
    // not throw. (This said "~40% of production games are standalone" — that
    // was measured false: 0 of 60 on 2026-09-27; see CLAUDE.md #20.)
    const tripId = await ctx.createTrip("saveConfig clinch side game");
    const solo = (await ctx.caller().games.create({
      tripId,
      gameTypeId: MATCH_PLAY,
      name: "solo",
    })) as { id: string };

    const game = await ctx.caller().games.getById({ tripId, gameId: solo.id });
    const seeded = configToDraft(game as Parameters<typeof configToDraft>[0], [], []);
    const { hash } = await ctx.caller().games.configHash({ tripId, gameId: solo.id });

    await expect(
      ctx.caller().games.saveConfig({
        tripId,
        gameId: solo.id,
        baseHash: hash,
        payload: configDraftToPayload({ ...seeded, name: "solo renamed" }, seeded),
      })
    ).resolves.toEqual({ ok: true });
  }, 60_000);
});
