import { describe, it, expect } from "vitest";
import { placementPoints } from "./competitionPlacement";
import { awardMatches, type MatchOutcome } from "./gameAward";
import { clinchWatch, pointsClinch, unitHi, winsNeeded, type ClinchAward, type ClinchGame, type ClinchWatchInput, type PointsClinchInput } from "./pointsClinch";

/**
 * The place-lock math (docs/CLINCH_AND_PODIUM.md §1).
 *
 * The first block is the one that matters. "Never early" is not asserted, it is
 * played out: every outcome of the games left runs through the app's REAL award
 * functions (`placementPoints`, `awardMatches`), and a lock must hold in all of
 * them. The other direction is pinned where it is true: with no floor under
 * anyone, a split that pays last place locks a little late by design (Zach,
 * 2026-11-05), so that one format is held to the first direction alone.
 */

const placement = (values: number[]): ClinchAward => ({ kind: "placement", values });
const game = (id: string, award: ClinchAward): ClinchGame => ({ id, name: id, award });
const split = (id: string, values: number[]) => game(id, placement(values));

/** Every way to rank `n` things, ties included, as a position per thing. */
function weakOrderings(n: number): number[][] {
  const out: number[][] = [];
  const walk = (acc: number[]) => {
    if (acc.length === n) {
      const used = [...new Set(acc)].sort((a, b) => a - b);
      if (used.every((v, i) => v === i + 1)) out.push(acc);
      return;
    }
    for (let v = 1; v <= n; v++) walk([...acc, v]);
  };
  walk([]);
  return out;
}

/** Every total a list of per-game outcome sets can add up to. */
function everyFinish(perGame: Record<string, number>[][], banked: Record<string, number>): Record<string, number>[] {
  return perGame.reduce<Record<string, number>[]>(
    (finishes, outcomes) =>
      finishes.flatMap((f) =>
        outcomes.map((o) => {
          const next = { ...f };
          for (const [unit, points] of Object.entries(o)) next[unit] = (next[unit] ?? 0) + points;
          return next;
        })
      ),
    [{ ...banked }]
  );
}

const placementOutcomes = (values: number[], units: string[]) =>
  weakOrderings(units.length).map((positions) =>
    Object.fromEntries(placementPoints(values, units.map((entityId, i) => ({ entityId, value: positions[i] })), "low_wins"))
  );

function matchOutcomes(matches: { a: string; b: string; value: number }[]) {
  const outcomes: MatchOutcome[] = ["a", "b", "split", null];
  let all: (typeof outcomes)[] = [[]];
  for (let i = 0; i < matches.length; i++) all = all.flatMap((o) => outcomes.map((x) => [...o, x]));
  return all.map((o) => awardMatches(matches.map((m, i) => ({ aTeamId: m.a, bTeamId: m.b, outcome: o[i], value: m.value }))).byTeam);
}

/** A bracket's places dealt to its entrants in every order, each entrant's
 *  points summed onto its unit, as the board's bracket arm does. */
function bracketOutcomes(values: number[], entrantUnits: string[]) {
  const ids = entrantUnits.map((_, i) => `e${i}`);
  return weakOrderings(ids.length).map((positions) => {
    const paid = placementPoints(values, ids.map((entityId, i) => ({ entityId, value: positions[i] })), "low_wins");
    const byUnit: Record<string, number> = {};
    ids.forEach((id, i) => (byUnit[entrantUnits[i]] = (byUnit[entrantUnits[i]] ?? 0) + (paid.get(id) ?? 0)));
    return byUnit;
  });
}

/** For every banked lead on the grid: `safe` is never true while some playable
 *  finish catches the leader. With `exact`, it is also true whenever none does. */
