import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";

const STROKE_PLAY = "gtt_stroke_play";

let ctx: TestContext;
let tripId: string;
let gameId: string;
let ownerId: string;
let memberId: string;

describe("scores router (Slice A — per-hole entry)", () => {
  beforeAll(async () => {
    ctx = await TestContext.create();
    tripId = await ctx.createTrip("Scoring Trip");
    await ctx.addTripMember(tripId, "member", "Member");
    ownerId = ctx.user.id;
    memberId = ctx.getUser("member").id;
    const game = await ctx
      .caller()
      .games.create({ tripId, gameTypeId: STROKE_PLAY, name: "Round" });
    gameId = game.id;
    await ctx.caller().games.addParticipants({ tripId, gameId, userIds: [ownerId, memberId] });
    // Phase 2B.1: scoring must be enabled before entries land (universal gate).
    await ctx.caller().games.enableScoring({ tripId, gameId });
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("any member can enter a score for any participant; submitted_by is recorded", async () => {
    // The MEMBER enters a score for the OWNER's card — allowed (engine #7).
    const entry = await ctx
      .callerAs("member")
      .scores.upsertEntry({ tripId, gameId, participantId: ownerId, unitLabel: "1", value: 4 });
    expect(entry.value).toBe(4);
    expect(entry.participant_type).toBe("user");
    expect(entry.submitted_by).toBe(memberId); // audit only — not a gate
  });

  it("upsert updates the same cell in place (no duplicate row)", async () => {
    await ctx
      .callerAs("member")
      .scores.upsertEntry({ tripId, gameId, participantId: ownerId, unitLabel: "1", value: 5 });
    const updated = await ctx
      .callerAs("member")
      .scores.upsertEntry({ tripId, gameId, participantId: ownerId, unitLabel: "1", value: 6 });
    expect(updated.value).toBe(6);

    const { data } = await ctx.admin
      .from("score_entries")
      .select("id")
      .eq("game_id", gameId)
      .eq("participant_id", ownerId)
      .eq("unit_label", "1");
    expect(data).toHaveLength(1);
  });

  it("deleteEntry removes the cell's score", async () => {
    await ctx
      .callerAs("member")
      .scores.upsertEntry({ tripId, gameId, participantId: memberId, unitLabel: "9", value: 3 });
    await ctx
      .callerAs("member")
      .scores.deleteEntry({ tripId, gameId, participantId: memberId, unitLabel: "9" });
    const { data } = await ctx.admin
      .from("score_entries")
      .select("id")
      .eq("game_id", gameId)
      .eq("participant_id", memberId)
      .eq("unit_label", "9");
    expect(data).toHaveLength(0);
  });

  it("an outsider cannot enter scores", async () => {
    await expect(
      ctx
        .callerAs("outsider")
        .scores.upsertEntry({ tripId, gameId, participantId: ownerId, unitLabel: "2", value: 4 })
    ).rejects.toThrow();
  });

  it("listByGame returns the game's entries to any member", async () => {
    await ctx
      .callerAs("member")
      .scores.upsertEntry({ tripId, gameId, participantId: memberId, unitLabel: "3", value: 5 });
    const entries = await ctx.callerAs("member").scores.listByGame({ tripId, gameId });
    expect(entries.some((e) => e.participant_id === memberId && e.unit_label === "3" && e.value === 5)).toBe(true);
  });

  it("scores are REJECTED until scoring is enabled (Phase 2B.1 universal gate)", async () => {
    const g = await ctx.caller().games.create({ tripId, gameTypeId: STROKE_PLAY, name: "Gated" });
    await ctx.caller().games.addParticipants({ tripId, gameId: g.id, userIds: [ownerId, memberId] });
    // Configured but not enabled → entries are refused, for every format.
    await expect(
      ctx.caller().scores.upsertEntry({ tripId, gameId: g.id, participantId: ownerId, unitLabel: "1", value: 4 })
    ).rejects.toThrow(/enable scoring/i);
    // Enable → entry is accepted.
    await ctx.caller().games.enableScoring({ tripId, gameId: g.id });
    const entry = await ctx.caller().scores.upsertEntry({ tripId, gameId: g.id, participantId: ownerId, unitLabel: "1", value: 4 });
    expect(entry.value).toBe(4);
  });

  it("Enable keeps the game pre-Live; the first score flips it to active", async () => {
    const g = await ctx.caller().games.create({ tripId, gameTypeId: STROKE_PLAY, name: "Goes Live" });
    await ctx.caller().games.addParticipants({ tripId, gameId: g.id, userIds: [ownerId, memberId] });
    await ctx.caller().games.enableScoring({ tripId, gameId: g.id });
    const before = await ctx.admin.from("games").select("status, scoring_enabled").eq("id", g.id).single();
    expect(before.data?.scoring_enabled).toBe(true);
    expect(before.data?.status).toBe("pending"); // enabled but NOT yet Live — the §A "enabled" state

    await ctx.callerAs("member").scores.upsertEntry({ tripId, gameId: g.id, participantId: ownerId, unitLabel: "1", value: 4 });
    const after = await ctx.admin.from("games").select("status").eq("id", g.id).single();
    expect(after.data?.status).toBe("active"); // first score → Live (#396)
  });

  it("Disable reverts active→pending and KEEPS scores; re-enable allows scoring again", async () => {
    const g = await ctx.caller().games.create({ tripId, gameTypeId: STROKE_PLAY, name: "Toggled" });
    await ctx.caller().games.addParticipants({ tripId, gameId: g.id, userIds: [ownerId, memberId] });
    await ctx.caller().games.enableScoring({ tripId, gameId: g.id });
    await ctx.caller().scores.upsertEntry({ tripId, gameId: g.id, participantId: ownerId, unitLabel: "1", value: 4 });

    await ctx.caller().games.disableScoring({ tripId, gameId: g.id });
    const off = await ctx.admin.from("games").select("status, scoring_enabled, pairings_published_at").eq("id", g.id).single();
    expect(off.data?.scoring_enabled).toBe(false);
    expect(off.data?.status).toBe("pending"); // Live → back to setup, not Final
    expect(off.data?.pairings_published_at).toBeNull(); // closed to the crew
    const kept = await ctx.admin.from("score_entries").select("value").eq("game_id", g.id).eq("participant_id", ownerId).eq("unit_label", "1").single();
    expect(kept.data?.value).toBe(4); // scores are NEVER deleted on Disable

    // While disabled, entries are refused again; re-enabling re-opens it.
    await expect(
      ctx.caller().scores.upsertEntry({ tripId, gameId: g.id, participantId: ownerId, unitLabel: "2", value: 5 })
    ).rejects.toThrow(/enable scoring/i);
    await ctx.caller().games.enableScoring({ tripId, gameId: g.id });
    const re = await ctx.caller().scores.upsertEntry({ tripId, gameId: g.id, participantId: ownerId, unitLabel: "2", value: 5 });
    expect(re.value).toBe(5);
  });

  it("a posted game opened for correction is NOT reverted to active when a score is edited", async () => {
    const g = await ctx.caller().games.create({ tripId, gameTypeId: STROKE_PLAY, name: "Corrected" });
    await ctx.caller().games.addParticipants({ tripId, gameId: g.id, userIds: [ownerId, memberId] });
    // A posted round re-opened for correction (complete + corrections_open) is
    // already enabled, so the gate lets the correction through.
    await ctx.admin.from("games").update({ status: "complete", corrections_open: true, scoring_enabled: true }).eq("id", g.id);
    await ctx.caller().scores.upsertEntry({ tripId, gameId: g.id, participantId: ownerId, unitLabel: "1", value: 5 });
    const after = await ctx.admin.from("games").select("status").eq("id", g.id).single();
    expect(after.data?.status).toBe("complete"); // the flip only touches pending — a correction stays Final/correcting
  });
});
