import { describe, it, expect } from "vitest";
import { resultTiles, standingsRows, type StandingsUnit } from "./standingsRows";

const unit = (id: string, hasResult = true, color: string | null = "#3b82f6"): StandingsUnit => ({ id, label: id.toUpperCase(), color, hasResult });
const cells = (m: Record<string, Record<string, number>>) =>
  new Map(Object.entries(m).map(([g, byUnit]) => [g, new Map(Object.entries(byUnit).map(([u, points]) => [u, { points }]))]));

describe("standingsRows — order and rank are BANKED", () => {
  it("ranks by banked, ties share a rank (1, 2, 2, 4), and a projection never reorders", () => {
    const rows = standingsRows({
      units: [unit("a"), unit("b"), unit("c"), unit("d")],
      unitTotals: { a: 10, b: 6, c: 6, d: 2 },
      // d would lead on projection — it stays last: a projection is not a result.
      projections: { live: { a: 0, b: 0, c: 0, d: 20 } },
      viewerUnitId: null,
    });
    expect(rows.map((r) => [r.id, r.rank])).toEqual([["a", 1], ["b", 2], ["c", 2], ["d", 4]]);
  });

  it("NO POINTS YET sorts last with no rank — never a 0 that ranks", () => {
    const rows = standingsRows({
      units: [unit("waiting", false), unit("a"), unit("zero")],
      unitTotals: { a: 3, zero: 0 },
      projections: {},
      viewerUnitId: null,
    });
    expect(rows.map((r) => [r.id, r.rank, r.hasResult])).toEqual([
      ["a", 1, true],
      ["zero", 2, true], // played and scored nothing: a real 0, ranked
      ["waiting", null, false],
    ]);
  });
});

describe("standingsRows — the bar's two segments share one scale", () => {
  it("the scale is the largest banked + projected, so a hatched segment can pass the leader's solid one", () => {
    const [a, b] = standingsRows({
      units: [unit("a"), unit("b")],
      unitTotals: { a: 6, b: 4 },
      projections: { live: { a: 0, b: 4 } },
      viewerUnitId: null,
    });
    // scale = max(6 + 0, 4 + 4) = 8.
    expect([a.bankedPct, a.projectedPct]).toEqual([75, 0]);
    expect([b.bankedPct, b.projectedPct]).toEqual([50, 50]);
  });

  it("everything at zero draws empty bars, not NaN", () => {
    const [a] = standingsRows({ units: [unit("a")], unitTotals: { a: 0 }, projections: {}, viewerUnitId: null });
    expect([a.bankedPct, a.projectedPct]).toEqual([0, 0]);
  });
});

describe("standingsRows — the viewer", () => {
  it("marks the viewer's own unit, and only it", () => {
    const rows = standingsRows({ units: [unit("a"), unit("b")], unitTotals: { a: 1, b: 2 }, projections: {}, viewerUnitId: "a" });
    expect(rows.map((r) => [r.id, r.isViewer])).toEqual([["b", false], ["a", true]]);
  });
});

describe("resultTiles — fixed team order, never re-sorted", () => {
  it("keeps the given team order and marks the winner", () => {
    const tiles = resultTiles(["blue", "red", "green"], cells({ g: { blue: 1, red: 6, green: 3 } }).get("g"));
    expect(tiles?.map((t) => [t.teamId, t.points, t.winner])).toEqual([
      ["blue", 1, false],
      ["red", 6, true],
      ["green", 3, false],
    ]);
  });

  it("a tie for most shares the winner's tint", () => {
    const tiles = resultTiles(["blue", "red"], cells({ g: { blue: 4, red: 4 } }).get("g"));
    expect(tiles?.map((t) => t.winner)).toEqual([true, true]);
  });

  it("a team not in the game has no points (not 0)", () => {
    const tiles = resultTiles(["blue", "red", "green"], cells({ g: { blue: 4, red: 1 } }).get("g"));
    expect(tiles?.[2]).toEqual({ teamId: "green", points: null, winner: false });
  });

  /** The Cornhole case: finished, paid nobody anything → "No points", not a blank. */
  it("a game that paid nothing has NO tiles — the row says No points", () => {
    expect(resultTiles(["blue", "red"], cells({ g: { blue: 0, red: 0 } }).get("g"))).toBeNull();
    expect(resultTiles(["blue", "red"], undefined)).toBeNull();
  });
});

describe("standingsRows: locked and shared places", () => {
  const rows = (over: Partial<Parameters<typeof standingsRows>[0]> = {}) =>
    standingsRows({
      units: [unit("a"), unit("b"), unit("c"), unit("d", false)],
      unitTotals: { a: 10, b: 6, c: 6 },
      projections: {},
      viewerUnitId: null,
      ...over,
    });
  const of = (id: string, r = rows()) => r.find((x) => x.id === id)!;

  it("a place is shared only where two ranked units are level", () => {
    expect(of("a").shared).toBe(false);
    expect(of("b").shared).toBe(true);
    expect(of("c").shared).toBe(true);
  });
  it("a unit with no points yet shares nothing, whoever else has none", () => {
    expect(of("d").shared).toBe(false);
  });
  it("locked comes from the units handed in, and defaults to open", () => {
    expect(of("a").locked).toBe(false);
    expect(of("a", rows({ lockedUnitIds: ["a"] })).locked).toBe(true);
    expect(of("b", rows({ lockedUnitIds: ["a"] })).locked).toBe(false);
  });
  it("a unit with no result has no place to lock", () => {
    expect(of("d", rows({ lockedUnitIds: ["d"] })).locked).toBe(false);
  });
});

describe("a tiebreak order at Final (spec §5)", () => {
  const unit = (id: string) => ({ id, label: id, color: null, hasResult: true });
  const rows = (tiebreakOrder?: string[] | null) =>
    standingsRows({ units: ["a", "b", "c"].map(unit), unitTotals: { a: 9, b: 4, c: 4 }, projections: {}, viewerUnitId: null, tiebreakOrder });
  const read = (r: ReturnType<typeof rows>) => r.map((x) => `${x.id}:${x.rank}${x.shared ? "=" : ""}`);

  it("breaks the tie: the order decides rank and row, and neither reads shared", () => {
    expect(read(rows(["c", "b"]))).toEqual(["a:1", "c:2", "b:3"]);
  });
  it("CONTROL: with no order they share, in name order", () => {
    expect(read(rows(null))).toEqual(["a:1", "b:2=", "c:2="]);
  });
});
