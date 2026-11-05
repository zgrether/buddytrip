/**
 * WHO HAS A PLACE LOCKED IN A POINTS CUP (docs/CLINCH_AND_PODIUM.md §1).
 *
 * Two-team match play has `winThreshold`, more than half the points in play.
 * That rule means nothing here: three or more units split every game, so the
 * only honest question is pairwise. Can B still catch A, with what is left?
 *
 *   swing(A, B)    Σ over unbanked games of hi_g(B) − lo_g(A), the most B can
 *                  gain on A
 *   safe(A over B) pts(A) − pts(B) > swing(A, B). Strict: a tie is still possible
 *                  at exactly the swing, and a possible tie is not safe
 *   out(T, p)      at least p units are safe over T: T can no longer finish
 *                  p-th or better
 *
 * NEVER EARLY is the claim, and `pointsClinch.test.ts` proves it per format by
 * playing out every outcome through the app's own award functions. The bounds
 * below exist to keep it true, which is why three of them are wider than the
 * format's rules alone would suggest:
 *
 *  - A unit with nobody in a placement game can earn nothing from it, because a
 *    team with no finisher gets no result row (`computeStrokeTeamStandings`), so
 *    its `lo` is 0 and not the last-place award. `fieldUnitIds` carries that.
 *  - Match pairings can change until a game starts, so a game that has not
 *    started keeps the whole total as everybody's `hi`: `matches: null`.
 *  - A bracket's entrants can change until its draw is played: `entrantsByUnit:
 *    null`, the same.
 *
 * Banked points only, and derived on every read. Nothing here is stored, so
 * adding a game raises a swing and a lock reverts by itself. Nothing here reads
 * a projection either: a live game is an unbanked game, whatever it looks like
 * today (`bankedOnlyWhenFinished`). A game reopened for a correction stays
 * banked, so the caller leaves it out of `unbanked`.
 *
 * Pure, and it knows nothing of teams or people: a unit is an id. A teamless
 * race goes through exactly the same code.
 */

/** Below this two point totals are the same total: averaged ties can leave a
 *  third of a point in a float. */
const EPSILON = 1e-9;

export interface Bound {
  /** The most this unit can earn from this game. */
  hi: number;
  /** The least this unit can earn from this game. */
  lo: number;
}

export type ClinchAward =
  /** Awards by finishing place: stroke, Stableford, scramble, skins, manual
   *  games, and a game with no split (`values: [total]`), pick'em included. */
  | {
      kind: "placement";
      values: readonly number[];
      /** The units with someone in this game, or null when it has nobody in it
       *  yet (and a manual game, whose places are entered by hand). */
      fieldUnitIds: readonly string[] | null;
    }
  /** Awards match by match: match play, non-golf Matches. */
  | {
      kind: "matches";
      total: number;
      /** Null until the game has started: pairings can still change. */
      matches: readonly { unitIds: readonly string[]; value: number }[] | null;
    }
  /** Awards per entrant, summed onto the entrants' units. */
  | {
      kind: "bracket";
      values: readonly number[];
      total: number;
      fieldSize: number;
      /** Null until the draw has been played: entrants can still change. */
      entrantsByUnit: Readonly<Record<string, number>> | null;
    };

export interface ClinchGame {
  id: string;
  name: string;
  award: ClinchAward;
}

/** `values` as a schedule for `places` finishers: a split shorter than the
 *  field pays the rest nothing. */
function paddedSchedule(values: readonly number[], places: number): number[] {
  return Array.from({ length: places }, (_, i) => values[i] ?? 0);
}

const sum = (ns: readonly number[]) => ns.reduce((a, b) => a + b, 0);

/** The most and least `unitId` can earn from a game (the spec's table). */
export function unitBound(award: ClinchAward, unitId: string, unitCount: number): Bound {
  switch (award.kind) {
    case "placement": {
      const inField = award.fieldUnitIds == null || award.fieldUnitIds.includes(unitId);
      return {
        hi: Math.max(0, ...award.values),
        lo: inField ? Math.min(...paddedSchedule(award.values, unitCount)) : 0,
      };
    }
    case "matches": {
      if (award.matches == null) return { hi: award.total, lo: 0 };
      // Points not yet in a paired match can still land in one this unit plays.
      const unpaired = Math.max(0, award.total - sum(award.matches.map((m) => m.value)));
      const mine = sum(award.matches.filter((m) => m.unitIds.includes(unitId)).map((m) => m.value));
      return { hi: mine + unpaired, lo: 0 };
    }
    case "bracket": {
      if (award.entrantsByUnit == null) return { hi: award.total, lo: 0 };
      const entrants = award.entrantsByUnit[unitId] ?? 0;
      const places = [...paddedSchedule(award.values, award.fieldSize)].sort((a, b) => b - a);
      return { hi: sum(places.slice(0, entrants)), lo: entrants > 0 ? sum(places.slice(-entrants)) : 0 };
    }
  }
}

export interface PlaceState {
  /** Competition ranking (1, 2, 2, 4) on banked points. */
  rank: number;
  /** Level with another unit right now: "T3" on both rows. */
  shared: boolean;
  /** Nothing left can move this unit's place. */
  locked: boolean;
}

