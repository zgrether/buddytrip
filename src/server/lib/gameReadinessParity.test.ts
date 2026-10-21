import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { TestContext } from "../../__tests__/helpers/test-setup";
import {
  configToNonGolfDraft,
  configToStrokeDraft,
  nonGolfDraftToPayload,
  strokeDraftToPayload,
  type NonGolfConfigDraft,
  type StrokeConfigDraft,
} from "@/lib/configDraft";
import { gameSetupReasons, SETUP_REASON_BLOCKS, type SetupReasonCode } from "@/lib/gameReadiness";
import { readSetupInput } from "./gameReadiness";

/**
 * PARITY: the shared readiness rule (`gameSetupReasons`) against the database
 * (Zach's Needs-attention ruling 3, 2026-10-21).
 *
 * Every go-live reason is a state `save_game_config` refuses, and a game with
 * none goes live. Each case builds the state through the app's own doors (the
 * settings payload builders, `games.create`, a member leaving the trip), reads
 * the reasons from the database through `readSetupInput` (the reads the board
 * and the enable guard use), then asks the database to take the game live.
 * The two answers must agree, in both directions: a refusal with no reason
 * would be a board saying "ready" over a Save that fails, and a reason with no
 * refusal a board nagging about nothing.
 *
 * The two reasons that block something else are held to THEIR refusals:
 * `too_many_places` to finalize (`games.finish`), `slate_empty` to opening
 * picks (`set_pickem_phase`).
 *
 * Each case builds its own trip: one removes a member, and the suite runs
 * shuffled, so no case may lean on what another left behind.
 */

let ctx: TestContext;
let owner: string, member: string, planner: string;

beforeAll(async () => {
  ctx = await TestContext.create();
  owner = ctx.user.id;
  member = ctx.getUser("member").id;
  planner = ctx.getUser("planner").id;
}, 60_000);
afterAll(async () => {
  await ctx.cleanup();
}, 60_000);

/** Owner on Alpha, member on Bravo, planner on no team. A head-to-head Cup by
 *  default; a Tournament with teams for the formats a Cup refuses (stroke play,
 *  a bracket). */
async function cup(label: string, scoringModel: "match_play" | "points" = "match_play") {
  const c = await ctx.createCupTrip({
    name: `parity ${label}`,
    scoringModel,
    members: [["member", "Member"], ["planner", "Organizer"]],
    teams: ["Alpha", "Bravo"],
  });
  await ctx.assignTeam(c.competitionId, c.teamIds[0], [owner]);
  await ctx.assignTeam(c.competitionId, c.teamIds[1], [member]);
  return c;
}

async function newGame(tripId: string, competitionId: string, gameTypeId: string, extra: Record<string, unknown> = {}) {
  return ((await ctx.caller().games.create({ tripId, competitionId, gameTypeId, name: `parity ${gameTypeId}`, ...extra })) as { id: string }).id;
}

const snapshot = async (tripId: string, gameId: string) =>
  (await ctx.caller().games.getById({ tripId, gameId })) as Parameters<typeof configToNonGolfDraft>[0];
const hashOf = async (tripId: string, gameId: string) => (await ctx.caller().games.configHash({ tripId, gameId })).hash;

/** A non-golf save built the way the settings page builds it. `teamByUser` is
 *  what the page passes for a bracket: each entrant's team, from the rosters. */
async function saveNonGolf(
  tripId: string,
  gameId: string,
  over: Partial<NonGolfConfigDraft>,
  teamByUser: Record<string, string | null> = {}
) {
  const baseline = configToNonGolfDraft(await snapshot(tripId, gameId), []);
  const payload = nonGolfDraftToPayload({ ...baseline, ...over }, baseline, { teamByUser });
  return ctx.caller().games.saveConfig({ tripId, gameId, baseHash: await hashOf(tripId, gameId), payload });
}
async function saveStroke(tripId: string, gameId: string, over: Partial<StrokeConfigDraft>) {
  const baseline = configToStrokeDraft(await snapshot(tripId, gameId), {}, [], []);
  const payload = strokeDraftToPayload({ ...baseline, ...over }, baseline);
  return ctx.caller().games.saveConfig({ tripId, gameId, baseHash: await hashOf(tripId, gameId), payload });
}

