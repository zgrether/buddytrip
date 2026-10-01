import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";
import { claimClinchNotification, notifyCupClinchedIfDecided } from "./gameFinishNotify";

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
const gameIds: string[] = [];
const compIds: string[] = [];

/** Captured `console.info` / `console.error` first-arguments for this call. */
let lines: string[];
let infoSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

/**
 * EVERY CASE BUILDS ITS OWN CUP (#1527). The cases used to share one and walk
 * it UNDECIDED → DECIDED → claimed, each relying on the last: "already claimed"
 * needed the claim the previous case made, and "every pre-send exit also leaves
 * a ROW" read the rows the earlier cases had written — its own message said so
 * ("the earlier cases in this file each left a row"). Shuffled, those cases met
 * an undecided cup and an empty log. Each case now builds a cup in the state it
 * tests, and the row case produces its own three exits.
 */
type Cup = { tripId: string; compId: string; winner: string; loser: string; unplayed: string | null };

async function seedFinalizedGame(cup: Pick<Cup, "tripId" | "compId">, name: string, first: string, second: string, total: number) {
  const id = crypto.randomUUID();
  const g = await ctx.admin.from("games").insert({
    id, trip_id: cup.tripId, competition_id: cup.compId, game_type_id: "gtt_generic_yard",
    name, status: "complete", scoring_enabled: true,
    points_total: total, points_distribution: { type: "placement", values: [total] },
  });
  if (g.error) throw new Error(`seed game ${name}: ${g.error.message}`);
  gameIds.push(id);
  const r = await ctx.admin.from("game_results").insert([
    { id: crypto.randomUUID(), game_id: id, entity_id: first, entity_type: "team", value_kind: "rank", position: 1, raw_score: 1 },
    { id: crypto.randomUUID(), game_id: id, entity_id: second, entity_type: "team", value_kind: "rank", position: 2, raw_score: 2 },
  ]);
  if (r.error) throw new Error(`seed results ${name}: ${r.error.message}`);
  return id;
}

/**
 * A head-to-head cup (only a head-to-head cup fires a CUP clinch — ruling 4,
 * PR 4) where Winner has taken the one finalized game, 2 of 2. With `undecided`
 * it also holds a 10-point game nobody has played, so nobody can have clinched.
 */
async function h2hCup(label: string, opts: { undecided: boolean }): Promise<Cup> {
  const tripId = await ctx.createTrip(`Clinch outcome logging ${label}`);
  const compId = await ctx.createCompetition(tripId, `Outcome Cup ${label}`, { scoringModel: "match_play" });
  compIds.push(compId);
  const winner = await ctx.createTeam(compId, "Winner", { shortName: "WIN" });
  const loser = await ctx.createTeam(compId, "Loser", { shortName: "LOS", color: "#ef4444", colorDim: "#2a0a0a" });
  await seedFinalizedGame({ tripId, compId }, "g1", winner, loser, 2);
  let unplayed: string | null = null;
  if (opts.undecided) {
    unplayed = crypto.randomUUID();
    const { error } = await ctx.admin.from("games").insert({
      id: unplayed, trip_id: tripId, competition_id: compId, game_type_id: "gtt_generic_yard",
      name: "unplayed", status: "pending", scoring_enabled: false,
      points_total: 10, points_distribution: { type: "placement", values: [10] },
    });
    if (error) throw new Error(`seed unplayed game: ${error.message}`);
    gameIds.push(unplayed);
  }
  return { tripId, compId, winner, loser, unplayed };
}

async function run(cup: Cup, admin: Parameters<typeof notifyCupClinchedIfDecided>[0]["admin"] = ctx.admin) {
  await notifyCupClinchedIfDecided({
    tripId: cup.tripId,
    competitionId: cup.compId,
    actorUserId: ctx.getUser("owner").id,
    admin,
  });
}

/** Hold the claim for Winner without a send — the state "already claimed" tests. */
async function holdClaim(cup: Cup) {
  expect(await claimClinchNotification(ctx.admin, cup.compId, cup.winner)).toEqual({ outcome: "claimed" });
}

/**
 * A client that fails only where the COMPUTE reads, and works everywhere
 * else — which is production's actual failure shape. A wholly-broken client
 * would also break the recording, so the row would be missing for a reason
 * that has nothing to do with the code under test.
 *
 * The rejecting builder is chainable-and-thenable rather than
 * synchronously-throwing: both reads run inside a `Promise.all`, and a sync
 * throw escapes before Promise.all attaches handlers, leaving the sibling
 * read as an unhandled rejection — test noise that reads like a product fault.
 */
