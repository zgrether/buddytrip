import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TestContext } from "../../__tests__/helpers/test-setup";
import { computeCompetitionLeaderboard } from "../lib/competitionLeaderboard";

/**
 * The board-order rules (migration 108 + `games.reorder`).
 *
 * The interesting assertions are the ones about a game CHANGING STATE. The order
 * is deliberately ONE global value rather than per-section, and the whole point
 * of that choice is invisible until a game moves between sections: it must keep
 * its place relative to the others, so that when a neighbour catches up they are
 * still in the order the owner set. Arrival order must never matter.
 *
 * These read through `computeCompetitionLeaderboard` rather than querying the
 * column directly, so they test the order the BOARD actually renders — including
 * the null-sorting behaviour that makes the column safe to leave nullable.
 *
 * EVERY CASE BUILDS ITS OWN CUP (#1527). They shared one, and the first case
 * expected the board to be exactly A, B, C — which held only if it ran first.
 * The later cases defended themselves with `.slice(-3)` and name filters, and
 * the Organizer case reordered whatever games the others had left. Each case
 * now reads a board holding only its own games, so its assertions are exact.
 */

let ctx: TestContext;
const gameIds: string[] = [];

type Cup = { tripId: string; competitionId: string };

async function reorderCup(label: string): Promise<Cup> {
  const tripId = await ctx.createTrip(`Reorder ${label}`);
  await ctx.addTripMember(tripId, "planner", "Organizer");
  await ctx.addTripMember(tripId, "member", "Member");
  const competitionId = await ctx.createCompetition(tripId, `Reorder Cup ${label}`);
  return { tripId, competitionId };
}

async function makeGame(cup: Cup, name: string): Promise<string> {
  const g = (await ctx.caller().games.create({
    tripId: cup.tripId,
    gameTypeId: "gtt_manual",
    name,
    competitionId: cup.competitionId,
  })) as { id: string };
  gameIds.push(g.id);
  return g.id;
}

/** Board order as the leaderboard payload presents it. */
async function boardOrder(cup: Cup): Promise<string[]> {
  const lb = await computeCompetitionLeaderboard(ctx.admin, cup.competitionId);
  return (lb.games as { name: string }[]).map((g) => g.name);
}

/** The cup's game ids in board order — the full sequence the client sends. */
async function idsInOrder(cup: Cup): Promise<string[]> {
  const { data, error } = await ctx.admin
    .from("games")
    .select("id")
    .eq("competition_id", cup.competitionId)
    .order("display_order", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });
  if (error) throw new Error(`read order: ${error.message}`);
  return (data ?? []).map((g) => g.id as string);
}

async function numberOf(id: string): Promise<number> {
  const { data, error } = await ctx.admin.from("games").select("display_order").eq("id", id).single();
  if (error) throw new Error(`read display_order: ${error.message}`);
  return Number(data!.display_order);
}

async function setStatus(gameId: string, status: string) {
  const { error } = await ctx.admin.from("games").update({ status }).eq("id", gameId);
  if (error) throw new Error(`setStatus: ${error.message}`);
}

beforeAll(async () => {
  ctx = await TestContext.create();
}, 120000);

afterAll(async () => {
  if (gameIds.length) await ctx.admin.from("games").delete().in("id", gameIds);
  await ctx.cleanup();
}, 60000);

describe("games.create — a new game lands at the bottom, globally", () => {
  it("numbers each new game after the highest in use", async () => {
    const cup = await reorderCup("create");
    const a = await makeGame(cup, "A");
    const b = await makeGame(cup, "B");
    const c = await makeGame(cup, "C");
    expect(await boardOrder(cup)).toEqual(["A", "B", "C"]);

    // The "globally" part: a game created while others have MOVED ON still lands
    // below them. Arrival order does not get to jump the queue.
    await setStatus(a, "active");
    await setStatus(b, "complete");
    const d = await makeGame(cup, "D");
    expect(await numberOf(d)).toBeGreaterThan(await numberOf(c));
  }, 180000);
});

