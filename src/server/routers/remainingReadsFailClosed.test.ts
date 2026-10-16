import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext, genId } from "../../__tests__/helpers/test-setup";
import { callerFailingRead } from "../../__tests__/helpers/failingRead";
import { configToDraft, configDraftToPayload } from "../../lib/configDraft";

/**
 * #1539 — the rest of the census's fail-open reads. Each failed read used to be
 * read as "nothing there" and the procedure went on to write a lasting wrong
 * state, or skip a refusal. Each now refuses with the retryable read-failure
 * sentence, BEFORE anything is written.
 *
 * Every failing case uses a caller that fails exactly ONE read (table + column
 * string) and sits next to a control on the real caller, so the refusal is the
 * read's and not the procedure refusing for some other reason.
 */

const READ_FAILED = "This is temporary — try again in a moment.";
let ctx: TestContext;

beforeAll(async () => {
  ctx = await TestContext.create();
}, 60_000);

afterAll(async () => {
  await ctx.cleanup();
}, 60_000);

/** Votes on one date option. Reads its error: a failed count must not read as
 *  zero here either (the first version selected a column this table lacks and
 *  got null back). */
async function votesOn(windowId: string): Promise<number> {
  const { count, error } = await ctx.admin.from("date_poll_votes").select("window_id", { count: "exact", head: true }).eq("window_id", windowId);
  if (error) throw new Error('count votes: ' + error.message);
  return count ?? 0;
}

describe("trip and poll writes refuse on a failed read (#1539)", () => {
  it("changeDestination reads the date options BEFORE changing the destination", async () => {
    const id = `t1539-dest-${Date.now()}`;
    await ctx.caller().trips.create({ id, title: "1539 dest", lockedDestination: { title: "Pebble Beach", location: "Monterey, CA" } });
    ctx.trackTrip(id);
    const w = await ctx.caller().datePoll.addWindow({ tripId: id, id: genId("dw"), startDate: "2026-10-05", endDate: "2026-10-08" });
    await ctx.caller().datePoll.castDateVote({ tripId: id, windowId: w.id as string, answer: "yes" });

    const failing = callerFailingRead(ctx, "owner", { table: "date_windows", columns: "id" });
    await expect(failing.trips.changeDestination({ tripId: id, destination: "Bandon Dunes" })).rejects.toThrow(READ_FAILED);
    const { data: trip } = await ctx.admin.from("trips").select("locked_destination_title").eq("id", id).single();
    expect(trip?.locked_destination_title, "the destination did not change").toBe("Pebble Beach");
    expect(await votesOn(w.id as string)).toBe(1);

    // CONTROL: the real caller changes it and clears the votes.
    await ctx.caller().trips.changeDestination({ tripId: id, destination: "Bandon Dunes" });
    expect(await votesOn(w.id as string)).toBe(0);
  }, 60_000);

  it("cancelling the poll refuses rather than leaving its votes behind", async () => {
    const tripId = await ctx.createTrip("1539 cancel poll");
    await ctx.caller().datePoll.setPollMode({ tripId, pollMode: true });
    const w = await ctx.caller().datePoll.addWindow({ tripId, id: genId("dw"), startDate: "2026-10-05", endDate: "2026-10-08" });
    await ctx.caller().datePoll.castDateVote({ tripId, windowId: w.id as string, answer: "yes" });

    const failing = callerFailingRead(ctx, "owner", { table: "date_windows", columns: "id" });
    await expect(failing.datePoll.setPollMode({ tripId, pollMode: false })).rejects.toThrow(READ_FAILED);
    expect(await votesOn(w.id as string)).toBe(1);

    // CONTROL
    await ctx.caller().datePoll.setPollMode({ tripId, pollMode: false });
    expect(await votesOn(w.id as string)).toBe(0);
  }, 60_000);

  it("a repeat tap on a date vote refuses rather than re-setting it", async () => {
    const tripId = await ctx.createTrip("1539 date vote");
    const w = await ctx.caller().datePoll.addWindow({ tripId, id: genId("dw"), startDate: "2026-10-05", endDate: "2026-10-08" });
    await ctx.caller().datePoll.castDateVote({ tripId, windowId: w.id as string, answer: "yes" });
    const failing = callerFailingRead(ctx, "owner", { table: "date_poll_votes", columns: "answer" });
    await expect(failing.datePoll.castDateVote({ tripId, windowId: w.id as string, answer: "yes" })).rejects.toThrow(READ_FAILED);
    // CONTROL: the real repeat tap clears it.
    await ctx.caller().datePoll.castDateVote({ tripId, windowId: w.id as string, answer: "yes" });
    expect(await votesOn(w.id as string)).toBe(0);
  }, 60_000);
});