function expectNeverEarly(units: string[], unbanked: ClinchGame[], outcomes: Record<string, number>[][], exact = false) {
  const seen = { safe: 0, unsafe: 0 };
  for (let lead = 0; lead <= 24; lead += 0.5) {
    const banked = { [units[0]]: lead };
    const view = pointsClinch({ unitIds: units, totals: banked, unbanked });
    const finishes = everyFinish(outcomes, banked);
    for (const b of units.slice(1)) {
      const alwaysAhead = finishes.every((f) => (f[units[0]] ?? 0) > (f[b] ?? 0));
      if (view.safe(units[0], b)) expect(alwaysAhead, `lead ${lead} over ${b}`).toBe(true);
      else if (exact) expect(alwaysAhead, `lead ${lead} over ${b}`).toBe(false);
      seen[view.safe(units[0], b) ? "safe" : "unsafe"]++;
    }
  }
  expect(seen.safe).toBeGreaterThan(0);
  expect(seen.unsafe).toBeGreaterThan(0);
}

describe("never early, played out through the app's own award functions", () => {
  const units = ["A", "B", "C"];

  it("placement: a split where last place pays can lock late, never early", () => {
    expectNeverEarly(units, [split("g", [5, 3, 1])], [placementOutcomes([5, 3, 1], units)]);
  });
  it("placement: a split shorter than the field, so last place pays nothing, is exact", () => {
    expectNeverEarly(units, [split("g", [5, 3])], [placementOutcomes([5, 3], units)], true);
  });
  it("a game with no split: the winner takes the total, pick'em included", () => {
    expectNeverEarly(units, [split("g", [6])], [placementOutcomes([6], units)], true);
  });
  it("two games at once: the swings add up", () => {
    expectNeverEarly(
      units,
      [split("g", [5, 3, 1]), split("h", [4, 2])],
      [placementOutcomes([5, 3, 1], units), placementOutcomes([4, 2], units)]
    );
  });
  it("match play: a chaser can only earn the matches it is in", () => {
    const matches = [{ a: "A", b: "B", value: 2 }, { a: "A", b: "C", value: 2 }, { a: "B", b: "C", value: 2 }];
    const award: ClinchAward = { kind: "matches", total: 6, matches: matches.map((m) => ({ unitIds: [m.a, m.b], value: m.value })) };
    expectNeverEarly(units, [game("g", award)], [matchOutcomes(matches)], true);
  });
  it("a bracket: one unit's entrants can take several places", () => {
    const entrantUnits = ["A", "B", "B", "C"];
    const award: ClinchAward = { kind: "bracket", values: [7, 3, 1], total: 11, fieldSize: 4, entrantsByUnit: { A: 1, B: 2, C: 1 } };
    expectNeverEarly(units, [game("g", award)], [bracketOutcomes([7, 3, 1], entrantUnits)], true);
  });
  it("a whole team that does not finish cannot overturn a lock: it gets no row, so nothing", () => {
    // A leads B by 3.5 with [4, 3, 2, 1] left. A last-place floor of 1 would call
    // that safe (a swing of 3), but if A's players all pull out A has no row, earns
    // 0, and B's win takes it to 4 and past. This is the case the floor let through.
    const others = ["B", "C", "D"];
    const noRowForA = weakOrderings(3).map((positions) =>
      Object.fromEntries(placementPoints([4, 3, 2, 1], others.map((entityId, i) => ({ entityId, value: positions[i] })), "low_wins"))
    );
    const banked = { A: 3.5 };
    expect(everyFinish([noRowForA], banked).some((f) => (f.B ?? 0) >= f.A)).toBe(true);
    expect(pointsClinch({ unitIds: ["A", ...others], totals: banked, unbanked: [split("g", [4, 3, 2, 1])] }).safe("A", "B")).toBe(false);
  });
});

