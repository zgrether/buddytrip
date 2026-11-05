/**
 * WHO HAS A PLACE LOCKED IN A POINTS CUP (docs/CLINCH_AND_PODIUM.md §1).
 *
 * Two-team match play has `winThreshold`, more than half the points in play.
 * That rule means nothing here: three or more units split every game, so the
 * only honest question is pairwise. Can B still catch A, with what is left?
 *
 *   swing(B)       Σ over unbanked games of hi_g(B), the most B can still gain
 *   safe(A over B) pts(A) − pts(B) > swing(B). Strict: a tie is still possible
 *                  at exactly the swing, and a possible tie is not safe
 *   out(T, p)      at least p units are safe over T: T can no longer finish
 *                  p-th or better
 *
 * NEVER EARLY beats one game sooner (Zach, 2026-11-05), and that is why A is
 * assumed to earn nothing from any game left. A last-place award looks like a
 * floor, but a team with no finisher gets no result row at all, so a whole team
 * pulling out of a game takes it to 0. `pointsClinch.test.ts` proves the claim by
 * playing out every outcome through the app's own award functions.
 *
 * `hi` is per unit, not the game's top award, in the two formats where a unit
 * cannot reach it: a match game pays only the matches a unit is in, and a bracket
 * can pay one unit several places. Pairings and entrants can change until a game
 * starts, so before then `hi` is the whole total: `matches: null`,
 * `entrantsByUnit: null`.
 *
 * Banked points only, and derived on every read. Nothing here is stored, so
 * adding a game raises a swing and a lock reverts by itself. A live game is an
 * unbanked game whatever it looks like today (`bankedOnlyWhenFinished`), so a
 * projection can never lock anything: projections reach `clinchWatch` only to be
 * drawn. A game reopened for a correction stays banked, so the caller leaves it
 * out of `unbanked`.
 *
 * Pure, and it knows nothing of teams or people: a unit is an id. A teamless
 * race goes through exactly the same code.
 */

/** Below this two point totals are the same total: averaged ties can leave a
 *  third of a point in a float. */
const EPSILON = 1e-9;

export type ClinchAward =
  /** Awards by finishing place: stroke, Stableford, scramble, skins, manual
   *  games, and a game with no split (`values: [total]`), pick'em included. */
  | { kind: "placement"; values: readonly number[] }
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

const sum = (ns: readonly number[]) => ns.reduce((a, b) => a + b, 0);

/** `values` as a schedule for `places` finishers: a split shorter than the
 *  field pays the rest nothing. */
function paddedSchedule(values: readonly number[], places: number): number[] {
  return Array.from({ length: places }, (_, i) => values[i] ?? 0);
}

/** The most `unitId` can earn from a game (the spec's table). */
export function unitHi(award: ClinchAward, unitId: string): number {
  switch (award.kind) {
    case "placement":
      return Math.max(0, ...award.values);
    case "matches": {
      if (award.matches == null) return award.total;
      // Points not yet in a paired match can still land in one this unit plays.
      const unpaired = Math.max(0, award.total - sum(award.matches.map((m) => m.value)));
      return sum(award.matches.filter((m) => m.unitIds.includes(unitId)).map((m) => m.value)) + unpaired;
    }
    case "bracket": {
      if (award.entrantsByUnit == null) return award.total;
      const places = paddedSchedule(award.values, award.fieldSize).sort((a, b) => b - a);
      return sum(places.slice(0, award.entrantsByUnit[unitId] ?? 0));
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
  swing(unitId: string): number;
  safe(a: string, b: string): boolean;
  out(unitId: string, place: number): boolean;
  places: Map<string, PlaceState>;
  /** The unit alone in 1st with its place locked. A shared 1st has none. */
  clincher: string | null;
}

export function pointsClinch({ unitIds, totals, unbanked }: PointsClinchInput): PointsClinch {
  const pts = (id: string) => totals[id] ?? 0;
  const swings = new Map(unitIds.map((id) => [id, sum(unbanked.map((g) => unitHi(g.award, id)))]));
  const swing = (id: string) => swings.get(id) ?? 0;
  const safe = (a: string, b: string) => pts(a) - pts(b) > swing(b) + EPSILON;
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
        tied.every((u) => swing(t) <= EPSILON && swing(u) <= EPSILON),
    });
  }

  const clincher = unitIds.find((id) => {
    const place = places.get(id)!;
    return place.rank === 1 && !place.shared && place.locked;
  });

  return { swing, safe, out, places, clincher: clincher ?? null };
}

