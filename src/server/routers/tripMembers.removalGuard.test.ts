import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

/**
 * #951 — removing a member must not orphan their participation.
 *
 * Before this guard the removal was a SILENT SUCCESS: `trip_members` went, and
 * every scoring row stayed, because those tables key to `users` rather than to
 * `trip_members` so nothing cascades and nothing errors. It surfaced later as a
 * scorecard row reading "Player".
 *
 * The two cases are deliberately separated, because ~40% of a real roster is in
 * the second one and the common case must stay clean and silent:
 *   no participation  -> removal succeeds, unchanged behaviour
 *   participation     -> refused, NOTHING deleted
 *
 * Both removal paths are covered. #957 was exactly a guard present in one
 * procedure and missing from its sibling, and `ghostCrew.remove` is this one's
 * sibling.
 */

const STROKE = "gtt_stroke_play";
let ctx: TestContext;
let tripId: string;

async function makeGameWith(userId: string, opts: { withScore: boolean; name: string }) {
  const g = (await ctx.caller().games.create({ tripId, gameTypeId: STROKE, name: opts.name })) as { id: string };
  await ctx.admin.from("game_participants").insert({
    id: crypto.randomUUID(), game_id: g.id, user_id: userId,
  });
  if (opts.withScore) {
    await ctx.admin.from("score_entries").insert({
      id: crypto.randomUUID(), game_id: g.id, participant_id: userId,
      participant_type: "user", unit_label: "1", value: 4, submitted_by: userId,
    });
  }
  return g.id;
}