describe("the bounds", () => {
  it("placement: the top award", () => {
    expect(unitHi(placement([4, 3, 2, 1]), "A")).toBe(4);
    expect(unitHi(placement([2, 2, 1]), "A")).toBe(2);
  });
  it("match play before it starts: the pairings can still change, so the whole total", () => {
    expect(unitHi({ kind: "matches", total: 8, matches: null }, "A")).toBe(8);
  });
  it("match play started: the matches a unit is in, plus points not yet in a paired match", () => {
    const matches = [{ unitIds: ["A", "B"], value: 2 }, { unitIds: ["C", "D"], value: 2 }];
    expect(unitHi({ kind: "matches", total: 4, matches }, "A")).toBe(2);
    expect(unitHi({ kind: "matches", total: 6, matches }, "A")).toBe(4);
  });
  it("a bracket: Σ top-k for k entrants", () => {
    const award: ClinchAward = { kind: "bracket", values: [7, 3, 1], total: 11, fieldSize: 4, entrantsByUnit: { A: 1, B: 2 } };
    expect(unitHi(award, "A")).toBe(7);
    expect(unitHi(award, "B")).toBe(10);
    expect(unitHi(award, "C")).toBe(0);
  });
  it("a bracket before its draw is played: the whole total", () => {
    expect(unitHi({ kind: "bracket", values: [7, 3], total: 10, fieldSize: 0, entrantsByUnit: null }, "A")).toBe(10);
  });
});

describe("safe and the clincher", () => {
  const units = ["A", "B"];
  const left = [split("g", [4, 1])];

  it("clinches on a lead strictly over the swing", () => {
    expect(pointsClinch({ unitIds: units, totals: { A: 4.5 }, unbanked: left }).clincher).toBe("A");
  });
  it("a possible tie is not a clinch: a lead of exactly the swing", () => {
    expect(pointsClinch({ unitIds: units, totals: { A: 4 }, unbanked: left }).clincher).toBeNull();
  });
  it("a 4-3-2-1 split swings the full top award: last place is not a floor", () => {
    const four = ["A", "B", "C", "D"];
    const view = (lead: number) => pointsClinch({ unitIds: four, totals: { A: lead }, unbanked: [split("g", [4, 3, 2, 1])] });
    expect(view(4).swing("B")).toBe(4);
    expect(view(3.5).clincher).toBeNull();
    expect(view(4.5).clincher).toBe("A");
  });
  it("adding a game un-clinches, with nothing stored", () => {
    const input = { unitIds: units, totals: { A: 4.5 } };
    expect(pointsClinch({ ...input, unbanked: left }).clincher).toBe("A");
    expect(pointsClinch({ ...input, unbanked: [...left, split("h", [2])] }).clincher).toBeNull();
  });
  it("a live game is only an unbanked game: its projection has no way in", () => {
    // The whole input is banked totals and unbanked games. A live game leading
    // by 10 is the same `split` as one nobody has started.
    const view = pointsClinch({ unitIds: units, totals: { A: 1 }, unbanked: [split("live", [10])] });
    expect(view.clincher).toBeNull();
    expect(view.places.get("A")!.locked).toBe(false);
  });
  it("a reopened game stays banked: left out of unbanked, the clinch stands", () => {
    expect(pointsClinch({ unitIds: units, totals: { A: 8, B: 2 }, unbanked: [] }).clincher).toBe("A");
  });
  it("a unit missing from the totals has banked nothing", () => {
    expect(pointsClinch({ unitIds: units, totals: {}, unbanked: [] }).places.get("A")).toEqual({ rank: 1, shared: true, locked: true });
  });
});

