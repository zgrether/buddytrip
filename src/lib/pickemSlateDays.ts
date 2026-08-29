/**
 * Grouping the slate by the day it is played on.
 *
 * ── The design assumes a datetime the schema does not have ─────────────────
 *
 * `pickem_slate_games.kickoff` is free TEXT — "Thu 8:15p", typed by the runner
 * — not a timestamp. So there is no date to group by, only a weekday token at
 * the front of a string somebody wrote by hand.
 *
 * That makes the grouping a READING of the runner's own labels rather than a
 * fact about time, and it is built to fail loudly rather than quietly:
 *
 *   - If ANY game's kickoff does not start with a recognisable day, the whole
 *     grouping is refused and the caller renders the flat list it renders
 *     today. Partial grouping is worse than none — a game nobody could place
 *     would be filed under whichever heading happened to precede it, and the
 *     reader would have no way to know it had been guessed at.
 *   - Groups are consecutive RUNS, not buckets. Bucketing by day would move a
 *     stray second Saturday up next to the first, silently reordering a list
 *     whose order is the runner's own and is what the ranking is built on.
 *
 * The win, when it does apply, is the one the design names: sixteen rows become
 * four short lists and the day stops repeating on every line, which is what was
 * eating the row width.
 */

/**
 * The seven days, in full, matched by PREFIX of the day rather than prefix of
 * the word.
 *
 * The difference is the whole check: `"monsoon".startsWith("mon")` is true, so
 * matching the other way round reads "Monsoon 3:00p" as Monday and groups a
 * game under a heading nobody wrote. `"monday".startsWith("monsoon")` is false,
 * which is the answer wanted — while "Tues", "Thur" and "Saturday" all still
 * resolve, because those really are prefixes of the day.
 */
const DAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

/**
 * The day a kickoff string starts with, and what is left after it.
 *
 * Returns null when the string does not begin with a day — including when it is
 * empty or absent, which is a game whose time nobody has set.
 */
export function splitKickoffDay(
  kickoff: string | null | undefined
): { day: string; key: string; rest: string } | null {
  if (!kickoff) return null;
  const trimmed = kickoff.trim();
  const m = /^([A-Za-z]{3,9})\b[.,]?\s*(.*)$/.exec(trimmed);
  if (!m) return null;
  const word = m[1].toLowerCase();
  const key = DAYS.find((d) => d.startsWith(word));
  if (!key) return null;
  // The runner's own spelling is what the eyebrow shows — "Thu" and "Thursday"
  // are both theirs, and rewriting it would be this module having an opinion
  // about their labels. `key` is the canonical day, so grouping can tell that
  // the two are the same Thursday.
  return { day: m[1], key, rest: m[2].trim() };
}

export interface SlateDayGroup<T> {
  /** As the runner wrote it, for the eyebrow. */
  day: string;
  /** The canonical day, so "Thu" and "Thursday" are one run. */
  key: string;
  games: T[];
}

/**
 * The slate as consecutive day runs, or NULL when it cannot be grouped.
 *
 * Null is the caller's signal to render the flat list — it is not an error and
 * it is not empty. A slate with one game, or one where every game shares a day,
 * also returns null: a single heading over the whole list is a heading that
 * distinguishes nothing, and the row would keep its full kickoff string for no
 * gain.
 */
export function groupSlateByDay<T extends { kickoff?: string | null }>(
  games: readonly T[]
): SlateDayGroup<T>[] | null {
  if (games.length === 0) return null;

  const out: SlateDayGroup<T>[] = [];
  for (const g of games) {
    const split = splitKickoffDay(g.kickoff);
    if (!split) return null;
    const last = out[out.length - 1];
    if (last && last.key === split.key) {
      last.games.push(g);
    } else {
      out.push({ day: split.day, key: split.key, games: [g] });
    }
  }

  return out.length > 1 ? out : null;
}
