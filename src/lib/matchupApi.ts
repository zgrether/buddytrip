/**
 * Matchup lookup — the pure half.
 *
 * Turns ESPN's raw shapes into a small normalized contract, and searches a
 * cached team index locally. No React, no network, no storage. The routes
 * (`/api/matchups/*`) import the normalizers; the component imports the search.
 *
 * ── It knows nothing about pick'em, deliberately ────────────────────────────
 * Not a single import from the pick'em tree, and no concept of a slate, a
 * draft, or a game row. Its whole contract is: give it a search string, get
 * back contests with two sides and a start time. `matchupBoundary.test.ts`
 * fails the build if that stops being true.
 *
 * The reason is not reuse — it is that the LIKELY second consumer does not want
 * most of this. Ad-hoc betting on a golf trip is "twenty bucks says you miss
 * this putt": free text, two sides, no ESPN at all. So the half that looks
 * shared may be the half nobody else needs, and the honest move is a clean
 * boundary rather than a premature shared home. With the boundary held,
 * extracting later is a file move; without it, a rewrite.
 *
 * ── The source is UNDOCUMENTED and that is priced in ────────────────────────
 * ESPN's `site.api` endpoints need no key and cover NFL and college football in
 * one integration. They are also unofficial: no contract, no deprecation
 * notice, and they can change shape without warning. Everything here therefore
 * (a) reads defensively — a missing field drops that row rather than throwing,
 * and (b) fails to EMPTY, never to an error the surface cannot continue past.
 * Manual entry is the base case and stays the base case; this fills fields a
 * person could have typed.
 */

/** A league ESPN can be asked about. Adding basketball is a line in the list
 *  below, which is the point of it being config rather than a hardcoded pair. */
export interface MatchupLeague {
  /** Our id, used in URLs and cache keys. */
  id: string;
  /** What a person calls it. */
  label: string;
  /** ESPN's path segment pair, e.g. `football/college-football`. */
  espnPath: string;
}

export const MATCHUP_LEAGUES: MatchupLeague[] = [
  { id: "nfl", label: "NFL", espnPath: "football/nfl" },
  { id: "cfb", label: "College Football", espnPath: "football/college-football" },
];

export function leagueById(id: string | null | undefined): MatchupLeague | undefined {
  return MATCHUP_LEAGUES.find((l) => l.id === id);
}

export const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports";

export function teamsUrl(league: MatchupLeague): string {
  // `limit=1000` is what makes the college list arrive in ONE response (759
  // teams as of writing); without it ESPN pages at 50 and the index would be
  // silently short — which reads as "that team doesn't exist" in the search.
  return `${ESPN_BASE}/${league.espnPath}/teams?limit=1000`;
}

/**
 * One team's schedule — REGULAR SEASON, explicitly.
 *
 * ── Why `seasontype=2` is not optional ────────────────────────────────────
 *
 * Without it ESPN picks the default for the league, and for the NFL in
 * August that default is the PRESEASON. Measured 2026-08-29:
 *
 *   NFL, no param      -> seasontype 1, 3 events, 0 in the future
 *                         (Aug 15 - Aug 29, all played)
 *   NFL, seasontype=2  -> 17 events, all 17 in the future
 *                         (Sep 15 2026 - Jan 10 2027)
 *   CFB, either        -> 12 events, all in the future
 *
 * That is the whole of the reported bug: selecting an NFL team returned only
 * games in the past, because the preseason it was being handed had finished.
 * College football was unaffected, which is why it read as intermittent
 * rather than broken.
 *
 * ── And why the SEASON YEAR is deliberately NOT pinned ────────────────────
 *
 * The obvious companion fix — send `season=<current year>` — is the one that
 * breaks the season boundary. The NFL's 2026 regular season runs to
 * 2027-01-10 and ESPN still labels those January games season 2026, so a
 * slate built in January for games that same week would ask for season 2027
 * and get nothing. ESPN's own default already resolves the year correctly
 * across the boundary; only the TYPE is wrong. Fix the wrong thing, leave
 * the right thing alone.
 *
 * Postseason is `seasontype=3` and is not requested: a slate is built from
 * scheduled fixtures, and playoff pairings do not exist until they are set.
 */
export function scheduleUrl(league: MatchupLeague, teamId: string): string {
  return `${ESPN_BASE}/${league.espnPath}/teams/${encodeURIComponent(teamId)}/schedule?seasontype=2`;
}

// ── the normalized contract ────────────────────────────────────────────────

/** One team, as the local index holds it. Four fields, because a person will
 *  type any of three of them. */
export interface MatchupTeam {
  id: string;
  /** "Ohio State Buckeyes" */
  displayName: string;
  /** "Ohio State" */
  shortName: string;
  /** "OSU" */
  abbreviation: string;
  leagueId: string;
}