/**
 * The reasons, read the way the enable guard reads them. With `board`, also
 * read the way the BOARD reads them (`competitions.leaderboard`, its own batched
 * reads) and require the two to agree, so the row a reader sees is the
 * database's answer too.
 */
async function reasonCodes(gameId: string, board?: { tripId: string; competitionId: string }): Promise<SetupReasonCode[]> {
  const input = await readSetupInput(ctx.admin, gameId);
  const codes = gameSetupReasons(input!).map((r) => r.code);
  if (board) {
    const lb = (await ctx.caller().competitions.leaderboard(board)) as { games: { id: string; setupReasons: { code: SetupReasonCode }[] }[] };
    const row = lb.games.find((g) => g.id === gameId);
    expect(row?.setupReasons.map((r) => r.code), "the board's row").toEqual(codes);
  }
  return codes;
}
const goLiveCodes = (codes: SetupReasonCode[]) => codes.filter((c) => SETUP_REASON_BLOCKS[c] === "go_live");
const isLive = async (gameId: string) =>
  (await ctx.admin.from("games").select("scoring_enabled").eq("id", gameId).single()).data?.scoring_enabled === true;

const pair = (a: string[], b: string[]) => ({ matchNumber: 1, playersPerSide: a.length as 1 | 2, a, b, handicap: 0, pointValue: null });

