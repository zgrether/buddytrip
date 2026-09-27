import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";
import { configToStrokeDraft, strokeDraftToPayload } from "../../lib/configDraft";
import { gameFinishedMessage } from "./gameFinishNotify";

/**
 * The `game_finished` push for a SIDE game (PR 6b), asserted against REAL
 * finished games: who it goes to, what it says, where it links.
 *
 * The side-game sweep found two faults, neither visible from the sender, which
 * only reports device counts:
 *  - a side MATCH game's push said "Results are in." with no winner. Match play's
 *    push read TEAM result rows, and a game with no competition writes none;
 *  - every side game's push linked to its standalone route, whose exit landed on
 *    the Trip tab, when the Games page can panel it like any other game.
 *
 * And one question it could not settle: does a stroke player left in no group
 * get the push? Settled here through the app's own save path. They hold no
 * `game_participants` row (migration 102 prunes an unscored player absent from
 * every group, and the participants loop only UPDATEs), so no.
 *
 * Each case builds its own trip; nothing one writes is another's starting state.
 */

let ctx: TestContext;
let owner: string, member: string;

beforeAll(async () => {
  ctx = await TestContext.create();
  owner = ctx.user.id;
  member = ctx.getUser("member").id;
}, 60_000);

afterAll(async () => {
  await ctx.cleanup();
}, 60_000);

async function sideTrip(title: string): Promise<string> {
  const tripId = await ctx.createTrip(title);
  await ctx.addTripMember(tripId, "member", "Member");
  return tripId;
}

/** What the Games page names as this side game's winners: the push must agree. */
async function boardWinners(tripId: string, gameId: string): Promise<string[]> {
  const rows = (await ctx.caller().games.sideBoard({ tripId })) as { id: string; winners: string[] }[];
  const row = rows.find((r) => r.id === gameId);
  if (!row) throw new Error("side game missing from the side board");
  return row.winners;
}

describe("the game_finished push for a side game", () => {
  it("a side MATCH game names its winner, as the Games page does, and links to its panel", async () => {
    const tripId = await sideTrip("Side match push");
    const game = await ctx.caller().games.create({ tripId, gameTypeId: "gtt_match_play", name: "Grudge match" });
    const gameId = game.id as string;
    // Outcome entry: the hole-by-hole winner, the same mutation the entry view taps.
    await ctx.admin.from("games").update({ entry_mode: "outcome" }).eq("id", gameId);
    const matches = await ctx.caller().matches.setPairings({
      tripId,
      gameId,
      matches: [{ playersPerSide: 1, sideA: { members: [owner] }, sideB: { members: [member] }, matchNumber: 1 }],
    });
    const matchId = (matches as { id: string }[])[0].id;
    await ctx.caller().games.enableScoring({ tripId, gameId });
    for (let h = 1; h <= 3; h++) {
      await ctx.caller().matchOutcomes.upsertOutcome({ tripId, gameId, matchId, holeNumber: h, result: "side_a" });
    }
    for (let h = 4; h <= 16; h++) {
      await ctx.caller().matchOutcomes.upsertOutcome({ tripId, gameId, matchId, holeNumber: h, result: "halved" });
    }
    await ctx.caller().games.finish({ tripId, gameId });

    const winners = await boardWinners(tripId, gameId);
    // Both halves non-trivial, or the equality below proves nothing.
    expect(winners).toHaveLength(1);

    const { audience, message } = await gameFinishedMessage(ctx.admin, {
      tripId,
      gameId,
      gameName: "Grudge match",
      gameTypeId: "gtt_match_play",
      competitionId: null,
      strategy: "match_play",
      actorUserId: owner,
    });
    // EXACT: the winner's name, the SAME name the Games page shows. Before the
    // fix this read "Results are in.", the fallback for a summary with nothing in it.
    expect(message.body).toBe(`Won by ${winners[0]}`);
    // The panel over the Games page, not the standalone route.
    expect(message.url).toBe(`/trips/${tripId}?view=cup&game=${gameId}`);
    expect([...audience].sort()).toEqual([owner, member].sort());
  });

  it("a stroke player left in NO group is not in the audience; the grouped player is", async () => {
    const tripId = await sideTrip("Side stroke push");
    const g = (await ctx.caller().games.create({ tripId, gameTypeId: "gtt_stroke_play", name: "Practice round" })) as { id: string };
    const gameId = g.id;

    // Save 1, through the app's own builder: both players grouped. This is what
    // mints their game_participants rows.
    const fresh = await ctx.caller().games.getById({ tripId, gameId });
    const seeded = configToStrokeDraft(fresh as Parameters<typeof configToStrokeDraft>[0], {}, [], []);
    const both = { ...seeded, groups: [[owner, member]], strokes: { [owner]: 0, [member]: 0 } };
    await ctx.caller().games.saveConfig({
      tripId,
      gameId,
      baseHash: (await ctx.caller().games.configHash({ tripId, gameId })).hash,
      payload: strokeDraftToPayload(both, seeded),
    });
    const afterBoth = await ctx.admin.from("game_participants").select("user_id").eq("game_id", gameId);
    // CONTROL: the member really was a participant, so their absence below is a
    // removal and not a player who was never there.
    expect((afterBoth.data ?? []).map((r) => r.user_id).sort()).toEqual([owner, member].sort());

    // Save 2: the member is taken out of the group, and their strokes entry stays
    // in the draft, as it does in the UI.
    const ownerOnly = { ...both, groups: [[owner]] };
    await ctx.caller().games.saveConfig({
      tripId,
      gameId,
      baseHash: (await ctx.caller().games.configHash({ tripId, gameId })).hash,
      payload: strokeDraftToPayload(ownerOnly, both),
    });

    // The owner plays and the game is finalized.
    const scores = await ctx.admin.from("score_entries").insert(
      Array.from({ length: 18 }, (_, i) => ({
        id: genId("se"), game_id: gameId, participant_id: owner, participant_type: "user",
        unit_label: String(i + 1), value: 4, submitted_by: owner,
      }))
    );
    if (scores.error) throw new Error(`seed scores: ${scores.error.message}`);
    await ctx.caller().games.finish({ tripId, gameId });

    const { audience } = await gameFinishedMessage(ctx.admin, {
      tripId,
      gameId,
      gameName: "Practice round",
      gameTypeId: "gtt_stroke_play",
      competitionId: null,
      strategy: "stroke_total",
      actorUserId: owner,
    });
    expect(audience).toEqual([owner]);
  });
});