/** A contest. THIS is the contract the consumer gets — two sides and a time. */
export interface Matchup {
  /** ESPN's event id. Carried so a caller can dedupe and, later, pull results. */
  espnEventId: string;
  away: string;
  home: string;
  /** ISO 8601, UTC, straight from ESPN. Formatting is the caller's business —
   *  there is no timezone column in this app's schema (spec §7). */
  startsAt: string;
  /** Neutral-site games have no real home team; the caller may want to say so. */
  neutralSite: boolean;
  /**
   * Is the KICKOFF TIME real, or is the game only scheduled to a date?
   *
   * ESPN says so explicitly (`timeValid`), which is worth knowing because the
   * obvious heuristic is wrong in two directions. A to-be-scheduled game does
   * NOT arrive as midnight UTC — it arrives as midnight US EASTERN expressed in
   * UTC, so `04:00Z` in September and `05:00Z` after the DST change in
   * November. Checking for a local midnight would therefore have fired only for
   * viewers in Eastern and shown everyone else a confident, wrong evening time.
   *
   * The flag removes the guess entirely.
   */
  startTimeKnown: boolean;
}

// ── normalizers (raw ESPN → the above) ─────────────────────────────────────

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw | null => (typeof v === "object" && v !== null ? (v as Raw) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/**
 * `{ sports: [{ leagues: [{ teams: [{ team: {...} }] }] }] }` → flat teams.
 *
 * Every level is optional-chained and every row is dropped rather than
 * defaulted: a team with no id cannot be scheduled, and a team with no name
 * cannot be searched, so neither is worth keeping.
 */
export function normalizeTeams(raw: unknown, leagueId: string): MatchupTeam[] {
  const league = obj(arr(obj(raw)?.sports)[0]);
  const leagues = arr(league?.leagues);
  const entries = arr(obj(leagues[0])?.teams);
  const out: MatchupTeam[] = [];
  for (const entry of entries) {
    const t = obj(obj(entry)?.team);
    if (!t) continue;
    const id = str(t.id);
    const displayName = str(t.displayName);
    if (!id || !displayName) continue;
    out.push({
      id,
      displayName,
      shortName: str(t.shortDisplayName) ?? displayName,
      abbreviation: str(t.abbreviation) ?? "",
      leagueId,
    });
  }
  return out;
}

/**
 * `{ events: [{ id, date, competitions: [{ competitors: [...] }] }] }` → matchups.
 *
 * A competitor carries `homeAway`, so away/home come from the DATA rather than
 * from array order — ESPN lists the home team first for some leagues and not
 * others, and "competitors[0] is away" is the kind of assumption that works
 * until it doesn't.
 */
export function normalizeSchedule(raw: unknown): Matchup[] {
  const out: Matchup[] = [];
  for (const e of arr(obj(raw)?.events)) {
    const ev = obj(e);
    if (!ev) continue;
    const espnEventId = str(ev.id);
    const startsAt = str(ev.date);
    const comp = obj(arr(ev.competitions)[0]);
    if (!espnEventId || !startsAt || !comp) continue;

    let away: string | null = null;
    let home: string | null = null;
    for (const c of arr(comp.competitors)) {
      const cc = obj(c);
      const name = str(obj(cc?.team)?.displayName) ?? str(obj(cc?.team)?.shortDisplayName);
      if (!name) continue;
      if (cc?.homeAway === "away") away = name;
      else if (cc?.homeAway === "home") home = name;
    }
    // Both sides or nothing: a one-sided contest is not something a person can
    // pick a winner in, so it is dropped rather than half-filled.
    if (!away || !home) continue;

    // Absent `timeValid` is treated as KNOWN: the flag is what marks the
    // exception, and defaulting an ordinary game to "TBD" because a field went
    // missing would hide real kickoffs behind a shape change.
    const startTimeKnown = ev.timeValid !== false && comp.timeValid !== false;

    out.push({
      espnEventId,
      away,
      home,
      startsAt,
      neutralSite: comp.neutralSite === true,
      startTimeKnown,
    });
  }
  return out;
}

// ── local search over the cached index ─────────────────────────────────────

/** Lowercase, strip punctuation and collapse whitespace, so "Ohio St." and
 *  "ohio st" are the same query. */
export function normalizeQuery(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

/** The minimum query length worth searching. One letter matches most of college
 *  football and tells nobody anything. */
export const MIN_QUERY = 2;

/**
 * Rank a team against a query, or null for no match.
 *
 * Lower is better. The ordering is the whole point of scoring rather than
 * filtering: someone typing "Ohio" should see Ohio State above Ohio Bobcats
 * only if that is what the data says, and someone typing "OSU" should get the
 * abbreviation hit first rather than buried under substring noise.
 */
export function scoreTeam(team: MatchupTeam, query: string): number | null {
  const q = normalizeQuery(query);
  if (q.length < MIN_QUERY) return null;

  const display = normalizeQuery(team.displayName);
  const short = normalizeQuery(team.shortName);
  const abbr = normalizeQuery(team.abbreviation);

  if (abbr && abbr === q) return 0;              // "OSU"
  if (short === q) return 1;                     // "Ohio State"
  if (display === q) return 2;                   // "Ohio State Buckeyes"
  if (short.startsWith(q)) return 3;             // "Ohio Sta"
  if (display.startsWith(q)) return 4;
  // A word boundary beats a mid-word hit: "state" should find "Ohio State"
  // before "Iowa State"'s middle, and both before something merely containing
  // the letters.
  if (new RegExp(`\\b${escapeRegExp(q)}`).test(display)) return 5;
  if (display.includes(q) || short.includes(q)) return 6;
  if (abbr.startsWith(q)) return 7;
  return null;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The search itself — pure, synchronous, over an in-memory index. No network,
 *  which is what makes typing free. */
export function searchTeams(index: MatchupTeam[], query: string, limit = 8): MatchupTeam[] {
  const scored: { team: MatchupTeam; score: number }[] = [];
  for (const team of index) {
    const score = scoreTeam(team, query);
    if (score != null) scored.push({ team, score });
  }
  scored.sort(
    (a, b) => a.score - b.score || a.team.displayName.localeCompare(b.team.displayName)
  );
  return scored.slice(0, limit).map((s) => s.team);
}

/**
 * Upcoming games first, and never more than a handful.
 *
 * `now` is injected so this is testable against a fixed clock rather than
 * against whenever the suite happens to run — a schedule test that depends on
 * the real date starts failing in September.
 */
export function upcomingFirst(matchups: Matchup[], now: number = Date.now(), limit = 8): Matchup[] {
  const withTime = matchups
    .map((m) => ({ m, t: new Date(m.startsAt).getTime() }))
    .filter((x) => Number.isFinite(x.t));
  const future = withTime.filter((x) => x.t >= now).sort((a, b) => a.t - b.t);
  // Fall back to the most recent PAST games when the season is over, so an
  // out-of-season search shows something rather than an empty list that reads
  // as "this team doesn't exist".
  const past = withTime.filter((x) => x.t < now).sort((a, b) => b.t - a.t);
  return [...future, ...past].slice(0, limit).map((x) => x.m);
}

/**
 * A kickoff, in the reader's own timezone: `Sat Sep 5, 7:30p`.
 *
 * ── Why the DATE is in it ───────────────────────────────────────────────────
 * It used to be weekday plus time, which is exactly right for a one-weekend
 * slate and wrong for what this actually returns: the next several games,
 * spread over weeks. Three rows all reading "Sat" name three different
 * Saturdays and there is nothing to tell them apart.
 *
 * ── Why it is SHORT ─────────────────────────────────────────────────────────
 * This string is dropped straight into the slate's Game time field and then
 * shown on every row of a sixteen-game list, so it competes for width with the
 * matchup itself. Weekday is kept because football is thought about in
 * weekdays ("the Saturday game"), and the am/pm is compressed to a single
 * letter the way the rest of the slate writes times.
 *
 * Client-local by construction — there is no timezone column anywhere in this
 * schema, so the browser's zone is the only one available and rendering the
 * instant is the honest thing to do.
 */
export function formatKickoff(iso: string, startTimeKnown = true): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";

  // Built from two calls rather than one: asking for weekday+month+day together
  // yields "Sat, Sep 5", which then reads "Sat, Sep 5, 12:30p" — two commas for
  // one date.
  const weekday = d.toLocaleString(undefined, { weekday: "short" });
  const date = d.toLocaleString(undefined, { month: "short", day: "numeric" });

  // No regex here on purpose. The meridiem separator is often U+202F (a narrow
  // no-break space), not U+0020, so a naive `" "` replace misses it — and the
  // escaped-whitespace version of this got its backslash eaten in transit once
  // already, producing `/s*PM$/` which silently matched "PM" and left the space
  // behind. `trim()` handles every Unicode space separator, U+202F included.
  // The DATE is real even when the time is not — a to-be-scheduled game is
  // scheduled to a day. Showing the placeholder instant instead would put a
  // confident wrong time in front of someone.
  if (!startTimeKnown) return `${weekday} ${date}, TBD`;

  const raw = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const upper = raw.toUpperCase();
  const pm = upper.includes("PM");
  const clock = upper.split("AM").join("").split("PM").join("").trim();

  return `${weekday} ${date}, ${clock}${pm ? "p" : "a"}`;
}
