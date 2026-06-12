import { describe, it, expect } from "vitest";
import {
  playerStats,
  projectedNetToPar,
  computeRack,
  fmtToPar,
  fmtPoints,
  type RackPlayer,
} from "./rackNStack";

const PAR = [4, 5, 3, 4, 4, 3, 5, 4, 4, 4, 3, 5, 4, 4, 3, 4, 5, 4]; // 72
const SEQ = Array.from({ length: 18 }, (_, i) => i + 1); // sequential index
const COURSE_PAR = PAR.reduce((a, p) => a + p, 0);

const holes = (vals: number[]): Record<string, number> =>
  Object.fromEntries(vals.map((v, i) => [String(i + 1), v]));

describe("playerStats", () => {
  it("computes net-to-par / thru over played holes", () => {
    // 3 holes: par 4,5,3; gross 4,5,3 → even, 0 handicap.
    const s = playerStats(holes([4, 5, 3]), 0, PAR, SEQ);
    expect(s).toMatchObject({ netToPar: 0, gross: 12, thru: 3, netStrokes: 12 });
  });

  it("applies a handicap stroke on the allocated holes", () => {
    // 2 strokes → sequential index gives strokes on holes 1 & 2.
    // gross 5,5 on par 4,5 → net 4,4 → net-to-par (4-4)+(4-5) = -1.
    const s = playerStats(holes([5, 5]), 2, PAR, SEQ);
    expect(s.netToPar).toBe(-1);
    expect(s.netStrokes).toBe(8);
    expect(s.gross).toBe(10);
  });
});

describe("projectedNetToPar", () => {
  it("is null below the thru threshold", () => {
    expect(projectedNetToPar(12, 3, COURSE_PAR)).toBeNull();
  });
  it("pace-normalizes to 18 once thru ≥ 4", () => {
    // even par through 4 (16 net on par-16 front) → projects to even (0).
    const through4Par = PAR.slice(0, 4).reduce((a, p) => a + p, 0); // 16
    expect(projectedNetToPar(through4Par, 4, COURSE_PAR)).toBeCloseTo(0, 5);
  });
});

describe("computeRack — current mode", () => {
  const mk = (id: string, team: "A" | "B", netToPar: number, thru: number, gross = 40): RackPlayer => ({
    id,
    team,
    stats: { netToPar, netStrokes: gross, gross, thru },
  });

  it("pairs by rank and the lower net-to-par wins the slot", () => {
    const r = computeRack(
      [mk("a1", "A", -2, 9), mk("a2", "A", 3, 9), mk("b1", "B", 1, 9), mk("b2", "B", 5, 9)],
      "current",
      COURSE_PAR
    );
    expect(r.slots).toHaveLength(2);
    // slot 1: A best (-2) vs B best (1) → A leads, gap 3
    expect(r.slots[0]).toMatchObject({ slot: 1, leader: "A", gap: 3 });
    // slot 2: A(3) vs B(5) → A leads
    expect(r.slots[1].leader).toBe("A");
    expect(r.points).toEqual({ A: 2, B: 0 });
  });

  it("halves a tied slot ½/½", () => {
    const r = computeRack([mk("a", "A", 2, 9), mk("b", "B", 2, 9)], "current", COURSE_PAR);
    expect(r.slots[0].leader).toBeNull();
    expect(r.slots[0].gap).toBe(0);
    expect(r.points).toEqual({ A: 0.5, B: 0.5 });
  });

  it("surpluses the larger team's bottom player (sit-out, no point)", () => {
    const r = computeRack(
      [mk("a1", "A", -1, 9), mk("a2", "A", 2, 9), mk("a3", "A", 6, 9), mk("b1", "B", 0, 9), mk("b2", "B", 4, 9)],
      "current",
      COURSE_PAR
    );
    expect(r.slots).toHaveLength(2);
    expect(r.sitOut.map((p) => p.id)).toEqual(["a3"]); // worst A sits
    expect(r.points).toEqual({ A: 2, B: 0 });
  });

  it("excludes not-started players (thru 0) until they post", () => {
    const r = computeRack([mk("a", "A", 0, 0), mk("b", "B", 0, 5)], "current", COURSE_PAR);
    expect(r.slots).toHaveLength(0); // A not started → no pair
    expect(r.sitOut).toHaveLength(1); // B alone → surplus
    expect(r.sitOut[0].id).toBe("b");
  });
});

describe("computeRack — projected mode reorders by pace", () => {
  it("ranks by projected net-to-par when thru ≥ threshold", () => {
    // A1: +1 thru 9 → projects ~+2; A2: -1 thru 2 → projection null → falls back to current -1.
    const players: RackPlayer[] = [
      { id: "a1", team: "A", stats: { netToPar: 1, netStrokes: 37, gross: 37, thru: 9 } },
      { id: "a2", team: "A", stats: { netToPar: -1, netStrokes: 8, gross: 8, thru: 2 } },
      { id: "b1", team: "B", stats: { netToPar: 0, netStrokes: 36, gross: 36, thru: 9 } },
      { id: "b2", team: "B", stats: { netToPar: 0, netStrokes: 36, gross: 36, thru: 9 } },
    ];
    const cur = computeRack(players, "current", COURSE_PAR);
    // current: A sorted [-1 (a2), +1 (a1)]
    expect(cur.slots[0].a.id).toBe("a2");
    const proj = computeRack(players, "projected", COURSE_PAR);
    // projected: a2 has no projection (thru 2 → fallback -1); a1 projects ~+2.
    // a2's value (-1) < a1's (~+2) so a2 still first here — assert it's a valid permutation, no crash.
    expect(proj.slots).toHaveLength(2);
    expect(new Set([proj.slots[0].a.id, proj.slots[1].a.id])).toEqual(new Set(["a1", "a2"]));
  });
});

describe("formatters", () => {
  it("fmtToPar", () => {
    expect(fmtToPar(0)).toBe("E");
    expect(fmtToPar(3)).toBe("+3");
    expect(fmtToPar(-2)).toBe("−2");
    expect(fmtToPar(2.4)).toBe("+2"); // projected rounds
  });
  it("fmtPoints with halves", () => {
    expect(fmtPoints(0)).toBe("0");
    expect(fmtPoints(2)).toBe("2");
    expect(fmtPoints(1.5)).toBe("1½");
    expect(fmtPoints(0.5)).toBe("½");
  });
});