describe("go-live: every reason is a refusal, and no reason is no refusal", () => {
  it("points_missing: a cup game with no points", async () => {
    const { tripId, competitionId } = await cup("points");
    const gameId = await newGame(tripId, competitionId, "gtt_generic_card", { competitionFormat: "head_to_head", pointsTotal: 0 });
    expect(goLiveCodes(await reasonCodes(gameId, { tripId, competitionId }))).toEqual(["points_missing"]);
    await expect(saveNonGolf(tripId, gameId, { scoringEnabled: true })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(await isLive(gameId)).toBe(false);
  });

  it("CONTROL: the same game with points goes live", async () => {
    const { tripId, competitionId } = await cup("points control");
    const gameId = await newGame(tripId, competitionId, "gtt_generic_card", { competitionFormat: "head_to_head", pointsTotal: 4 });
    expect(goLiveCodes(await reasonCodes(gameId, { tripId, competitionId }))).toEqual([]);
    await saveNonGolf(tripId, gameId, { scoringEnabled: true });
    expect(await isLive(gameId)).toBe(true);
  });

  it("matches_none: a Matches game with no matches (#1686)", async () => {
    const { tripId, competitionId } = await cup("matches none");
    const gameId = await newGame(tripId, competitionId, "gtt_generic_card", { competitionFormat: "matches", pointsTotal: 4 });
    expect(goLiveCodes(await reasonCodes(gameId, { tripId, competitionId }))).toEqual(["matches_none"]);
    await expect(saveNonGolf(tripId, gameId, { scoringEnabled: true })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(await isLive(gameId)).toBe(false);
  });

  it("matches_unpaired: a paired player leaves the trip and their seat empties", async () => {
    const { tripId, competitionId } = await cup("unpaired");
    const gameId = await newGame(tripId, competitionId, "gtt_generic_card", { competitionFormat: "matches", pointsTotal: 4 });
    await saveNonGolf(tripId, gameId, { matches: [pair([owner], [member])] });
    await ctx.caller().tripMembers.remove({ tripId, userId: member });
    expect(goLiveCodes(await reasonCodes(gameId, { tripId, competitionId }))).toEqual(["matches_unpaired"]);
    await expect(saveNonGolf(tripId, gameId, { scoringEnabled: true })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(await isLive(gameId)).toBe(false);
  });

  it("player_not_on_team: a paired player taken off their team (222)", async () => {
    // The Save refuses pairing someone on no team, so the state is reached the
    // way it happens: paired while on a team, then taken off it.
    const { tripId, competitionId } = await cup("off team");
    const gameId = await newGame(tripId, competitionId, "gtt_generic_card", { competitionFormat: "matches", pointsTotal: 4 });
    await saveNonGolf(tripId, gameId, { matches: [pair([owner], [member])] });
    await ctx.caller().teamAssignments.remove({ tripId, competitionId, userId: member });
    expect(goLiveCodes(await reasonCodes(gameId, { tripId, competitionId }))).toEqual(["player_not_on_team"]);
    await expect(saveNonGolf(tripId, gameId, { scoringEnabled: true })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "A paired player isn't on a team. Fix the matchups before enabling scoring.",
    });
    expect(await isLive(gameId)).toBe(false);
  });

  it("CONTROL: every match paired, everyone on a team, goes live", async () => {
    const { tripId, competitionId } = await cup("matches control");
    const gameId = await newGame(tripId, competitionId, "gtt_generic_card", { competitionFormat: "matches", pointsTotal: 4 });
    await saveNonGolf(tripId, gameId, { matches: [pair([owner], [member])] });
    expect(goLiveCodes(await reasonCodes(gameId, { tripId, competitionId }))).toEqual([]);
    await saveNonGolf(tripId, gameId, { scoringEnabled: true });
    expect(await isLive(gameId)).toBe(true);
  });

  it("groups_none: stroke play with nobody in a group", async () => {
    const { tripId, competitionId } = await cup("groups", "points");
    const gameId = await newGame(tripId, competitionId, "gtt_stroke_play", { pointsTotal: 4 });
    expect(goLiveCodes(await reasonCodes(gameId, { tripId, competitionId }))).toEqual(["groups_none"]);
    await expect(saveStroke(tripId, gameId, { scoringEnabled: true })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(await isLive(gameId)).toBe(false);
  });

  it("CONTROL: stroke play with a group goes live", async () => {
    const { tripId, competitionId } = await cup("groups control", "points");
    const gameId = await newGame(tripId, competitionId, "gtt_stroke_play", { pointsTotal: 4 });
    await saveStroke(tripId, gameId, { groups: [[owner, member]] });
    expect(goLiveCodes(await reasonCodes(gameId, { tripId, competitionId }))).toEqual([]);
    await saveStroke(tripId, gameId, { scoringEnabled: true });
    expect(await isLive(gameId)).toBe(true);
  });

  it("bracket_field: a bracket with one entrant", async () => {
    const { tripId, competitionId, teamIds } = await cup("bracket", "points");
    const teams = { [owner]: teamIds[0], [member]: teamIds[1] };
    const gameId = await newGame(tripId, competitionId, "gtt_generic_card", { competitionFormat: "bracket", pointsTotal: 4 });
    await saveNonGolf(tripId, gameId, { bracketEntrants: [[owner]] }, teams);
    expect(goLiveCodes(await reasonCodes(gameId, { tripId, competitionId }))).toEqual(["bracket_field"]);
    await expect(saveNonGolf(tripId, gameId, { bracketEntrants: [[owner]], scoringEnabled: true }, teams)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(await isLive(gameId)).toBe(false);
  });

  it("CONTROL: a bracket with two entrants goes live", async () => {
    const { tripId, competitionId, teamIds } = await cup("bracket control", "points");
    const teams = { [owner]: teamIds[0], [member]: teamIds[1] };
    const gameId = await newGame(tripId, competitionId, "gtt_generic_card", { competitionFormat: "bracket", pointsTotal: 4 });
    await saveNonGolf(tripId, gameId, { bracketEntrants: [[owner], [member]] }, teams);
    expect(goLiveCodes(await reasonCodes(gameId, { tripId, competitionId }))).toEqual([]);
    await saveNonGolf(tripId, gameId, { bracketEntrants: [[owner], [member]], scoringEnabled: true }, teams);
    expect(await isLive(gameId)).toBe(true);
  });
});

describe("the reasons that block something else, against their own refusals", () => {
  async function teamlessSkins(label: string, values: number[]) {
    const { tripId, competitionId } = await ctx.createCupTrip({
      name: `parity ${label}`, scoringModel: "points", teams: [], members: [["member", "Member"], ["planner", "Organizer"]],
    });
    const gameId = await newGame(tripId, competitionId, "gtt_skins");
    await ctx.caller().games.addParticipants({ tripId, gameId, userIds: [owner, member, planner] });
    await ctx.groupStrokeParticipants(gameId, [owner, member, planner]);
    // The service role writes the split: the door a teamless race's settings
    // leave open, which is exactly what finalize's own check exists for.
    const total = values.reduce((a, b) => a + b, 0);
    const { error } = await ctx.admin
      .from("games").update({ points_total: total, points_distribution: { type: "placement", values } }).eq("id", gameId);
    if (error) throw error;
    return { tripId, gameId };
  }

  it("too_many_places: five places over three people, and finalize refuses", async () => {
    const { tripId, gameId } = await teamlessSkins("too many", [5, 4, 3, 2, 1]);
    expect(await reasonCodes(gameId)).toEqual(["too_many_places"]);
    await expect(ctx.caller().games.finish({ tripId, gameId })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("CONTROL: three places over three people, and finalize goes through", async () => {
    const { tripId, gameId } = await teamlessSkins("fits", [3, 2, 1]);
    expect(await reasonCodes(gameId)).toEqual([]);
    await ctx.caller().games.finish({ tripId, gameId });
    expect((await ctx.admin.from("games").select("status").eq("id", gameId).single()).data?.status).toBe("complete");
  });

  async function pickem(label: string) {
    const tripId = await ctx.createTrip(`parity ${label}`);
    const gameId = `parity-pickem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const { error } = await ctx.admin.from("games").insert({ id: gameId, trip_id: tripId, game_type_id: "gtt_pickem", name: "Pick'em" });
    if (error) throw error;
    return gameId;
  }
  const openPicks = (gameId: string) =>
    ctx.authedClient("owner").rpc("set_pickem_phase", { p_game_id: gameId, p_action: "open" });

  it("slate_empty: an empty slate, and opening picks refuses", async () => {
    const gameId = await pickem("slate");
    expect(await reasonCodes(gameId)).toEqual(["slate_empty"]);
    expect((await openPicks(gameId)).error?.message).toContain("EMPTY_SLATE");
  });

  it("CONTROL: a slate with a game, and picks open", async () => {
    const gameId = await pickem("slate control");
    const saved = await ctx.authedClient("owner").rpc("save_pickem_config", {
      p_game_id: gameId,
      p_payload: { slate: [{ id: `s-${gameId}`, awayTeam: "Alabama", homeTeam: "Georgia", spread: "-3.5", kickoff: "Thu", note: null, multiplier: 1 }] },
    });
    expect(saved.error).toBeNull();
    expect(await reasonCodes(gameId)).toEqual([]);
    expect((await openPicks(gameId)).error).toBeNull();
  });
});

/**
 * The guard that keeps the table above complete: the latest `save_game_config`
 * raises exactly as many go-live refusals as the rule has arms. A new refusal
 * in SQL with no reason here fails this until a case (and a code) is added.
 *
 *   points (093) · match play (221's sibling) · grouped formats (089) ·
 *   general points (093) · bracket field (117) · Matches (221) · team (222)
 */
describe("every go-live refusal in the database has a reason", () => {
  it("the latest save_game_config raises seven NOT_READY refusals", () => {
    const dir = join(__dirname, "../../../supabase/migrations");
    const latest = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .filter((f) => readFileSync(join(dir, f), "utf8").includes("CREATE OR REPLACE FUNCTION public.save_game_config("))
      .pop()!;
    const sql = readFileSync(join(dir, latest), "utf8");
    expect(latest).toMatch(/_222_/);
    expect((sql.match(/RAISE EXCEPTION 'NOT_READY:/g) ?? []).length).toBe(7);
  });
});
