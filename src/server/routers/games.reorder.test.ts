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
 */

let ctx: TestContext;
let tripId: string;
let competitionId: string;
const gameIds: string[] = [];

async function makeGame(name: string): Promise<string> {
  const g = (await ctx.caller().games.create({
    tripId,
    gameTypeId: "gtt_manual",
    name,
    competitionId,
  })) as { id: string };
  gameIds.push(g.id);
  return g.id;
}

/** Board order as the leaderboard payload presents it. */
async function boardOrder(): Promise<string[]> {
  const lb = await computeCompetitionLeaderboard(ctx.admin, competitionId);
  return (lb.games as { name: string }[]).map((g) => g.name);
}

async function setStatus(gameId: string, status: string) {
  const { error } = await ctx.admin.from("games").update({ status }).eq("id", gameId);
  if (error) throw new Error(`setStatus: ${error.message}`);
}

beforeAll(async () => {
  ctx = await TestContext.create();
  tripId = await ctx.createTrip("Reorder Trip");
  await ctx.addTripMember(tripId, "planner", "Organizer");
  await ctx.addTripMember(tripId, "member", "Member");
  competitionId = await ctx.createCompetition(tripId, "Reorder Cup");
}, 120000);

afterAll(async () => {
  if (gameIds.length) await ctx.admin.from("games").delete().in("id", gameIds);
  await ctx.cleanup();
}, 60000);

describe("games.create — a new game lands at the bottom, globally", () => {
  it("numbers each new game after the highest in use", async () => {
    const a = await makeGame("A");
    const b = await makeGame("B");
    const c = await makeGame("C");
    expect(await boardOrder()).toEqual(["A", "B", "C"]);

    // The "globally" part: a game created while others have MOVED ON still lands
    // below them. Arrival order does not get to jump the queue.
    await setStatus(a, "active");
    await setStatus(b, "complete");
    const d = await makeGame("D");
    const { data } = await ctx.admin.from("games").select("display_order").eq("id", d).single();
    const { data: prev } = await ctx.admin.from("games").select("display_order").eq("id", c).single();
    expect(Number(data!.display_order)).toBeGreaterThan(Number(prev!.display_order));
  }, 180000);
});

describe("games.reorder — one global order, honoured across state changes", () => {
  it("reorders, and the new order survives being read back", async () => {
    const x = await makeGame("X");
    await makeGame("Y");
    const z = await makeGame("Z");
    const before = await boardOrder();
    expect(before.slice(-3)).toEqual(["X", "Y", "Z"]);

    // Move Z above X — send the FULL sequence, which is what the client does.
    const all = (await ctx.admin
      .from("games")
      .select("id, display_order")
      .eq("competition_id", competitionId)
      .order("display_order", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true })) as { data: { id: string }[] | null };
    const ids = (all.data ?? []).map((g) => g.id);
    const reordered = [...ids.filter((i) => i !== z)];
    reordered.splice(reordered.indexOf(x), 0, z);

    await ctx.caller().games.reorder({ tripId, competitionId, gameIds: reordered });
    expect((await boardOrder()).slice(-3)).toEqual(["Z", "X", "Y"]);
  }, 180000);

  it("a game that changes state ALONE keeps its number — the reason order is global", async () => {
    const p = await makeGame("P");
    const q = await makeGame("Q");
    const r = await makeGame("R");

    const ids = (
      (await ctx.admin
        .from("games")
        .select("id")
        .eq("competition_id", competitionId)
        .order("display_order", { ascending: true, nullsFirst: false })) as { data: { id: string }[] | null }
    ).data!.map((g) => g.id);
    await ctx.caller().games.reorder({ tripId, competitionId, gameIds: ids });

    const numberOf = async (id: string) =>
      Number((await ctx.admin.from("games").select("display_order").eq("id", id).single()).data!.display_order);
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
    const live = (await boardOrder()).filter((n) => ["P", "Q", "R"].includes(n));
    expect(live).toEqual(["P", "Q", "R"]);
  }, 180000);

  it("refuses ids that are not this competition's games", async () => {
    // The ids are caller-supplied. Without the scope check a crafted list could
    // stamp display_order onto another trip's games, and an id that silently
    // no-ops would also renumber the survivors wrongly.
    const mine = await makeGame("Scoped");
    await expect(
      ctx.caller().games.reorder({ tripId, competitionId, gameIds: [mine, "some-other-game"] })
    ).rejects.toThrow(/Not games of this competition/);
  }, 180000);

  it("a member cannot reorder", async () => {
    const ids = [await makeGame("MemberTest")];
    await expect(
      ctx.callerAs("member").games.reorder({ tripId, competitionId, gameIds: ids })
    ).rejects.toThrow();
  }, 180000);

  it("an Organizer CAN reorder — same gate as create and delete", async () => {
    // Deliberately not owner-only: an Organizer can already add and delete games
    // on this surface, so a gate that let them create a game but not move it
    // would be arbitrary.
    const ids = (
      (await ctx.admin
        .from("games")
        .select("id")
        .eq("competition_id", competitionId)
        .order("display_order", { ascending: true, nullsFirst: false })) as { data: { id: string }[] | null }
    ).data!.map((g) => g.id);
    const res = await ctx.callerAs("planner").games.reorder({ tripId, competitionId, gameIds: ids });
    expect(res.success).toBe(true);
  }, 180000);
});

describe("nullable display_order — an unnumbered game sorts last, never vanishes", () => {
  it("keeps a NULL-ordered game on the board, at the bottom", async () => {
    // The reason the column is nullable: a row the backfill missed, or one
    // inserted by a path that forgot to number it, must sort PREDICTABLY rather
    // than disappear. Simulated by clearing the column directly.
    const orphan = await makeGame("Orphan");
    await ctx.admin.from("games").update({ display_order: null }).eq("id", orphan);

    const order = await boardOrder();
    expect(order).toContain("Orphan");
    expect(order[order.length - 1]).toBe("Orphan");
  }, 180000);
});