describe("places", () => {
  it("3rd locks before 1st", () => {
    const view = pointsClinch({ unitIds: ["A", "B", "C", "D"], totals: { A: 20, B: 19, C: 9, D: 1 }, unbanked: [split("g", [4, 3, 2, 1])] });
    expect(view.places.get("C")!.locked).toBe(true);
    expect(view.places.get("A")!.locked).toBe(false);
    expect(view.clincher).toBeNull();
  });
  it("a shared 1st with nothing left: locked and shared, and nobody clinched", () => {
    const view = pointsClinch({ unitIds: ["A", "B", "C"], totals: { A: 9, B: 9, C: 4 }, unbanked: [] });
    expect(view.places.get("A")).toEqual({ rank: 1, shared: true, locked: true });
    expect(view.places.get("B")).toEqual({ rank: 1, shared: true, locked: true });
    expect(view.places.get("C")).toEqual({ rank: 3, shared: false, locked: true });
    expect(view.clincher).toBeNull();
  });
  it("a tie with games left is not locked: the next game can separate them", () => {
    const view = pointsClinch({ unitIds: ["A", "B"], totals: { A: 9, B: 9 }, unbanked: [split("g", [4, 1])] });
    expect(view.places.get("A")).toEqual({ rank: 1, shared: true, locked: false });
  });
  it("teamless units are ids like any other", () => {
    const people = ["user-1", "user-2", "user-3"];
    const view = pointsClinch({ unitIds: people, totals: { "user-1": 12, "user-2": 3 }, unbanked: [split("g", [5, 3, 1])] });
    expect(view.clincher).toBe("user-1");
    expect(view.places.get("user-2")).toEqual({ rank: 2, shared: false, locked: false });
  });
});

describe("out", () => {
  // Board F2: 1st has clinched, 2nd is open with one game left.
  const f2: PointsClinchInput = {
    unitIds: ["HE", "BA", "OM", "HS"],
    totals: { HE: 24.5, BA: 14.5, OM: 14, HS: 12 },
    unbanked: [split("cornhole", [3, 1.5, 0.5])],
  };
  it("no chaser on F2 is out of 2nd: the clinched leader alone does not put them out", () => {
    const view = pointsClinch(f2);
    for (const t of ["BA", "OM", "HS"]) expect(view.out(t, 2)).toBe(false);
  });
  it("every chaser on F2 is out of 1st", () => {
    const view = pointsClinch(f2);
    for (const t of ["BA", "OM", "HS"]) expect(view.out(t, 1)).toBe(true);
  });
  it("out of p means p units are safe over you", () => {
    const view = pointsClinch({ ...f2, totals: { HE: 24.5, BA: 20, OM: 14, HS: 5 } });
    expect(view.out("HS", 2)).toBe(true);
    expect(view.out("HS", 3)).toBe(true);
    expect(view.out("HS", 4)).toBe(false);
  });
});