function explodingOnTeams() {
  const rejecting: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "order", "update", "insert", "delete"]) {
    rejecting[m] = () => rejecting;
  }
  rejecting.maybeSingle = () => Promise.reject(new Error("boom"));
  rejecting.then = (_ok: unknown, bad: (e: Error) => void) => bad(new Error("boom"));

  return new Proxy(ctx.admin, {
    get(target, prop, receiver) {
      if (prop !== "from") return Reflect.get(target, prop, receiver);
      return (table: string) =>
        table === "teams"
          ? rejecting
          : (Reflect.get(target, "from", receiver) as (t: string) => unknown).call(target, table);
    },
  }) as unknown as Parameters<typeof notifyCupClinchedIfDecided>[0]["admin"];
}

/** The outcome lines emitted since the last reset, in order. */
function outcomes(): string[] {
  return lines
    .filter((l) => l.startsWith("[push] clinch check:"))
    .map((l) => l.replace("[push] clinch check: ", ""));
}

async function logRows(compId: string) {
  const { data, error } = await ctx.admin
    .from("push_send_log")
    .select("trigger, outcome, recipients, sent, competition_id")
    .eq("competition_id", compId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`read push_send_log: ${error.message}`);
  return data ?? [];
}

async function claimHeld(compId: string): Promise<string | null> {
  const { data, error } = await ctx.admin
    .from("competitions").select("clinch_notified_team_id").eq("id", compId).single();
  if (error) throw new Error(`read claim: ${error.message}`);
  return (data?.clinch_notified_team_id as string | null) ?? null;
}

beforeAll(async () => {
  ctx = await TestContext.create();
}, 120_000);

afterAll(async () => {
  // push_send_log has no FK to anything (deliberately — migration 105), so
  // ctx.cleanup() does not sweep it. Remove this suite's rows explicitly.
  if (compIds.length) await ctx.admin.from("push_send_log").delete().in("competition_id", compIds);
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
    const cup = await h2hCup("undecided", { undecided: true });
    await run(cup);
    expect(outcomes()).toEqual(["entry", "no_clincher"]);
  }, 60_000);

  it("DECIDED cup, unclaimed: logs entry then claimed", async () => {
    const cup = await h2hCup("decided", { undecided: false });
    expect(await claimHeld(cup.compId)).toBeNull(); // premise: nobody holds it yet
    await run(cup);
    expect(outcomes()).toEqual(["entry", "claimed"]);
    expect(await claimHeld(cup.compId)).toBe(cup.winner);
  }, 60_000);

  it("DECIDED cup, already claimed: logs entry then already_claimed", async () => {
    // Correct suppression, and exactly the case that used to be silent.
    const cup = await h2hCup("claimed", { undecided: false });
    await holdClaim(cup);
    await run(cup);
    expect(outcomes()).toEqual(["entry", "already_claimed"]);
  }, 60_000);

  it("a THROW still announces itself, under the same prefix", async () => {
    const cup = await h2hCup("throw", { undecided: false });
    await run(cup, explodingOnTeams());

    // Entry fires BEFORE anything can throw — that ordering is the point, and it
    // is what makes "entry with no outcome" mean "it died in between".
    expect(outcomes()).toEqual(["entry", "threw"]);
  }, 60_000);

  it("every pre-send exit also leaves a ROW, with the outcome recorded", async () => {
    // The log line answers the question while an incident is live; the row is
    // what survives Vercel's retention. #842 gave the SEND half that property
    // and the clinch check's pre-send exits never had it — this is that gap.
    //
    // The three exits that used to be indistinguishable silence, produced here
    // on one cup rather than borrowed from whichever cases ran first.
    const cup = await h2hCup("rows", { undecided: true });
    await run(cup); //                                     no_clincher
    const { error } = await ctx.admin.from("games").delete().eq("id", cup.unplayed!);
    if (error) throw new Error(`remove unplayed game: ${error.message}`);
    await holdClaim(cup);
    await run(cup); //                                     already_claimed
    await run(cup, explodingOnTeams()); //                 threw

    const rows = await logRows(cup.compId);
    expect(rows.map((r) => r.outcome)).toEqual(["no_clincher", "already_claimed", "threw"]);
    expect(rows.every((r) => r.trigger === "cup_clinched")).toBe(true);

    // All counters zero — which is exactly WHY the outcome column has to exist:
    // nothing in the arithmetic separates these cases from one another.
    for (const r of rows) {
      expect(r.recipients).toBe(0);
      expect(r.sent).toBe(0);
    }
  }, 60_000);

  /**
   * THE ROW MUST AGREE WITH THE LINE. A branch that logs one outcome and
   * records another is worse than recording nothing: the durable table is what
   * outlives the logs, so a mislabelled row is the version that survives.
   *
   * Not hypothetical, and this test exists because of it. Rebasing this work
   * onto #846 — which split the old `if (!won)` branch into `already_claimed` /
   * `claim_error` / `claim_no_row` — applied with NO conflict and silently moved
   * the `recordClinchOutcome(..., "already_claimed")` call into the
   * `claim_no_row` branch. Clean merge, wrong code: `already_claimed` and
   * `claim_error` stopped recording at all, and `claim_no_row` recorded itself
   * as correct suppression — re-creating in the table the exact lie #846 had
   * just removed from the logs.
   *
   * The assertions above only checked that certain labels appeared SOMEWHERE,
   * so all of that passed. Pairing them per-call is what catches it.
   */
  it("the recorded row's outcome MATCHES the logged outcome, per call", async () => {
    // DECIDED and claimed → already_claimed, on a cup with no earlier rows.
    const cup = await h2hCup("match", { undecided: false });
    await holdClaim(cup);
    expect(await logRows(cup.compId)).toEqual([]); // premise: holding the claim recorded nothing

    await run(cup);
    const logged = outcomes().filter((o) => o !== "entry");
    expect(logged).toEqual(["already_claimed"]);

    const rows = await logRows(cup.compId);
    expect(rows).toHaveLength(1);
    expect(rows[0].outcome).toBe(logged[0]);
  }, 60_000);

  it("EXACTLY ONE outcome per call — never zero, never two", async () => {
    // The invariant that makes the log readable: one call, one verdict. Zero
    // would restore the blind spot; two would mean a path fell through.
    const cup = await h2hCup("one-outcome", { undecided: false });
    await holdClaim(cup);
    await run(cup);
    const os = outcomes();
    expect(os[0]).toBe("entry");
    expect(os.slice(1)).toHaveLength(1);
  }, 60_000);
});