describe("games.reorder — one global order, honoured across state changes", () => {
  it("reorders, and the new order survives being read back", async () => {
    const cup = await reorderCup("reorder");
    const x = await makeGame(cup, "X");
    await makeGame(cup, "Y");
    const z = await makeGame(cup, "Z");
    expect(await boardOrder(cup)).toEqual(["X", "Y", "Z"]);

    // Move Z above X — send the FULL sequence, which is what the client does.
    const ids = await idsInOrder(cup);
    const reordered = [...ids.filter((i) => i !== z)];
    reordered.splice(reordered.indexOf(x), 0, z);

    await ctx.caller().games.reorder({ tripId: cup.tripId, competitionId: cup.competitionId, gameIds: reordered });
    expect(await boardOrder(cup)).toEqual(["Z", "X", "Y"]);
  }, 180000);

  it("a game that changes state ALONE keeps its number — the reason order is global", async () => {
    const cup = await reorderCup("state-change");
    const p = await makeGame(cup, "P");
    const q = await makeGame(cup, "Q");
    const r = await makeGame(cup, "R");

    await ctx.caller().games.reorder({ tripId: cup.tripId, competitionId: cup.competitionId, gameIds: await idsInOrder(cup) });

    const pBefore = await numberOf(p);
    const qBefore = await numberOf(q);
    const rBefore = await numberOf(r);

    // Q alone advances to Live. Nothing renumbers.
    await setStatus(q, "active");
    expect(await numberOf(p)).toBe(pBefore);
    expect(await numberOf(q)).toBe(qBefore);
    expect(await numberOf(r)).toBe(rBefore);

    // P and R catch up. They are STILL in the original order relative to Q —
    // which is the property a per-section order could not give.
    await setStatus(p, "active");
    await setStatus(r, "active");
    expect(await boardOrder(cup)).toEqual(["P", "Q", "R"]);
  }, 180000);

  it("refuses ids that are not this trip's games", async () => {
    // The ids are caller-supplied. Without the scope check a crafted list could
    // stamp display_order onto another trip's games, and an id that silently
    // no-ops would also renumber the survivors wrongly. The scope is the TRIP
    // since PR 6b (one order for the cup's games and side games).
    const cup = await reorderCup("scoped");
    const mine = await makeGame(cup, "Scoped");
    await expect(
      ctx.caller().games.reorder({ tripId: cup.tripId, competitionId: cup.competitionId, gameIds: [mine, "some-other-game"] })
    ).rejects.toThrow(/Not games of this trip/);
  }, 180000);

  it("refuses a REAL game that lives on another trip — not just an id that exists nowhere", async () => {
    // The case above passes against almost any scope rule, because the id exists
    // nowhere. This one is the crafted list the check exists for: a real game
    // the caller can name, on a trip that is not this one.
    const cup = await reorderCup("crafted");
    const mine = await makeGame(cup, "Home game");
    const otherTrip = await ctx.createTrip("Someone else's trip");
    const theirs = (await ctx.caller().games.create({ tripId: otherTrip, gameTypeId: "gtt_stroke_play", name: "Theirs" })) as { id: string };
    expect(await numberOf(theirs.id)).toBe(1); // premise
    await expect(
      ctx.caller().games.reorder({ tripId: cup.tripId, competitionId: cup.competitionId, gameIds: [mine, theirs.id] })
    ).rejects.toThrow(/Not games of this trip/);
    expect(await numberOf(theirs.id)).toBe(1); // untouched
  }, 180000);

  it("a side game and a cup game on the same trip share ONE order (PR 6b)", async () => {
    const cup = await reorderCup("side-and-cup");
    const cupGame = await makeGame(cup, "Cup game");
    const side = (await ctx.caller().games.create({ tripId: cup.tripId, gameTypeId: "gtt_stroke_play", name: "Side game" })) as { id: string };
    // Side first, then the cup game — one sequence across both containers.
    await ctx.caller().games.reorder({ tripId: cup.tripId, gameIds: [side.id, cupGame] });
    expect(await numberOf(side.id)).toBe(1);
    expect(await numberOf(cupGame)).toBe(2);
  }, 180000);

  it("a member cannot reorder", async () => {
    const cup = await reorderCup("member");
    await makeGame(cup, "First");
    await makeGame(cup, "Second");
    const reversed = (await idsInOrder(cup)).reverse();
    await expect(
      ctx.callerAs("member").games.reorder({ tripId: cup.tripId, competitionId: cup.competitionId, gameIds: reversed })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await boardOrder(cup)).toEqual(["First", "Second"]); // unchanged
  }, 180000);

  it("an Organizer CAN reorder — same gate as create and delete", async () => {
    // Deliberately not owner-only: an Organizer can already add and delete games
    // on this surface, so a gate that let them create a game but not move it
    // would be arbitrary.
    const cup = await reorderCup("organizer");
    await makeGame(cup, "First");
    await makeGame(cup, "Second");
    const reversed = (await idsInOrder(cup)).reverse();
    const res = await ctx.callerAs("planner").games.reorder({ tripId: cup.tripId, competitionId: cup.competitionId, gameIds: reversed });
    expect(res.success).toBe(true);
    // …and it really moved, so "success" is not a no-op.
    expect(await boardOrder(cup)).toEqual(["Second", "First"]);
  }, 180000);
});

describe("nullable display_order — an unnumbered game sorts last, never vanishes", () => {
  it("keeps a NULL-ordered game on the board, at the bottom", async () => {
    // The reason the column is nullable: a row the backfill missed, or one
    // inserted by a path that forgot to number it, must sort PREDICTABLY rather
    // than disappear. Simulated by clearing the column directly — on the FIRST
    // game, so "at the bottom" is a move and not where it already was.
    const cup = await reorderCup("null-order");
    const orphan = await makeGame(cup, "Orphan");
    await makeGame(cup, "Numbered");
    const { error } = await ctx.admin.from("games").update({ display_order: null }).eq("id", orphan);
    if (error) throw new Error(`clear display_order: ${error.message}`);

    expect(await boardOrder(cup)).toEqual(["Numbered", "Orphan"]);
  }, 180000);
});
