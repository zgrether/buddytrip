import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";
import { notifyCupClinchedIfDecided } from "./gameFinishNotify";

/**
 * The clinch check must SAY what it did — every path, including the ones that
 * correctly do nothing.
 *
 * ── Why this is tested rather than trusted ──────────────────────────────────
 * The absence of these lines was mistaken for evidence. A re-finalize produced
 * no `push_send_log` row and no push, which was read as "the transition guard is
 * suppressing the clinch check". The guard wraps `notifyGameFinished` only and
 * this call is a separate statement — but nothing could prove that from the
 * record, because the function emitted nothing until it reached the sender and
 * all three early exits were silent. A suppressed call and a
 * running-but-undetecting one were indistinguishable.
 *
 * So the log lines are now a CONTRACT, not a debugging aid someone added once:
 * an entry line that always fires, and exactly one outcome line per call. A
 * future edit that returns early without logging puts back the blind spot these
 * exist to remove, and this file fails when it does.
 */

let ctx: TestContext;
let tripId: string;
let compId: string;
let winner: string;
let loser: string;
const gameIds: string[] = [];

/** Captured `console.info` / `console.error` first-arguments for this call. */
let lines: string[];
let infoSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

async function seedFinalizedGame(name: string, first: string, second: string, total: number) {
  const id = crypto.randomUUID();
  const g = await ctx.admin.from("games").insert({
    id, trip_id: tripId, competition_id: compId, game_type_id: "gtt_generic_yard",
    name, status: "complete", scoring_enabled: true,
    points_total: total, points_distribution: { type: "placement", values: [total] },
  });
  if (g.error) throw new Error(`seed game ${name}: ${g.error.message}`);
  gameIds.push(id);
  const r = await ctx.admin.from("game_results").insert([
    { id: crypto.randomUUID(), game_id: id, entity_id: first, entity_type: "team", position: 1, raw_score: 1 },
    { id: crypto.randomUUID(), game_id: id, entity_id: second, entity_type: "team", position: 2, raw_score: 2 },
  ]);
  if (r.error) throw new Error(`seed results ${name}: ${r.error.message}`);
  return id;
}

async function run() {
  await notifyCupClinchedIfDecided({
    tripId,
    competitionId: compId,
    actorUserId: ctx.getUser("owner").id,
    admin: ctx.admin,
  });
}

/** The outcome lines emitted by the call, in order. */
function outcomes(): string[] {
  return lines
    .filter((l) => l.startsWith("[push] clinch check:"))
    .map((l) => l.replace("[push] clinch check: ", ""));
}

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("Clinch outcome logging");
  compId = await ctx.createCompetition(tripId, "Outcome Cup", { scoringModel: "points" });
  winner = await ctx.createTeam(compId, "Winner", { shortName: "WIN" });
  loser = await ctx.createTeam(compId, "Loser", { shortName: "LOS", color: "#ef4444", colorDim: "#2a0a0a" });
}, 120_000);

afterAll(async () => {
  if (gameIds.length) {
    await ctx.admin.from("game_results").delete().in("game_id", gameIds);
    await ctx.admin.from("games").delete().in("id", gameIds);
  }
  await ctx.cleanup();
}, 60_000);

beforeEach(() => {
  lines = [];
  const capture = (msg: unknown) => {
    if (typeof msg === "string") lines.push(msg);
  };
  infoSpy = vi.spyOn(console, "info").mockImplementation(capture);
  errorSpy = vi.spyOn(console, "error").mockImplementation(capture);
});

afterEach(() => {
  infoSpy.mockRestore();
  errorSpy.mockRestore();
});

describe("clinch check — every path announces itself", () => {
  it("UNDECIDED cup: logs entry then no_clincher", async () => {
    // One game of two — nobody can have clinched yet.
    await seedFinalizedGame("g1", winner, loser, 2);
    const second = crypto.randomUUID();
    await ctx.admin.from("games").insert({
      id: second, trip_id: tripId, competition_id: compId, game_type_id: "gtt_generic_yard",
      name: "unplayed", status: "pending", scoring_enabled: false,
      points_total: 10, points_distribution: { type: "placement", values: [10] },
    });
    gameIds.push(second);

    await run();

    expect(outcomes()).toEqual(["entry", "no_clincher"]);
  }, 60_000);

  it("DECIDED cup, unclaimed: logs entry then claimed", async () => {
    // Remove the big unplayed game so the winner's 2 of 2 decides it.
    await ctx.admin.from("games").delete().eq("id", gameIds[gameIds.length - 1]);
    gameIds.pop();

    await run();

    expect(outcomes()).toEqual(["entry", "claimed"]);
  }, 60_000);

  it("DECIDED cup, already claimed: logs entry then already_claimed", async () => {
    // The claim is held from the previous case — this is correct suppression,
    // and it is exactly the case that used to be silent.
    await run();

    expect(outcomes()).toEqual(["entry", "already_claimed"]);
  }, 60_000);

  it("a THROW still announces itself, under the same prefix", async () => {
    // A REJECTING builder, not a synchronously-throwing one. Both reads run
    // inside a `Promise.all`, so a synchronous throw escapes before Promise.all
    // attaches handlers and leaves the sibling read as an unhandled rejection —
    // real test noise that reads like a product fault. Making every method
    // chainable and the terminal thenable reject means Promise.all owns both
    // rejections and the catch below sees exactly one failure.
    const rejecting: Record<string, unknown> = {};
    for (const method of ["from", "select", "eq", "in", "order", "update", "insert", "delete"]) {
      rejecting[method] = () => rejecting;
    }
    rejecting.maybeSingle = () => Promise.reject(new Error("boom"));
    rejecting.then = (_ok: unknown, bad: (e: Error) => void) => bad(new Error("boom"));
    const exploding = rejecting as unknown as Parameters<typeof notifyCupClinchedIfDecided>[0]["admin"];

    await notifyCupClinchedIfDecided({
      tripId,
      competitionId: compId,
      actorUserId: ctx.getUser("owner").id,
      admin: exploding,
    });

    // Entry fires BEFORE anything can throw — that ordering is the point, and it
    // is what makes "entry with no outcome" mean "it died in between".
    expect(outcomes()).toEqual(["entry", "threw"]);
  }, 60_000);

  it("EXACTLY ONE outcome per call — never zero, never two", async () => {
    // The invariant that makes the log readable: one call, one verdict. Zero
    // would restore the blind spot; two would mean a path fell through.
    await run();
    const os = outcomes();
    expect(os[0]).toBe("entry");
    expect(os.slice(1)).toHaveLength(1);
  }, 60_000);
});
