/**
 * One answer to "what does this list screen show?", in ONE order (#1616).
 *
 * "Nothing here" and "couldn't load" are different, and every screen that got
 * them right did it by hand: the dashboard, the desktop rail, the leaderboard,
 * the side-games board. A copy is what the next screen forgets: #764 told a
 * person with trips that they had none, because a failed fetch defaulted to
 * `[]` and fell through to the first-run pitch.
 *
 * So the ORDER lives here, and a screen only says what each state looks like:
 *  - no data yet: `error` if the read failed (with a retry), else `loading`.
 *    Error and loading exist ONLY while there is nothing to show, so a failed
 *    background refetch keeps the last good list on screen (TanStack keeps
 *    `data` through it), which is the leaderboard's long-standing rule;
 *  - data: `empty` or `ready`.
 *
 * "Empty" is reachable only once data has ARRIVED, so a screen cannot render
 * "nothing here" for a failed or unfinished read. Pass the QUERY itself: a
 * destructure that defaults `data` to `[]` has already thrown away the
 * difference this exists to keep (`noEmptyDefault.guard.test.ts`).
 *
 * A disabled query (no data, no error) reads as `loading`; a screen that
 * renders nothing while hidden decides that in its own `loading` case.
 */

export type ListState<T> =
  | { kind: "loading" }
  | { kind: "error"; retry: () => void }
  | { kind: "empty"; data: T }
  | { kind: "ready"; data: T };

/** The parts of a tRPC / TanStack query result this needs. */
export type ListQuery<T> = {
  data: T | undefined;
  isError: boolean;
  refetch: () => unknown;
};

const isEmptyByDefault = (d: unknown): boolean => Array.isArray(d) && d.length === 0;

export function listStateOf<T>(query: ListQuery<T>, isEmpty: (data: T) => boolean = isEmptyByDefault): ListState<T> {
  if (query.data === undefined) {
    return query.isError ? { kind: "error", retry: () => void query.refetch() } : { kind: "loading" };
  }
  return isEmpty(query.data) ? { kind: "empty", data: query.data } : { kind: "ready", data: query.data };
}

/**
 * The same order for a PLAIN FETCH that reports its own outcome (the course and
 * matchup searches, #1613 / #1614): `failed` must be reported separately from
 * an empty result, or this cannot tell them apart either.
 */
export function fetchListState<T>(
  fetch: { pending: boolean; failed: boolean; data: T | undefined; retry: () => void },
  isEmpty: (data: T) => boolean = isEmptyByDefault
): ListState<T> {
  if (fetch.data === undefined || fetch.pending) {
    if (fetch.failed) return { kind: "error", retry: fetch.retry };
    return { kind: "loading" };
  }
  return isEmpty(fetch.data) ? { kind: "empty", data: fetch.data } : { kind: "ready", data: fetch.data };
}