describe("#951 — removal refuses rather than orphaning participation", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
    tripId = await ctx.createTrip("Removal Guard Trip");
    await ctx.addTripMember(tripId, "member", "Member");
    await ctx.addTripMember(tripId, "outsider", "Member");
  }, 90_000);

  afterAll(async () => {
    await ctx.cleanup();
  }, 60_000);

  it("ALLOWS removing a member with no participation (the common case)", async () => {
    const target = ctx.getUser("outsider").id;
    await expect(
      ctx.caller().tripMembers.remove({ tripId, userId: target })
    ).resolves.toMatchObject({ success: true });

    const { data } = await ctx.admin
      .from("trip_members").select("user_id")
      .eq("trip_id", tripId).eq("user_id", target).maybeSingle();
    expect(data).toBeNull();

    await ctx.admin.from("trip_members")
      .insert({ trip_id: tripId, user_id: target, role: "Member", status: "in" });
  }, 60_000);

  it("REFUSES removing a member who has scores, and deletes NOTHING", async () => {
    const target = ctx.getUser("member").id;
    const gameId = await makeGameWith(target, { withScore: true, name: "Saturday Stroke" });

    await expect(
      ctx.caller().tripMembers.remove({ tripId, userId: target })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

    // The membership survives — a refusal must not half-apply.
    const { data: tm } = await ctx.admin
      .from("trip_members").select("user_id")
      .eq("trip_id", tripId).eq("user_id", target).maybeSingle();
    expect(tm).toMatchObject({ user_id: target });

    const { data: gp } = await ctx.admin
      .from("game_participants").select("user_id").eq("game_id", gameId);
    expect(gp).toHaveLength(1);

    await ctx.admin.from("score_entries").delete().eq("game_id", gameId);
    await ctx.admin.from("game_participants").delete().eq("game_id", gameId);
    await ctx.admin.from("games").delete().eq("id", gameId);
  }, 60_000);

  it("REFUSES on participation alone, with no scores yet", async () => {
    // A rostered player who hasn't teed off still orphans a participant row.
    const target = ctx.getUser("member").id;
    const gameId = await makeGameWith(target, { withScore: false, name: "Not Started Yet" });

    await expect(
      ctx.caller().tripMembers.remove({ tripId, userId: target })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

    await ctx.admin.from("game_participants").delete().eq("game_id", gameId);
    await ctx.admin.from("games").delete().eq("id", gameId);
  }, 60_000);

  it("the message NAMES the games and points at the documented workaround", async () => {
    const target = ctx.getUser("member").id;
    const gameId = await makeGameWith(target, { withScore: true, name: "Sunday Scramble" });

    let msg = "";
    try {
      await ctx.caller().tripMembers.remove({ tripId, userId: target });
    } catch (e) {
      msg = (e as Error).message;
    }
    // ~40% of a real roster hits this, so "no" on its own would be infuriating.
    expect(msg).toContain("Sunday Scramble");
    expect(msg).toMatch(/enter a score/i);

    await ctx.admin.from("score_entries").delete().eq("game_id", gameId);
    await ctx.admin.from("game_participants").delete().eq("game_id", gameId);
    await ctx.admin.from("games").delete().eq("id", gameId);
  }, 60_000);

  it("the count in the message matches the list under it (mixed case)", async () => {
    // Regression: an earlier message said "has scores in 1 game" and then named
    // TWO, because the count came from the scored subset while the list came
    // from all blockers. Found by looking at the rendered panel, not by a test.
    const target = ctx.getUser("member").id;
    const scoredGame = await makeGameWith(target, { withScore: true, name: "Has Scores" });
    const emptyGame = await makeGameWith(target, { withScore: false, name: "No Scores" });

    const info = await ctx.caller().tripMembers.removalBlockers({ tripId, userId: target });
    expect(info.blockers).toHaveLength(2);
    // Names BOTH, and does NOT claim both are scored.
    expect(info.message).toContain("Has Scores");
    expect(info.message).toContain("No Scores");
    expect(info.message).toMatch(/playing in 2 games, with scores in 1/);
    expect(info.message).not.toMatch(/has scores in 2 games/);

    for (const id of [scoredGame, emptyGame]) {
      await ctx.admin.from("score_entries").delete().eq("game_id", id);
      await ctx.admin.from("game_participants").delete().eq("game_id", id);
      await ctx.admin.from("games").delete().eq("id", id);
    }
  }, 60_000);

  it("ghostCrew.remove obeys the SAME rule — the sibling gap #957 warned about", async () => {
    const ghost = await ctx.caller().ghostCrew.create({ tripId, name: "Playing Placeholder" });
    const gameId = await makeGameWith(ghost.id, { withScore: true, name: "Ghost's Round" });

    await expect(
      ctx.caller().ghostCrew.remove({ tripId, guestUserId: ghost.id })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

    const { data: tm } = await ctx.admin
      .from("trip_members").select("user_id")
      .eq("trip_id", tripId).eq("user_id", ghost.id).maybeSingle();
    expect(tm).toMatchObject({ user_id: ghost.id });

    await ctx.admin.from("score_entries").delete().eq("game_id", gameId);
    await ctx.admin.from("game_participants").delete().eq("game_id", gameId);
    await ctx.admin.from("games").delete().eq("id", gameId);
    await ctx.admin.from("trip_members").delete().eq("trip_id", tripId).eq("user_id", ghost.id);
    await ctx.admin.from("users").delete().eq("id", ghost.id);
  }, 60_000);

  it("ghostCrew.remove still removes a placeholder who has NOT played", async () => {
    const ghost = await ctx.caller().ghostCrew.create({ tripId, name: "Never Played" });
    await expect(
      ctx.caller().ghostCrew.remove({ tripId, guestUserId: ghost.id })
    ).resolves.toMatchObject({ success: true });
    await ctx.admin.from("users").delete().eq("id", ghost.id);
  }, 60_000);

  it("removalBlockers reports the same verdict the mutation enforces", async () => {
    const target = ctx.getUser("member").id;
    const clean = await ctx.caller().tripMembers.removalBlockers({ tripId, userId: target });
    expect(clean.blockers).toEqual([]);
    expect(clean.message).toBeNull();

    const gameId = await makeGameWith(target, { withScore: true, name: "Blocker Probe" });
    const blocked = await ctx.caller().tripMembers.removalBlockers({ tripId, userId: target });
    expect(blocked.blockers).toHaveLength(1);
    expect(blocked.blockers[0]).toMatchObject({ gameName: "Blocker Probe", hasScores: true });
    expect(blocked.message).toContain("Blocker Probe");

    await ctx.admin.from("score_entries").delete().eq("game_id", gameId);
    await ctx.admin.from("game_participants").delete().eq("game_id", gameId);
    await ctx.admin.from("games").delete().eq("id", gameId);
  }, 60_000);
});