/**
 * What a win in this game is certain to do, for one chaser. Never early applies
 * to the headline too (Zach, 2026-11-05), so this is the leader's least and the
 * chaser's most, given the leader won:
 *
 *  - placement: the leader takes the top award, the chaser the best one left;
 *  - match games: the leader wins its own matches, and the chaser keeps every
 *    match it plays that is not against the leader, plus any points not yet in a
 *    paired match. A game that has not started has no pairings to win, so the
 *    leader is promised nothing from it;
 *  - a bracket: the leader's best entrant wins it, and the chaser's entrants take
 *    the places below.
 */
function afterAWin(award: ClinchAward, leader: string, chaser: string): { leaderGain: number; chaserGain: number } {
  switch (award.kind) {
    case "placement": {
      const [top = 0, next = 0] = [...award.values].sort((a, b) => b - a);
      return { leaderGain: Math.max(0, top), chaserGain: next };
    }
    case "matches": {
      if (award.matches == null) return { leaderGain: 0, chaserGain: award.total };
      const mine = award.matches.filter((m) => m.unitIds.includes(leader));
      const theirs = award.matches.filter((m) => m.unitIds.includes(chaser) && !m.unitIds.includes(leader));
      const unpaired = Math.max(0, award.total - sum(award.matches.map((m) => m.value)));
      return { leaderGain: sum(mine.map((m) => m.value)), chaserGain: sum(theirs.map((m) => m.value)) + unpaired };
    }
    case "bracket": {
      const top = Math.max(0, ...award.values);
      if (award.entrantsByUnit == null) return { leaderGain: top, chaserGain: Math.max(0, award.total - top) };
      if ((award.entrantsByUnit[leader] ?? 0) === 0) return { leaderGain: 0, chaserGain: unitHi(award, chaser) };
      const places = paddedSchedule(award.values, award.fieldSize).sort((a, b) => b - a);
      return { leaderGain: places[0] ?? 0, chaserGain: sum(places.slice(1, 1 + (award.entrantsByUnit[chaser] ?? 0))) };
    }
  }
}

export interface WinsNeeded {
  /** 1, 2, or null for 3 or more. */
  wins: 1 | 2 | null;
  /** The sets of games that would do it, by id. */
  sets: string[][];
  /** Whether every game (or every pair of games) left would do it, whatever else
   *  happens in them. */
  anySet: boolean;
}

/**
 * How many more wins put `leader` safe over everyone in `mustBeat`. Order-free:
 * it asks which games would do it, never which comes next. Single games, then
 * pairs, so it is O(n²) in the games left whatever the size of the cup.
 */
