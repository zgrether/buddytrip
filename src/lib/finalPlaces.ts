/**
 * The places a points cup finished in (docs/CLINCH_AND_PODIUM.md §5). Pure, so the
 * standings, the hero and the Needs attention card read one answer.
 *
 * A tie shares its place, 1st included. `tiebreak_order` orders a tie only when it
 * names EVERY unit in it: a correction can change who is level, and an order saved
 * for a tie that no longer exists says nothing about the one that does.
 */

export interface FinalPlace {
  /** Competition ranking (1, 2, 2, 4), or the order the owner set. */
  place: number;
  shared: boolean;
}

export interface SharedPlace {
  place: number;
  unitIds: string[];
}

const level = (a: number, b: number) => Math.abs(a - b) < 1e-9;

/** Exact ties in standings order, one group per score, with no order applied. */
function scoreGroups(unitIds: readonly string[], totals: Readonly<Record<string, number>>): { start: number; ids: string[] }[] {
  const sorted = [...unitIds].sort((a, b) => (totals[b] ?? 0) - (totals[a] ?? 0));
  const groups: { start: number; ids: string[] }[] = [];
  sorted.forEach((id, i) => {
    const last = groups[groups.length - 1];
    if (last && level(totals[last.ids[0]] ?? 0, totals[id] ?? 0)) last.ids.push(id);
    else groups.push({ start: i + 1, ids: [id] });
  });
  return groups;
}

export function finalPlaces(
  unitIds: readonly string[],
  totals: Readonly<Record<string, number>>,
  tiebreakOrder: readonly string[] | null | undefined
): Map<string, FinalPlace> {
  const order = tiebreakOrder ?? [];
  const places = new Map<string, FinalPlace>();
  for (const { start, ids } of scoreGroups(unitIds, totals)) {
    const broken = ids.length > 1 && ids.every((id) => order.includes(id));
    if (broken) {
      [...ids].sort((a, b) => order.indexOf(a) - order.indexOf(b)).forEach((id, i) => places.set(id, { place: start + i, shared: false }));
    } else {
      for (const id of ids) places.set(id, { place: start, shared: ids.length > 1 });
    }
  }
  return places;
}

/** The places still shared, best first. */
export function sharedPlaces(
  unitIds: readonly string[],
  totals: Readonly<Record<string, number>>,
  tiebreakOrder: readonly string[] | null | undefined
): SharedPlace[] {
  const groups = new Map<number, string[]>();
  for (const [id, p] of finalPlaces(unitIds, totals, tiebreakOrder)) {
    if (p.shared) groups.set(p.place, [...(groups.get(p.place) ?? []), id]);
  }
  return [...groups].sort(([a], [b]) => a - b).map(([place, ids]) => ({ place, unitIds: ids }));
}

/** Who holds 1st: one unit, or everyone sharing it. */
export function winnersOf(
  unitIds: readonly string[],
  totals: Readonly<Record<string, number>>,
  tiebreakOrder: readonly string[] | null | undefined
): string[] {
  return [...finalPlaces(unitIds, totals, tiebreakOrder)].filter(([, p]) => p.place === 1).map(([id]) => id);
}

/** True when these units are exactly one tie on the board, order or no order. */
export function isExactTie(
  unitIds: readonly string[],
  tiedIds: readonly string[],
  totals: Readonly<Record<string, number>>
): boolean {
  return scoreGroups(unitIds, totals).some((g) => g.ids.length > 1 && g.ids.length === tiedIds.length && tiedIds.every((id) => g.ids.includes(id)));
}
