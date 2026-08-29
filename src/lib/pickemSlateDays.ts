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
): { day: string; key: string; date: string | null; time: string } | null {
  if (!kickoff) return null;
  const trimmed = kickoff.trim();
  const m = /^([A-Za-z]{3,9})\b[.,]?\s*(.*)$/.exec(trimmed);
  if (!m) return null;
  const word = m[1].toLowerCase();
  const canonical = DAYS.find((d) => d.startsWith(word));
  if (!canonical) return null;
  /**
   * The rest splits again at the comma, because `formatKickoff` emits
   * "Fri Aug 28, 8:00p" — a DATE and a TIME, not one blob.
   *
   * That split is what lets the day heading carry the date while the row keeps
   * only the time, so "THU AUG 28" and "8:00p" describe one game between them
   * instead of the heading saying "THU" over a row saying "Aug 28, 8:00p" —
   * the same day, twice, not looking like it.
   *
   * A hand-typed "Sat 3:30p" has no comma and no date. That is fine: the
   * heading is then just the day, which is all the runner gave.
   */
  const rest = m[2].trim();
  const comma = rest.indexOf(",");
  const date = comma >= 0 ? rest.slice(0, comma).trim() || null : null;
  const time = comma >= 0 ? rest.slice(comma + 1).trim() : rest;

  /**
   * The key includes the DATE, and that is a fix rather than a refinement.
   *
   * Keyed on the weekday alone, a slate spanning more than one week merges two
   * different Saturdays into one heading — and a pick'em slate spanning weeks
   * is the ordinary case, not an edge one. The runner's own spelling still
   * drives what is DISPLAYED; this only decides what counts as the same day.
   */
  return { day: m[1], key: date ? `${canonical}|${date}` : canonical, date, time };
}

export interface SlateDayGroup<T> {
  /** As the runner wrote it, for the eyebrow. */
  day: string;
  /** "Aug 28", when the kickoff carried one. Null on a hand-typed day-only. */
  date: string | null;
  /** Canonical day + date, so "Thu" and "Thursday" are one run and two
   *  different Saturdays are not. */
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
      out.push({ day: split.day, date: split.date, key: split.key, games: [g] });
    }
  }

  return out.length > 1 ? out : null;
}

const MONTHS = [
  "jan", "feb", "mar", "apr", "may", "jun",
  "jul", "aug", "sep", "oct", "nov", "dec",
] as const;

/**
 * A slate game as a sortable instant — or null when it cannot be read as one.
 *
 * ── Year-free on purpose, and season-aware because of it ──────────────────
 *
 * `kickoff` is free text with no year in it (`"Fri Aug 28, 8:00p"`), so this
 * builds a month/day/time key rather than a real date. That is enough to order
 * a slate, which is always a handful of games close together — and it is all
 * the data there is until a timestamp column exists (#1137).
 *
 * The one place month/day ordering is wrong is the season boundary the NFL
 * actually crosses: a slate running 28 Dec to 3 Jan would put January first.
 * `compareSlateKickoffs` handles that by looking at the whole set rather than
 * at either game alone — which is why the wrap lives there and not here.
 */
export function slateSortKey(kickoff: string | null | undefined): number | null {
  const split = splitKickoffDay(kickoff);
  if (!split?.date) return null;

  const m = /^([A-Za-z]{3,9})\s+(\d{1,2})$/.exec(split.date.trim());
  if (!m) return null;
  const month = MONTHS.findIndex((x) => m[1].toLowerCase().startsWith(x));
  if (month < 0) return null;
  const day = Number(m[2]);

  // The time is a tiebreak within a day, and a missing or unparseable one
  // sorts to the start of its day rather than dropping the game entirely: the
  // DATE is the ordering the runner cares about.
  const t = /^(\d{1,2}):(\d{2})\s*([ap])?/i.exec(split.time ?? "");
  let minutes = 0;
  if (t) {
    let hour = Number(t[1]) % 12;
    if ((t[3] ?? "").toLowerCase() === "p") hour += 12;
    minutes = hour * 60 + Number(t[2]);
  }

  return month * 100000 + day * 1000 + minutes;
}

/**
 * Order two slate games by kickoff, across a football season boundary.
 *
 * `januaryIsLater` is decided by the CALLER from the whole slate, because
 * neither game can know it alone: 3 Jan is later than 28 Dec only when the
 * slate contains both, and earlier than 5 Sep in every ordinary slate that
 * does not. Passing it in keeps the comparator a pure function of what it was
 * told rather than of a guess about the calendar.
 */
export function compareSlateKickoffs(
  a: string | null | undefined,
  b: string | null | undefined,
  januaryIsLater: boolean
): number {
  const ka = slateSortKey(a);
  const kb = slateSortKey(b);
  // An unreadable kickoff keeps its position rather than being sorted to an
  // end it did not ask for.
  if (ka == null || kb == null) return 0;
  const bump = (k: number) => (januaryIsLater && k < 2 * 100000 ? k + 12 * 100000 : k);
  return bump(ka) - bump(kb);
}

/**
 * Does this slate straddle the turn of the year?
 *
 * True only when it holds both late-season (Aug-Dec) and new-year (Jan-Feb)
 * games, which is the NFL regular season running to January — measured, not
 * assumed: ESPN returns that season's fixtures through 2027-01-10.
 */
export function slateCrossesNewYear(kickoffs: readonly (string | null | undefined)[]): boolean {
  let late = false;
  let early = false;
  for (const k of kickoffs) {
    const key = slateSortKey(k);
    if (key == null) continue;
    const month = Math.floor(key / 100000);
    if (month >= 7) late = true;
    if (month <= 1) early = true;
  }
  return late && early;
}