export interface PointsClinchInput {
  unitIds: readonly string[];
  /** Banked points by unit. A unit missing here has banked nothing. */
  totals: Readonly<Record<string, number>>;
  /** Every game not yet banked. */
  unbanked: readonly ClinchGame[];
}

export interface PointsClinch {
  swing(a: string, b: string): number;
  safe(a: string, b: string): boolean;
  out(unitId: string, place: number): boolean;
  places: Map<string, PlaceState>;
  /** The unit alone in 1st with its place locked. A shared 1st has none. */
  clincher: string | null;
}

export function pointsClinch({ unitIds, totals, unbanked }: PointsClinchInput): PointsClinch {
  const pts = (id: string) => totals[id] ?? 0;
  const bounds = unbanked.map((g) => new Map(unitIds.map((id) => [id, unitBound(g.award, id, unitIds.length)])));
  const swing = (a: string, b: string) => sum(bounds.map((byUnit) => byUnit.get(b)!.hi - byUnit.get(a)!.lo));
  const safe = (a: string, b: string) => pts(a) - pts(b) > swing(a, b) + EPSILON;
  const level = (a: string, b: string) => Math.abs(pts(a) - pts(b)) <= EPSILON;

  const out = (unitId: string, place: number) => unitIds.filter((u) => u !== unitId && safe(u, unitId)).length >= place;

  const places = new Map<string, PlaceState>();
  for (const t of unitIds) {
    const others = unitIds.filter((u) => u !== t);
    const above = others.filter((u) => !level(u, t) && pts(u) > pts(t));
    const below = others.filter((u) => !level(u, t) && pts(u) < pts(t));
    const tied = others.filter((u) => level(u, t));
    places.set(t, {
      rank: above.length + 1,
      shared: tied.length > 0,
      // A tie only settles once nothing left can separate the two units.
      locked:
        above.every((u) => safe(u, t)) &&
        below.every((u) => safe(t, u)) &&
        tied.every((u) => swing(t, u) <= EPSILON && swing(u, t) <= EPSILON),
    });
  }

  const clincher = unitIds.find((id) => {
    const place = places.get(id)!;
    return place.rank === 1 && !place.shared && place.locked;
  });

  return { swing, safe, out, places, clincher: clincher ?? null };
}

/** What each chaser takes from a game `leader` wins, at the leader's best: the
 *  other awards go lowest to the closest chaser. */
function chaserAwards(game: ClinchGame, leader: string, chasers: readonly string[], unitIds: readonly string[]) {
  const award = game.award;
  if (award.kind !== "placement") {
    return new Map(chasers.map((c) => [c, unitBound(award, c, unitIds.length).lo]));
  }
  const rest = paddedSchedule(award.values, unitIds.length).slice(1).sort((a, b) => a - b);
  return new Map(chasers.map((c, i) => [c, rest[i] ?? 0]));
}

export interface WinsNeeded {
  /** 1, 2, or null for 3 or more. */
  wins: 1 | 2 | null;
  /** The sets of games that would do it, by id. */
  sets: string[][];
  /** Whether every game (or pair of games) left would do it: "any of the 3". */
  anySet: boolean;
}

/**
 * How many more wins put `leader` safe over everyone in `mustBeat`. Order-free:
 * it asks which games would do it, never which comes next. Single games, then
 * pairs, so it is O(n²) in the games left whatever the size of the cup.
 */
export function winsNeeded(input: PointsClinchInput, leader: string, mustBeat: readonly string[]): WinsNeeded {
  const { unitIds, totals, unbanked } = input;
  const pts = (id: string) => totals[id] ?? 0;
  const chasers = [...mustBeat].sort((a, b) => pts(b) - pts(a));

  const clinches = (won: readonly ClinchGame[]) => {
    const after = new Map(unitIds.map((id) => [id, pts(id)]));
    for (const g of won) {
      after.set(leader, after.get(leader)! + unitBound(g.award, leader, unitIds.length).hi);
      for (const [c, gain] of chaserAwards(g, leader, chasers, unitIds)) after.set(c, after.get(c)! + gain);
    }
    const left = unbanked.filter((g) => !won.includes(g));
    return chasers.every((c) => {
      const swing = sum(
        left.map((g) => unitBound(g.award, c, unitIds.length).hi - unitBound(g.award, leader, unitIds.length).lo)
      );
      return after.get(leader)! - after.get(c)! > swing + EPSILON;
    });
  };

  const singles = unbanked.filter((g) => clinches([g]));
  if (singles.length > 0) {
    return { wins: 1, sets: singles.map((g) => [g.id]), anySet: singles.length === unbanked.length };
  }

  const pairs: ClinchGame[][] = [];
  let pairCount = 0;
  for (let i = 0; i < unbanked.length; i++) {
    for (let j = i + 1; j < unbanked.length; j++) {
      pairCount++;
      if (clinches([unbanked[i], unbanked[j]])) pairs.push([unbanked[i], unbanked[j]]);
    }
  }
  if (pairs.length > 0) {
    return { wins: 2, sets: pairs.map((p) => p.map((g) => g.id)), anySet: pairs.length === pairCount };
  }
  return { wins: null, sets: [], anySet: false };
}
