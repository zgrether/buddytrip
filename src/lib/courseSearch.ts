/**
 * Course-search flow helpers (W-GAMEPAGE-01 §10) — pure, client-safe, so the
 * picker and its tests share one definition. No React/tRPC/DB deps.
 */

/** Normalize a course name for cross-source matching (API id ≠ saved DB id, so
 *  dedup/compare is name-keyed). */
export function normalizeCourseName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Manual-entry button visibility (§10 / pin #4).
 * - FRONT mode gates it behind the full-database search: hidden on recents +
 *   while live-filtering, shown only once `apiSearched` (incl. an EMPTY result,
 *   so a no-match query still has a path forward).
 * - BACK mode has no API stage (a back nine is a saved/manual 9-holer), so the
 *   button stays available throughout.
 */
export function manualEntryVisible(opts: { back: boolean; apiSearched: boolean }): boolean {
  return opts.back || opts.apiSearched;
}

/**
 * Dedup API search results against the user's SAVED courses by normalized name
 * (§10 stage 3) — a saved course already shows in the local list, so it must not
 * double-list under "From the course database".
 */
export function dedupeApiCourses<T extends { name: string }>(api: T[], savedNames: Iterable<string>): T[] {
  const set = new Set<string>();
  for (const n of savedNames) set.add(normalizeCourseName(n));
  return api.filter((c) => !set.has(normalizeCourseName(c.name)));
}
