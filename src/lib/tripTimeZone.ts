/**
 * The one timezone every pick'em clock is expressed in.
 *
 * ── The bug this exists to close ───────────────────────────────────────────
 *
 * Pick'em puts TWO kinds of time on one screen, and until now they lived in
 * different reference frames:
 *
 *   - `pickem_games.picks_deadline` is a `timestamptz` — a real instant, which
 *     `toLocaleString` rendered in the VIEWER's own zone. It follows the reader
 *     across state lines, correctly.
 *   - `pickem_slate_games.kickoff` is `text` (migration 146) — a string like
 *     "Wed 8:20p" that `formatKickoff` produced by rendering ESPN's instant in
 *     whatever zone the RUNNER's browser was in when they built the slate, and
 *     then froze. It never moves again, for anyone.
 *
 * So a deadline set 10 minutes before an 8:20 Eastern kickoff read "Closes
 * 8:10 PM" beside "8:20p" in South Carolina, and "Closes 7:10 PM" beside the
 * same unmoved "8:20p" one state west — which reads as a deadline 70 minutes
 * early rather than 10. Both halves were individually correct. The screen was
 * not, because one clock moved and the other could not.
 *
 * ── Why pinning, and not "make everything device time" ─────────────────────
 *
 * The obvious fix is the opposite one: convert the kickoffs too. It cannot be
 * done from what is stored. `"Wed 8:20p"` carries no zone and no instant
 * behind it — `PickemSlateModal` has ESPN's real `startsAt` in hand at import
 * and keeps only the formatted string — so there is nothing to convert. Making
 * kickoffs device-local needs a `kickoff_at timestamptz` and a backfill, which
 * is real work and is filed separately.
 *
 * Until then the only self-consistent choice is to move the deadline INTO the
 * frame the kickoffs are already stuck in, and to say on screen which frame
 * that is. A labelled clock everyone shares beats two unlabelled clocks that
 * disagree — and it has an independent virtue: the crew is standing in one
 * place saying "the 8:20 game" out loud, so a screen that matches the group is
 * worth more here than one that matches your own watch.
 *
 * ── Why a constant and not a column ────────────────────────────────────────
 *
 * There is no timezone column anywhere in this schema, and adding one means a
 * migration plus a trip-settings surface. This is deliberately the smaller
 * move: ONE constant, in ONE module, that a `trips.timezone` read can replace
 * without touching a single call site. It is not a hardcoded id — it is a
 * default with one home.
 */

/**
 * IANA zone, not a fixed offset: `America/New_York` carries its own DST rules,
 * so every instant conversion below is correct on both sides of the November
 * change without anything here knowing when that is.
 */
export const TRIP_TIME_ZONE = "America/New_York";

/**
 * What the screen CALLS that zone — "ET", the whole year.
 *
 * ── Why a constant, when the offset is not one ─────────────────────────────
 *
 * This started out derived per instant, on the reasoning that "EDT" is a lie
 * from November to March. True, and it produced a worse problem: the label then
 * varies across a boundary the reader does not care about, and every surface
 * showing it needs an instant to derive it from. One of them was handed the
 * wrong instant and said EST beside a deadline reading EDT — two spellings of
 * one zone on one screen, which is precisely the "one concept, two names"
 * confusion this whole change exists to remove.
 *
 * "ET" names the ZONE rather than its current offset. It is correct in January
 * and in July, it is how every football schedule writes a kickoff, and it needs
 * no argument — so there is no instant to pass and nothing to pass wrongly.
 *
 * Display-string tier. No stored value has ever carried an abbreviation.
 */
export const TRIP_TIME_ZONE_LABEL = "ET";

/** The wall clock a zone shows at some instant. Month is 1-based. */
export interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function partsOf(ms: number, timeZone: string): WallClock & { second: number } {
  // `formatToParts` rather than a parsed string: the separators and ordering
  // are locale-dependent and the literal parts are exactly what we do not want.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? NaN);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/**
 * The zone's offset from UTC at a given instant, in ms (EDT → -4h).
 *
 * Derived by asking what wall clock the zone shows and reading that clock back
 * AS IF it were UTC — the difference is the offset. This is the standard trick
 * and it is exact, because both sides come from the same instant.
 */
function offsetMsAt(ms: number, timeZone: string): number {
  const p = partsOf(ms, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - ms;
}

/** What clock `timeZone` reads at this instant. */
export function wallClockInZone(iso: string | Date | number, timeZone = TRIP_TIME_ZONE): WallClock | null {
  const ms = iso instanceof Date ? iso.getTime() : typeof iso === "number" ? iso : new Date(iso).getTime();
  if (!Number.isFinite(ms)) return null;
  const { year, month, day, hour, minute } = partsOf(ms, timeZone);
  return { year, month, day, hour, minute };
}

/**
 * ...and back: the instant at which `timeZone` reads this wall clock.
 *
 * TWO passes, and the second one is not belt-and-braces. The offset depends on
 * the instant, and the instant is what we are solving for — so pass one uses
 * the offset at the naive guess, which is wrong for a wall clock that lands on
 * the far side of a DST change from that guess. Pass two re-reads the offset at
 * the corrected instant and lands on it.
 *
 * The one input with no answer is a wall clock inside the hour spring-forward
 * deletes (2:30 AM on a March Sunday, which never occurs). This returns the
 * instant one hour later rather than throwing — a deadline is a real moment
 * whatever a runner typed, and refusing to set one at all is worse.
 */
export function instantFromWallClock(wall: WallClock, timeZone = TRIP_TIME_ZONE): number {
  const naive = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, 0, 0);
  const firstPass = naive - offsetMsAt(naive, timeZone);
  return naive - offsetMsAt(firstPass, timeZone);
}

/**
 * How a pick'em instant reads to a person: `Wed, Sep 9, 8:10 PM ET`.
 *
 * The label is part of the string rather than a separate element, because the
 * two are one fact and a caller that renders them apart is a caller that can
 * render one without the other.
 */
export function formatInTripZone(iso: string | null, timeZone = TRIP_TIME_ZONE): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const stamp = d.toLocaleString("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return `${stamp} ${TRIP_TIME_ZONE_LABEL}`;
}

/**
 * The sentence telling a reader which frame the times on this screen are in.
 *
 * Takes NO instant, and that is the point rather than a simplification. The
 * version that did took one so it could say EDT or EST — and a caller handed it
 * `deadlineMs`, which is milliseconds REMAINING and not an epoch instant, so
 * 21 hours read as 1 January 1970 and the note said EST beside a deadline
 * reading EDT. A well-formed, confident, wrong label.
 *
 * A function with no argument cannot be given the wrong one.
 */
export function tripZoneNote(): string {
  return `All times ${TRIP_TIME_ZONE_LABEL}`;
}