export function winsNeeded(input: PointsClinchInput, leader: string, mustBeat: readonly string[]): WinsNeeded {
  const { totals, unbanked } = input;
  const pts = (id: string) => totals[id] ?? 0;

  const clinches = (won: readonly ClinchGame[]) => {
    const left = unbanked.filter((g) => !won.includes(g));
    return mustBeat.every((c) => {
      const wins = won.map((g) => afterAWin(g.award, leader, c));
      const lead = pts(leader) - pts(c) + sum(wins.map((w) => w.leaderGain - w.chaserGain));
      return lead > sum(left.map((g) => unitHi(g.award, c))) + EPSILON;
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

export interface ClinchWatchInput extends PointsClinchInput {
  /** Games with a banked result, for "no game banked yet". */
  bankedGames: number;
  /** gameId → unitId → projected points: drawn, never locked on. */
  projections: Readonly<Record<string, Readonly<Record<string, number>>>>;
  /** The game banked most recently, and what it paid: who it just put out. */
  lastBanked: { game: ClinchGame; paid: Readonly<Record<string, number>> } | null;
}

export interface ClinchWatch {
  bankedGames: number;
  gamesLeft: number;
  clincherId: string | null;
  /** The highest place still open, or null when every place is locked. */
  place: number | null;
  /** Who is on top of the race for that place. Two or more means level. */
  leaderIds: string[];
  /** The closest contender behind the leader. */
  chaserId: string | null;
  lead: number;
  /** The most the chaser can still gain: the track's whole length. */
  swing: number;
  /** Lead if today holds, when a game left projects. */
  projectedLead: number | null;
  /** How much of `swing` the projecting games carry: where the line lands. */
  liveSwing: number;
  /** One per game left that the chaser can earn from, by that game's swing. */
  segments: { gameId: string; swing: number }[];
  /** Everyone still in the race for that place, and who can no longer reach it. */
  field: { id: string; out: boolean }[];
  /** Units still able to reach the place. */
  alive: number;
  wins: WinsNeeded | null;
  /** The names of the games that would clinch it in one win. */
  winGameNames: string[];
  /** A projecting game that would clinch it if today holds. */
  clinchesIfHolds: string | null;
  /** Units the last banked game put out of 1st. */
  newlyOutIds: string[];
}

/** Everything the hero's story and clinch watch draw, from banked points. */
export function clinchWatch(input: ClinchWatchInput): ClinchWatch {
  const { unitIds, totals, unbanked, projections, bankedGames, lastBanked } = input;
  const view = pointsClinch(input);
  const pts = (id: string) => totals[id] ?? 0;
  const projected = (id: string) => sum(unbanked.map((g) => projections[g.id]?.[id] ?? 0));
  const byPoints = [...unitIds].sort((a, b) => pts(b) - pts(a));

  const openRanks = unitIds.filter((id) => !view.places.get(id)!.locked).map((id) => view.places.get(id)!.rank);
  const place = openRanks.length > 0 ? Math.min(...openRanks) : null;
  const field = place == null ? [] : byPoints.filter((id) => view.places.get(id)!.rank >= place);
  const leaderIds = field.filter((id) => view.places.get(id)!.rank === place);
  const leader = leaderIds[0] ?? null;
  const chaserId = field.find((id) => id !== leader) ?? null;

  const lead = leader && chaserId ? pts(leader) - pts(chaserId) : 0;
  const swing = chaserId ? view.swing(chaserId) : 0;
  const projecting = unbanked.filter((g) => projections[g.id] != null);
  const hiOfChaser = (g: ClinchGame) => (chaserId ? unitHi(g.award, chaserId) : 0);

  const soleLeader = leaderIds.length === 1 ? leader : null;
  const mustBeat = field.filter((id) => id !== soleLeader);
  // The team-specific ladder is for 1st only (Zach, 2026-11-05): a place below it
  // is simply up for grabs.
  const raceForFirst = place === 1 ? soleLeader : null;
  const wins = raceForFirst && unbanked.length > 0 ? winsNeeded(input, raceForFirst, mustBeat) : null;
  const gameNameOf = (id: string) => unbanked.find((g) => g.id === id)?.name ?? "";

  const clinchesIfHolds = raceForFirst
    ? projecting.find((g) => {
        const today = projections[g.id];
        if (Object.values(today).some((p) => p > (today[raceForFirst] ?? 0))) return false;
        const after = Object.fromEntries(unitIds.map((id) => [id, pts(id) + (today[id] ?? 0)]));
        const then = pointsClinch({ unitIds, totals: after, unbanked: unbanked.filter((x) => x !== g) });
        return mustBeat.every((id) => then.safe(raceForFirst, id));
      })?.name ?? null
    : null;

  const newlyOutIds = (() => {
    if (!lastBanked) return [];
    const before = pointsClinch({
      unitIds,
      totals: Object.fromEntries(unitIds.map((id) => [id, pts(id) - (lastBanked.paid[id] ?? 0)])),
      unbanked: [...unbanked, lastBanked.game],
    });
    return unitIds.filter((id) => view.out(id, 1) && !before.out(id, 1));
  })();

  return {
    bankedGames,
    gamesLeft: unbanked.length,
    clincherId: view.clincher,
    place,
    leaderIds,
    chaserId,
    lead,
    swing,
    projectedLead: projecting.length > 0 && leader && chaserId ? pts(leader) + projected(leader) - pts(chaserId) - projected(chaserId) : null,
    liveSwing: sum(projecting.map(hiOfChaser)),
    segments: unbanked.map((g) => ({ gameId: g.id, swing: hiOfChaser(g) })).filter((s) => s.swing > 0),
    field: field.map((id) => ({ id, out: place != null && view.out(id, place) })),
    alive: field.filter((id) => place != null && !view.out(id, place)).length,
    wins,
    winGameNames: wins?.wins === 1 ? wins.sets.map(([id]) => gameNameOf(id)) : [],
    clinchesIfHolds,
    newlyOutIds,
  };
}