describe("winsNeeded", () => {
  const units = ["A", "B", "C"];
  const need = (input: PointsClinchInput, leader = "A") => winsNeeded(input, leader, input.unitIds.filter((u) => u !== leader));

  it("1, by any of the games left", () => {
    const r = need({ unitIds: units, totals: { A: 10, B: 7 }, unbanked: [split("g", [4, 2]), split("h", [4, 2])] });
    expect(r).toEqual({ wins: 1, sets: [["g"], ["h"]], anySet: true });
  });
  it("1, but only by the big games: Skins or Pick'em", () => {
    const r = need({
      unitIds: units,
      totals: { A: 10, B: 9 },
      unbanked: [split("skins", [9, 3]), split("pickem", [9, 3]), split("pool", [1])],
    });
    expect(r.wins).toBe(2);
    const big = need({
      unitIds: units,
      totals: { A: 14, B: 6 },
      unbanked: [split("skins", [9, 3]), split("pickem", [9, 3]), split("pool", [1])],
    });
    expect(big).toEqual({ wins: 1, sets: [["skins"], ["pickem"]], anySet: false });
  });
  it("2", () => {
    const r = need({ unitIds: units, totals: { A: 6, B: 5 }, unbanked: [split("g", [4]), split("h", [4]), split("i", [4])] });
    expect(r.wins).toBe(2);
    expect(r.sets).toHaveLength(3);
    expect(r.anySet).toBe(true);
  });
  it("null for 3 or more", () => {
    const r = need({ unitIds: units, totals: {}, unbanked: ["g", "h", "i", "j", "k"].map((id) => split(id, [4])) });
    expect(r).toEqual({ wins: null, sets: [], anySet: false });
  });
  it("nothing left is null", () => {
    expect(need({ unitIds: units, totals: { A: 3 }, unbanked: [] }).wins).toBeNull();
  });
  it("the other awards go lowest to the closest chaser", () => {
    // A wins g. With B on the 1 and C on the 3, A is 6 clear of B and 7 of C, past
    // the 5 left in h. Handing the 3 to B instead would leave A only 4 clear.
    const r = need({ unitIds: units, totals: { A: 5, B: 3 }, unbanked: [split("g", [5, 3, 1]), split("h", [5])] });
    expect(r.sets).toContainEqual(["g"]);
  });
  it("names no next game: the answer does not depend on the order of the games", () => {
    const games = [split("skins", [9, 3]), split("pickem", [9, 3]), split("pool", [1])];
    const a = need({ unitIds: units, totals: { A: 14, B: 6 }, unbanked: games });
    const b = need({ unitIds: units, totals: { A: 14, B: 6 }, unbanked: [...games].reverse() });
    expect(a.wins).toBe(b.wins);
    expect(a.sets.flat().sort()).toEqual(b.sets.flat().sort());
  });
  it("the ladder repeats for a lower place: only the units below count", () => {
    const input = { unitIds: ["A", "B", "C"], totals: { A: 30, B: 10, C: 8 }, unbanked: [split("g", [4, 1]), split("h", [4, 1])] };
    expect(winsNeeded(input, "B", ["C"]).wins).toBe(1);
  });
  it("match games: the leader's own matches, with the chaser at its worst", () => {
    const award: ClinchAward = { kind: "matches", total: 4, matches: [{ unitIds: ["A", "B"], value: 2 }, { unitIds: ["A", "C"], value: 2 }] };
    const r = need({ unitIds: units, totals: { A: 2 }, unbanked: [game("g", award)] });
    expect(r.wins).toBe(1);
  });
});