describe("idea writes refuse on a failed read (#1539)", () => {
  async function ideaTrip(label: string) {
    const tripId = await ctx.createTrip(`1539 ${label}`);
    const idea = await ctx.caller().ideas.create({ tripId, id: genId("idea"), title: "Bandon Dunes", location: "Bandon, OR", description: "Links", costTier: "$$$" });
    return { tripId, ideaId: idea.id as string };
  }

  it("a repeat tap on your pick refuses rather than re-setting it", async () => {
    const { tripId, ideaId } = await ideaTrip("idea vote");
    await ctx.caller().ideas.vote({ tripId, ideaId });
    const failing = callerFailingRead(ctx, "owner", { table: "idea_votes", columns: "idea_id" });
    await expect(failing.ideas.vote({ tripId, ideaId })).rejects.toThrow(READ_FAILED);
    // CONTROL: the real repeat tap clears it.
    await ctx.caller().ideas.vote({ tripId, ideaId });
    const { count } = await ctx.admin.from("idea_votes").select("idea_id", { count: "exact", head: true }).eq("idea_id", ideaId);
    expect(count).toBe(0);
  }, 60_000);

  it("archiving an idea refuses rather than saving it with no trip title", async () => {
    const { tripId, ideaId } = await ideaTrip("archive");
    const failing = callerFailingRead(ctx, "owner", { table: "trips", columns: "title" });
    await expect(failing.archivedIdeas.archive({ tripId, ideaId })).rejects.toThrow(READ_FAILED);
    // CONTROL: the real caller archives it.
    await expect(ctx.caller().archivedIdeas.archive({ tripId, ideaId })).resolves.toBeTruthy();
  }, 60_000);
});

describe("game writes read before they write (#1539)", () => {
  async function game(label: string) {
    const { tripId, competitionId } = await ctx.createCupTrip({ name: `1539 ${label}`, scoringModel: "points", teams: ["A", "B"] });
    const g = (await ctx.caller().games.create({ tripId, gameTypeId: "gtt_stroke_play", name: "G", competitionId })) as { id: string };
    return { tripId, gameId: g.id };
  }
  const failingGameRead = (columns: string) => callerFailingRead(ctx, "owner", { table: "games", columns });

  it("resetScoring refuses before resetting", async () => {
    const { tripId, gameId } = await game("resetScoring");
    await expect(failingGameRead("competition_id").games.resetScoring({ tripId, gameId })).rejects.toThrow(READ_FAILED);
    await expect(ctx.caller().games.resetScoring({ tripId, gameId })).resolves.toBeTruthy();
  }, 60_000);

  it("resetToSkeleton refuses before resetting", async () => {
    const { tripId, gameId } = await game("resetToSkeleton");
    await expect(failingGameRead("competition_id").games.resetToSkeleton({ tripId, gameId })).rejects.toThrow(READ_FAILED);
    await expect(ctx.caller().games.resetToSkeleton({ tripId, gameId })).resolves.toBeTruthy();
  }, 60_000);

  it("setPointsDistribution refuses rather than skipping the fits-the-total check", async () => {
    const { tripId, gameId } = await game("setPointsDistribution");
    await ctx.admin.from("games").update({ points_total: 10 }).eq("id", gameId);
    const dist = { type: "placement" as const, values: [6, 4] };
    await expect(
      failingGameRead("points_total, competition_id").games.setPointsDistribution({ tripId, gameId, distribution: dist })
    ).rejects.toThrow(READ_FAILED);
    const { data } = await ctx.admin.from("games").select("points_distribution").eq("id", gameId).single();
    expect(data?.points_distribution).toBeNull();
    await expect(ctx.caller().games.setPointsDistribution({ tripId, gameId, distribution: dist })).resolves.toBeTruthy();
  }, 60_000);

  it("saveConfig refuses before its write", async () => {
    const { tripId, gameId } = await game("saveConfig");
    const g = await ctx.caller().games.getById({ tripId, gameId });
    const delegates = ((await ctx.caller().games.listOrganizers({ tripId, gameId })) as { user_id: string }[]).map((d) => d.user_id);
    const base = configToDraft(g as Parameters<typeof configToDraft>[0], [], delegates);
    const payload = configDraftToPayload({ ...base, name: "Renamed" }, base);
    const { hash } = await ctx.caller().games.configHash({ tripId, gameId });
    await expect(failingGameRead("competition_id").games.saveConfig({ tripId, gameId, baseHash: hash, payload })).rejects.toThrow(READ_FAILED);
    expect((await ctx.admin.from("games").select("name").eq("id", gameId).single()).data?.name).toBe("G");
    await ctx.caller().games.saveConfig({ tripId, gameId, baseHash: hash, payload });
    expect((await ctx.admin.from("games").select("name").eq("id", gameId).single()).data?.name).toBe("Renamed");
  }, 60_000);
});