/**
 * Ruling 4 (PR 4): head to head owns CUP clinch. A points race computes
 * `pointsToClinch` all the same — the placement arithmetic does not know what
 * kind of cup it is in — so this case builds a points cup that the arithmetic
 * calls DECIDED (the winner holds every point there is) and asserts the push
 * never claims it. With the type check removed, the same call logs `claimed`
 * and writes the claim; that is the mutant this case exists to kill.
 *
 * Its own outcome, `not_head_to_head`, rather than `no_clincher`: "skipped
 * because of the cup's type" and "ran and found nobody decided" are different
 * facts, and the row is where the next audit reads them.
 */
describe("clinch check — a points race never fires a cup clinch", () => {
  it("a DECIDED points cup: logs entry then not_head_to_head, claims nothing, records the row", async () => {
    const { tripId: pointsTrip, competitionId: pointsComp } = await ctx.createCupTrip({
      title: "Clinch outcome logging (points)",
      name: "Points Race",
      scoringModel: "points",
    });
    compIds.push(pointsComp);
    const lead = await ctx.createTeam(pointsComp, "Lead", { shortName: "LED" });
    const trail = await ctx.createTeam(pointsComp, "Trail", { shortName: "TRL", color: "#ef4444", colorDim: "#2a0a0a" });
    await seedFinalizedGame({ tripId: pointsTrip, compId: pointsComp }, "only game", lead, trail, 2);

    await notifyCupClinchedIfDecided({
      tripId: pointsTrip,
      competitionId: pointsComp,
      actorUserId: ctx.getUser("owner").id,
      admin: ctx.admin,
    });

    expect(outcomes()).toEqual(["entry", "not_head_to_head"]);
    expect(await claimHeld(pointsComp)).toBeNull();
    expect((await logRows(pointsComp)).map((r) => ({ trigger: r.trigger, outcome: r.outcome }))).toEqual([
      { trigger: "cup_clinched", outcome: "not_head_to_head" },
    ]);
  }, 60_000);
});