describe("clinchWatch", () => {
  const units = ["A", "B", "C", "D"];
  const base: ClinchWatchInput = { unitIds: units, totals: {}, unbanked: [], bankedGames: 0, projections: {}, lastBanked: null };
  const watch = (over: Partial<ClinchWatchInput>) => clinchWatch({ ...base, ...over });

  it("the race is for 1st until 1st locks, then for the highest place still open", () => {
    const open = watch({ totals: { A: 10, B: 8, C: 6, D: 1 }, unbanked: [split("g", [4])], bankedGames: 2 });
    expect(open.place).toBe(1);
    expect(open.leaderIds).toEqual(["A"]);
    expect(open.chaserId).toBe("B");
    expect(open.lead).toBe(2);
    const clinched = watch({ totals: { A: 30, B: 9, C: 8, D: 1 }, unbanked: [split("g", [4])], bankedGames: 2 });
    expect(clinched.clincherId).toBe("A");
    expect(clinched.place).toBe(2);
    expect(clinched.leaderIds).toEqual(["B"]);
    expect(clinched.chaserId).toBe("C");
    expect(clinched.field.map((f) => f.id)).toEqual(["B", "C", "D"]);
  });
  it("level at the top: every leader is named and nobody needs wins", () => {
    const w = watch({ totals: { A: 8, B: 8, C: 1 }, unbanked: [split("g", [4])], bankedGames: 1 });
    expect(w.leaderIds).toEqual(["A", "B"]);
    expect(w.lead).toBe(0);
    expect(w.wins).toBeNull();
  });
  it("every place locked: no race left", () => {
    const w = watch({ totals: { A: 30, B: 20, C: 10, D: 1 }, unbanked: [], bankedGames: 3 });
    expect(w.place).toBeNull();
    expect(w.field).toEqual([]);
  });
  it("the track runs the chaser's swing, one segment per game it can earn from", () => {
    const award: ClinchAward = { kind: "matches", total: 4, matches: [{ unitIds: ["A", "C"], value: 2 }, { unitIds: ["A", "D"], value: 2 }] };
    const w = watch({ totals: { A: 10, B: 8 }, unbanked: [split("g", [4]), game("m", award)], bankedGames: 1 });
    expect(w.chaserId).toBe("B");
    expect(w.gamesLeft).toBe(2);
    expect(w.segments).toEqual([{ gameId: "g", swing: 4 }]);
    expect(w.swing).toBe(4);
  });
  it("alive counts who can still reach the place, and a unit out of it is marked", () => {
    const w = watch({ totals: { A: 10, B: 8, C: 6, D: 1 }, unbanked: [split("g", [4])], bankedGames: 1 });
    expect(w.field).toEqual([{ id: "A", out: false }, { id: "B", out: false }, { id: "C", out: false }, { id: "D", out: true }]);
    expect(w.alive).toBe(3);
  });
  it("wins names the games that would do it", () => {
    const w = watch({ totals: { A: 14, B: 6 }, unbanked: [split("skins", [9, 3]), split("pool", [1])], bankedGames: 1 });
    expect(w.wins?.wins).toBe(1);
    expect(w.winGameNames).toEqual(["skins"]);
  });

  describe("projections are drawn, never locked on", () => {
    const left = [split("live", [10]), split("later", [2])];
    const today = { live: { A: 10, B: 0, C: 0, D: 0 } };

    it("a live game that would clinch says so, and locks nothing", () => {
      const w = watch({ totals: { A: 6, B: 5 }, unbanked: left, bankedGames: 1, projections: today });
      expect(w.clinchesIfHolds).toBe("live");
      expect(w.clincherId).toBeNull();
      expect(w.place).toBe(1);
      expect(w.projectedLead).toBe(11);
      expect(w.lead).toBe(1);
      expect(w.liveSwing).toBe(10);
    });
    it("a live game the leader is not leading never reads as clinching", () => {
      // A would clinch if this held (23 to 17 with 2 left), but B is the one leading
      // it, so "Leading live" would be false.
      const w = watch({ totals: { A: 20, B: 10 }, unbanked: left, bankedGames: 1, projections: { live: { A: 3, B: 7, C: 0, D: 0 } } });
      expect(w.clinchesIfHolds).toBeNull();
    });
    it("a live game that would not be enough says nothing", () => {
      const w = watch({ totals: { A: 6, B: 5 }, unbanked: [split("live", [2]), split("later", [10])], bankedGames: 1, projections: { live: { A: 2, B: 0, C: 0, D: 0 } } });
      expect(w.clinchesIfHolds).toBeNull();
    });
    it("a game that does not project adds nothing to the track", () => {
      const w = watch({ totals: { A: 6, B: 5 }, unbanked: left, bankedGames: 1 });
      expect(w.projectedLead).toBeNull();
      expect(w.liveSwing).toBe(0);
    });
  });

  describe("who the last banked game put out", () => {
    const pool = split("pool", [4]);
    it("a unit the game put out of 1st is named", () => {
      // Before Pool, A led C by 6 with 8 left, so C was alive. Pool's 4 took the
      // lead to 10, which would read as already out if Pool's points stayed in.
      const w = watch({
        totals: { A: 14, B: 12, C: 4, D: 13 },
        unbanked: [split("left", [4])],
        bankedGames: 2,
        lastBanked: { game: pool, paid: { A: 4 } },
      });
      expect(w.newlyOutIds).toEqual(["C"]);
    });
    it("a unit already out is not named again", () => {
      const w = watch({
        totals: { A: 40, B: 39, C: 6, D: 1 },
        unbanked: [split("left", [4])],
        bankedGames: 3,
        lastBanked: { game: pool, paid: { A: 4 } },
      });
      expect(w.newlyOutIds).toEqual([]);
    });
    it("nothing banked yet names nobody", () => {
      expect(watch({ unbanked: [split("left", [4])] }).newlyOutIds).toEqual([]);
    });
  });
});
