import { describe, it, expect } from "vitest";
import { computeRack, scoringSlotThrus, type RackMode, type RackPlayer, type RackStats } from "./rackNStack";

/**
 * #1368 — the rack pairs the FULL roster, and that changes no score.
 *
 * `computeRack` used to drop not-started players (thru 0) before pairing, so
 * they never appeared on the board while the points-per-slot divisor counted
 * them. It now pairs them last, into slots marked `undecided`. The claim that
 * makes this a display fix and not a scoring change: every total is identical.
 *
 * Proven against `main`'s `computeRack` as it stood before #1368, kept below
 * VERBATIM as `previousComputeRack` (only renamed). Over many seeded random
 * rosters, in both modes, with unequal teams, no-shows and ties:
 *   - team points are equal,
 *   - the decided slots are exactly the old slots (same people, same order),
 *   - the thrus the finish gate reads are exactly the old slots' thrus.
 * Plus: every rostered player appears exactly once, which the old version
 * could not say.
 */

type Team = "A" | "B";
const COURSE_PAR = 72;

// ── `main`'s computeRack before #1368, verbatim (renamed) ─────────────────────
function projectedNetToPar(netStrokes: number, thru: number, coursePar: number): number | null {
  if (thru === 0) return null;
  return (netStrokes / thru) * 18 - coursePar;
}
function previousValueOf(p: RackPlayer, mode: RackMode, coursePar: number): number {
  const proj = projectedNetToPar(p.stats.netStrokes, p.stats.thru, coursePar);
  return mode === "projected" && proj != null ? proj : p.stats.netToPar;
}
function previousComputeRack(players: RackPlayer[], mode: RackMode, coursePar: number) {
  const started = players.filter((p) => p.stats.thru > 0);
  const key = (p: RackPlayer): [number, number, number] => [
    previousValueOf(p, mode, coursePar),
    p.stats.netToPar,
    p.stats.gross,
  ];
  const cmp = (x: RackPlayer, y: RackPlayer) => {
    const kx = key(x);
    const ky = key(y);
    for (let i = 0; i < kx.length; i++) if (kx[i] !== ky[i]) return kx[i] - ky[i];
    return x.id < y.id ? -1 : x.id > y.id ? 1 : 0;
  };
  const A = started.filter((p) => p.team === "A").sort(cmp);
  const B = started.filter((p) => p.team === "B").sort(cmp);
  const n = Math.min(A.length, B.length);
  const slots: { a: string; b: string; aThru: number; bThru: number }[] = [];
  let pa = 0;
  let pb = 0;
  for (let k = 0; k < n; k++) {
    const va = previousValueOf(A[k], mode, coursePar);
    const vb = previousValueOf(B[k], mode, coursePar);
    const leader: Team | null = va < vb ? "A" : va > vb ? "B" : null;
    if (leader === "A") pa += 1;
    else if (leader === "B") pb += 1;
    else {
      pa += 0.5;
      pb += 0.5;
    }
    slots.push({ a: A[k].id, b: B[k].id, aThru: A[k].stats.thru, bThru: B[k].stats.thru });
  }
  return { slots, points: { A: pa, B: pb } };
}

// ── A seeded roster generator ──────────────────────────────────────────────────
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
function roster(seed: number): RackPlayer[] {
  const r = rng(seed);
  const size = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
  const out: RackPlayer[] = [];
  for (const team of ["A", "B"] as Team[]) {
    const count = size(1, 10);
    for (let i = 0; i < count; i++) {
      // ~30% no-shows; small ranges so ties (and halves) happen often.
      const thru = r() < 0.3 ? 0 : size(1, 18);
      const netToPar = thru === 0 ? 0 : size(-3, 3);
      const gross = thru === 0 ? 0 : 4 * thru + size(-2, 4);
      const stats: RackStats = { netToPar, netStrokes: gross - size(0, 2), gross, thru };
      out.push({ id: `${team}${i}-${seed}`, team, stats });
    }
  }
  return out;
}

const SEEDS = Array.from({ length: 400 }, (_, i) => i + 1);

describe("computeRack over the full roster changes no score (#1368)", () => {
  for (const mode of ["current", "projected"] as RackMode[]) {
    it(`team points are identical to the previous computeRack (${mode}, ${SEEDS.length} rosters)`, () => {
      for (const seed of SEEDS) {
        const players = roster(seed);
        expect(computeRack(players, mode, COURSE_PAR).points, `seed ${seed}`).toEqual(
          previousComputeRack(players, mode, COURSE_PAR).points
        );
      }
    });

    it(`the decided slots are exactly the previous slots (${mode})`, () => {
      for (const seed of SEEDS) {
        const players = roster(seed);
        const decided = computeRack(players, mode, COURSE_PAR)
          .slots.filter((s) => !s.undecided)
          .map((s) => ({ a: s.a.id, b: s.b.id, aThru: s.a.thru, bThru: s.b.thru }));
        expect(decided, `seed ${seed}`).toEqual(previousComputeRack(players, mode, COURSE_PAR).slots);
      }
    });
  }

  it("the finish gate reads the previous slots' thrus, so a no-show still lets a game finish", () => {
    for (const seed of SEEDS) {
      const players = roster(seed);
      const before = previousComputeRack(players, "current", COURSE_PAR).slots.flatMap((s) => [s.aThru, s.bThru]);
      expect(scoringSlotThrus(computeRack(players, "current", COURSE_PAR)), `seed ${seed}`).toEqual(before);
    }
  });

  it("the generator really produces no-shows, undecided slots and halves (the cases above are not vacuous)", () => {
    let noShows = 0;
    let undecided = 0;
    let halves = 0;
    for (const seed of SEEDS) {
      const players = roster(seed);
      noShows += players.filter((p) => p.stats.thru === 0).length;
      const r = computeRack(players, "current", COURSE_PAR);
      undecided += r.slots.filter((s) => s.undecided).length;
      halves += r.slots.filter((s) => !s.undecided && s.leader === null).length;
    }
    expect(noShows).toBeGreaterThan(100);
    expect(undecided).toBeGreaterThan(100);
    expect(halves).toBeGreaterThan(20);
  });

  it("every rostered player appears exactly once, in a slot or sitting out", () => {
    for (const seed of SEEDS) {
      const players = roster(seed);
      const r = computeRack(players, "current", COURSE_PAR);
      const seen = [...r.slots.flatMap((s) => [s.a.id, s.b.id]), ...r.sitOut.map((p) => p.id)].sort();
      expect(seen, `seed ${seed}`).toEqual(players.map((p) => p.id).sort());
    }
  });

  it("the prod case: 9 v 9 with three no-shows racks 9 slots, 7 decided, 2 undecided", () => {
    // Game e23edc3c (#1368): two no-shows on one team, one on the other.
    const mk = (id: string, team: Team, thru: number): RackPlayer => ({
      id,
      team,
      stats: { netToPar: thru ? 1 : 0, netStrokes: thru * 4, gross: thru * 4, thru },
    });
    const players = [
      ...Array.from({ length: 9 }, (_, i) => mk(`a${i}`, "A", i < 7 ? 18 : 0)),
      ...Array.from({ length: 9 }, (_, i) => mk(`b${i}`, "B", i < 8 ? 18 : 0)),
    ];
    const r = computeRack(players, "current", COURSE_PAR);
    expect(r.slots).toHaveLength(9);
    expect(r.slots.filter((s) => !s.undecided)).toHaveLength(7);
    expect(r.slots.filter((s) => s.undecided)).toHaveLength(2);
    expect(r.sitOut).toHaveLength(0);
  });
});
