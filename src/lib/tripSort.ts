/**
 * Trip ordering — ONE comparator per section, shared by every surface.
 *
 * The dashboard (mobile) and the desktop rail render the same trips in the same
 * sections and used to order them differently — the dashboard sorted `now` by
 * `end_date` and `upcoming` by `start_date`, and the rail did not sort at all,
 * so it showed whatever order `trips.list` happened to return. Two surfaces
 * disagreeing about the order of one list is the divergence pattern this
 * codebase keeps paying for, and it is avoidable here for the usual reason: the
 * ordering is a pure function of the row, so there is no reason for a second
 * copy of it to exist.
 *
 * The rail merges `now` + `upcoming` into one "Active" section while the
 * dashboard keeps them apart. That is a SECTIONING difference, not an ordering
 * one — `compareActive` is correct applied to either, which is exactly why one
 * comparator can serve both.
 *
 * ── Dates are ISO `YYYY-MM-DD` strings ──────────────────────────────────────
 * Compared with `localeCompare`, not parsed. The format sorts lexicographically
 * in date order by construction, and parsing would introduce a timezone
 * question that comparison does not have. (`parseLocalDate` exists for when the
 * VALUE is needed; ordering only needs the relation.)
 */

export interface SortableTrip {
  title: string;
  start_date?: string | null;
  end_date?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
}

/** Case-insensitive title order — the tie-break everywhere, so equal dates
 *  produce a stable order rather than whatever the server returned. */
function byTitle(a: SortableTrip, b: SortableTrip): number {
  return (a.title ?? "").localeCompare(b.title ?? "", undefined, { sensitivity: "base" });
}

/**
 * ACTIVE (dashboard `now` + `upcoming`, rail "Active"):
 * by date, soonest first — then dates-TBD, alphabetical.
 *
 * The key is `start_date ?? end_date`: a trip with only an end date is still a
 * dated trip and belongs in the dated group, not in TBD. "Dates TBD" means
 * NEITHER, which is what the row itself renders (`formatDateRange`), so the
 * split here and the label there can't disagree.
 *
 * TBD sorts LAST rather than first. A dateless trip is the one you can say
 * least about; putting it above a trip that starts this week would order the
 * list by how little is known about each entry.
 */
export function compareActive(a: SortableTrip, b: SortableTrip): number {
  const ak = a.start_date ?? a.end_date ?? null;
  const bk = b.start_date ?? b.end_date ?? null;
  if (ak && bk) return ak.localeCompare(bk) || byTitle(a, b);
  if (ak) return -1;
  if (bk) return 1;
  return byTitle(a, b);
}

/**
 * PAST: most recent first.
 *
 * Keyed on `end_date ?? start_date` — when a trip ENDED is what "most recent"
 * means for a finished trip. A past trip always has an `end_date` in practice
 * (`getEffectiveStatus` can only return "past" from one), so the fallback and
 * the null branch are defensive rather than load-bearing; undated still sorts
 * last, same as Active, for the same reason.
 */
export function comparePast(a: SortableTrip, b: SortableTrip): number {
  const ak = a.end_date ?? a.start_date ?? null;
  const bk = b.end_date ?? b.start_date ?? null;
  if (ak && bk) return bk.localeCompare(ak) || byTitle(a, b);
  if (ak) return -1;
  if (bk) return 1;
  return byTitle(a, b);
}

/**
 * IDEAS: most recently touched first.
 *
 * Not in the spec that unified Active and Past, and included anyway for the
 * same reason they were: the dashboard already sorted ideas this way and the
 * rail's Ideas column did not sort at all, so the divergence was identical in
 * kind. An idea-phase trip has no dates to order by — activity is the only
 * signal it has.
 */
export function compareIdea(a: SortableTrip, b: SortableTrip): number {
  const ak = a.updated_at ?? a.created_at ?? "";
  const bk = b.updated_at ?? b.created_at ?? "";
  return bk.localeCompare(ak) || byTitle(a, b);
}
