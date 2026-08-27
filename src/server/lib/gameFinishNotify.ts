import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase-admin";
import { gameHref } from "@/lib/gameRoutes";
import type { ResolvedResultStrategy } from "@/lib/resultStrategy";
import { computeCompetitionLeaderboard } from "./competitionLeaderboard";
import { sendPushToUsers } from "./sendPushToUsers";
import { recordPushAttempt } from "./recordPushAttempt";

/**
 * The `game_results` category's ONE wire point (Push Phase 3).
 *
 * `games.finish` is now the only finalize for every format (the `games.post`
 * fork was merged away), so this hangs off one procedure and covers all four:
 * match, rack, stroke, and the non-golf manual arm. Two notifications come out
 * of it — "a game is final" and, when it becomes true, "the cup is clinched".
 *
 * ── What is NOT wired, and must never be ────────────────────────────────────
 * NOTIFICATIONS.md marks `scores.upsertEntry` / `deleteEntry` (~540/day),
 * pairing setup, and handicap/point-value tweaks as NEVER — permanent
 * properties of those events, not judgment calls. Nothing here touches them,
 * and `pushCallSites.guard.test.ts` fails the build if a NEVER site ever
 * imports a send helper. Volume discipline IS the product: three notification
 * kinds, ~10-30 events across a tournament day.
 *
 * ── Failure isolation ───────────────────────────────────────────────────────
 * Every function here swallows its own errors. A push failure must never roll
 * back a finished game — the same shape the Realtime cascade established, where
 * `realtime.send` swallows its errors and the trigger is defensive. The caller
 * awaits (rather than firing and forgetting) because un-awaited work can be
 * killed when a serverless function freezes, and a notification that races the
 * response is a notification that sometimes doesn't happen.
 */

// ── Copy ────────────────────────────────────────────────────────────────────
// All three notifications live here so they read as a set. Three rules they
// share, each of which cost something to learn:
//
//  1. THE BODY CARRIES THE RESULT. `games.finish` has the outcome in hand at
//     send time, so a body that says "tap to see how it finished" is spending
//     the most valuable line on the lock screen to state that notifications are
//     tappable. Everyone knows that. Those characters carry the score instead.
//  2. NO "Result posted". That is the exact phrasing for `scores.upsertEntry` —
//     a NEVER-marked site — so on a lock screen it reads as "someone entered a
//     score", which is precisely the notification we promise never to send.
//     Golf and non-golf are the SAME event to the person holding the phone:
//     a game finished. Both title as `Final: {game}`. The audiences differ; the
//     copy does not.
//  3. NO EMOJI. Titles get cut around 40-50 characters on Android and every
//     character spent on decoration is a character not spent on the result.

/** Points arrive in halves (tie-averaging), and "2.5" reads like a spreadsheet.
 *  Whole numbers stay bare; a lone half is "½", not "0½". */
export function formatPoints(n: number): string {
  const rounded = Math.round(n * 2) / 2;
  if (rounded !== n) return String(n); // not a half-step — show it honestly
  const whole = Math.trunc(rounded);
  const hasHalf = Math.abs(rounded - whole) === 0.5;
  if (!hasHalf) return String(whole);
  return whole === 0 ? "½" : `${whole}½`;
}

const ORDINALS = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th"];
function ordinal(position: number): string {
  return ORDINALS[position - 1] ?? `${position}th`;
}

/** One competitor's line in a finished game, name already resolved. */
export interface SummaryEntry {
  name: string;
  /** Points scored (match play, rack). Absent for pure placement formats. */
  points?: number | null;
  /** Finishing rank, 1 = best (manual placements, rack, stroke). */
  position?: number | null;
  /**
   * This competitor is more than one person — a 2v2 bracket pairing.
   *
   * Carried for VERB AGREEMENT alone ("Zach wins it" vs "Zach & Matt win it"),
   * which is why it is a field rather than something the formatter works out:
   * the only other way to know is to look for " & " inside the joined name, and
   * deriving grammar from someone's actual name is how that breaks.
   *
   * Absent everywhere else — a team and a user are each singular for these
   * purposes ("Manhattans wins it" is never printed; teams use the placement
   * shape, which has no verb).
   */
  multi?: boolean;
}

/** "A & B" for two, "A, B & C" for more. Serial comma omitted deliberately —
 *  this is a lock-screen line, not prose, and the ampersand already separates. */
function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
}

/**
 * AN ORDINAL IS NEVER REPEATED. "1st Centurions · 1st Manhattans" reads as a
 * mistake — two firsts look like a bug in the app, not a tie in the game. Tied
 * competitors therefore SHARE one ordinal slot rather than each printing their
 * own, and a tie that covers the whole field drops ordinals entirely because
 * "1st" is meaningless when nobody is behind it:
 *
 *   whole field, two   →  Tied: Centurions & Manhattans
 *   whole field, 3+    →  3-way tie: Centurions, Manhattans & Bootleggers
 *   partial tie        →  1st Centurions · 2nd Manhattans & Bootleggers
 *
 * The N-way form leads with the COUNT because that is the part still readable
 * when the name list gets cut — "3-way tie: Not Golfing, Just Vib…" still tells
 * you what happened, where a truncated bare list does not.
 */
function tieGroupLabel(names: string[], position: number, wholeField: boolean): string {
  if (names.length === 1) return `${ordinal(position)} ${names[0]}`;
  if (!wholeField) return `${ordinal(position)} ${joinNames(names)}`;
  return names.length === 2
    ? `Tied: ${joinNames(names)}`
    : `${names.length}-way tie: ${joinNames(names)}`;
}

/**
 * Group entries by finishing position, best first.
 *
 * Two ranking sources, because not every format writes a position: match play
 * stores team POINTS with a null position, so a drawn match is only detectable
 * as equal points. Grouping on the index instead would have made a 2–2 draw look
 * like two distinct places — which is exactly the "1st and 2nd on identical
 * scores" nonsense the tie handling exists to prevent.
 *
 * Where positions are absent, ranks are assigned competition-style (1, 1, 3):
 * a tied pair both hold 1st and the next competitor is 3rd, never 2nd.
 */
function rankGroups(entries: SummaryEntry[]): { position: number; entries: SummaryEntry[] }[] {
  const hasPositions = entries.every((e) => e.position != null);
  const ranked = [...entries].sort((x, y) => {
    if (hasPositions) return (x.position ?? 0) - (y.position ?? 0);
    return (y.points ?? 0) - (x.points ?? 0);
  });

  const groups: { position: number; entries: SummaryEntry[] }[] = [];
  let seen = 0;
  for (const e of ranked) {
    const last = groups[groups.length - 1];
    const tiedWithLast = last
      ? hasPositions
        ? last.entries[0].position === e.position
        : (last.entries[0].points ?? 0) === (e.points ?? 0)
      : false;
    if (last && tiedWithLast) last.entries.push(e);
    else groups.push({ position: hasPositions ? (e.position as number) : seen + 1, entries: [e] });
    seen += 1;
  }
  return groups;
}

/**
 * The result line that goes in the notification body, for TEAM-scoped formats
 * (match play, rack, non-golf). Stroke has its own shape — see below.
 *
 * Two shapes, built to read as siblings rather than as unrelated strings:
 *
 *   match play / rack →  Manhattans 2½ – Centurions 1½      (a score line)
 *   non-golf / 3+     →  1st Centurions · 2nd Manhattans    (a placement list)
 *
 * A head-to-head with exactly two sides and no tie gets the score line, because
 * that is how anyone would say it out loud. Everything else gets the placement
 * list, which scales past two — with points appended when the format has them.
 *
 * WHAT ACTUALLY REACHES the 3+-with-points branch: MATCH PLAY in a competition
 * with more than two teams (its team rows carry points and a null position).
 * NOT rack — rack is hard-capped at two teams by its own engine
 * (`computeRackNStackResults` slots only `teamIds[0]`/`[1]` and skips everyone
 * else), so it can never emit a third scored team. An earlier version of this
 * comment claimed "a 3-team rack still reports the margin", which was fiction;
 * see the rack issue filed alongside this, because that cap is not clean —
 * a third team still gets a `game_results` row written with undefined points.
 * Non-golf reaches the 3+ branch too, but WITHOUT points (its placements mirror
 * position into raw_score, which is stripped as not-a-real-score above).
 *
 * Returns "" when there is nothing worth saying; callers fall back to a body
 * that doesn't pretend to have a result.
 */
export function formatResultSummary(entries: SummaryEntry[]): string {
  const named = entries.filter((e) => e.name);
  if (named.length === 0) return "";

  const hasPoints = named.every((e) => typeof e.points === "number");
  const groups = rankGroups(named);
  const wholeFieldTied = groups.length === 1 && named.length > 1;

  // Head-to-head score line — two sides, both scored, genuinely separated. A
  // drawn match falls through to the tie form instead of printing "2 – 2",
  // which states the score but buries the outcome.
  if (hasPoints && named.length === 2 && !wholeFieldTied) {
    const [a, b] = [...named].sort((x, y) => (y.points ?? 0) - (x.points ?? 0));
    return `${a.name} ${formatPoints(a.points ?? 0)} – ${b.name} ${formatPoints(b.points ?? 0)}`;
  }

  return groups
    .map((g) => {
      const names = g.entries.map((e) => e.name);
      const label = tieGroupLabel(names, g.position, wholeFieldTied);
      // Points ride along only where they disambiguate — a tied group shares one
      // score, so it prints once rather than after every name.
      if (!hasPoints) return label;
      return `${label} ${formatPoints(g.entries[0].points ?? 0)}`;
    })
    .join(" · ");
}

/**
 * Stroke play: the top two, then a count of everyone else.
 *
 *   1st Zach Grether · 2nd BJ Dennison · +2
 *
 * A stroke field is the whole trip, not two sides — a full placement list would
 * be thirty names and would blow past any lock screen, so it is CAPPED. `+2`
 * says how many finished behind without naming them.
 *
 * ── DELIBERATE: this form does NOT express ties below first place ────────────
 * If 2nd and 3rd tie, one of them is shown as 2nd and the other is folded into
 * the `+N`. That is not an oversight and it is not worth "fixing": expressing a
 * mid-field tie would require either naming the tied group (re-expanding the
 * list this cap exists to bound) or an ordinal-skipping scheme that a
 * two-line notification has no room to explain. A tie for the LEAD is expressed,
 * because that is the part anyone reads the notification for. Anyone who wants
 * the full field taps through to the scorecard, which is exactly what the deep
 * link is for.
 */
export function formatStrokeSummary(entries: SummaryEntry[]): string {
  const named = entries.filter((e) => e.name);
  if (named.length === 0) return "";

  const groups = rankGroups(named);
  const shown: string[] = [];
  let accounted = 0;

  const lead = groups[0];
  const leadTied = lead.entries.length > 1;

  // A SHARED LEAD takes the whole headline: "Tied: A & B", then the count. The
  // runner-up slot is dropped in that case — when the lead is tied, who came
  // next is not the story, and naming them would push the line past a glance.
  shown.push(tieGroupLabel(lead.entries.map((e) => e.name), lead.position, leadTied));
  accounted += lead.entries.length;

  // Runner-up: ONE name only, and only when the lead is outright. See the note
  // above — a tie at this level is deliberately not expressed.
  if (!leadTied && groups[1]) {
    shown.push(`${ordinal(groups[1].position)} ${groups[1].entries[0].name}`);
    accounted += 1;
  }

  const rest = named.length - accounted;
  if (rest > 0) shown.push(`+${rest}`);
  return shown.join(" · ");
}

/**
 * A bracket: the winner, and the runner-up it beat.
 *
 *   Zach Grether & BJ Dennison win it, over Marcus Thornton & Jeremy Maddox
 *   Zach Grether wins it, over BJ Dennison
 *
 * ── Why the WINNER and not a scoreline (#930) ───────────────────────────────
 * Every other format's summary is a COMPARISON because every other format
 * produces one — match play has a tally, stroke has totals, a manual placement
 * game has an entered order over the teams that played it. A bracket produces a
 * CHAMPION, and the ranking underneath is a by-product of the tree (elimination
 * round IS the ranking, #916) rather than something anyone watched happen.
 * Listing four entrants in placement order reports the shape of the draw, not
 * the result.
 *
 * Two more reasons, either of which would have pointed the same way alone:
 *
 *  - The team roll-up genuinely ISN'T THERE to report. For a bracket it is not
 *    in `game_results` at all — it is derived at read time by
 *    `computeCompetitionLeaderboard`. Printing "Manhattans 5 – Centurions 3"
 *    here would mean calling the leaderboard from the notification path or
 *    duplicating the roll-up, and the second is precisely what the finalize
 *    slice spent its effort avoiding. A rule that makes the wrong answer
 *    expensive to write is worth noticing.
 *  - Cup movement ALREADY HAS a push. The clinch notification exists to say what
 *    a result did to the standings; a game push that also editorialised about
 *    the cup would be two voices on one question.
 *
 * ── The runner-up earns its place; nothing below 2nd does ───────────────────
 * The final is the one comparison a bracket really does produce, and it is what
 * anyone who missed it asks next. Everything below 2nd is a TIE GROUP — the semi
 * losers share 3rd unless a consolation match separated them — so listing it
 * would print ties the game never played out.
 *
 * ── Voice ──────────────────────────────────────────────────────────────────
 * This is the one summary that is a sentence rather than the label-value form
 * its siblings use, and that is deliberate rather than drift: those formats
 * report a comparison, so they read as one. A bracket has a single story, so it
 * gets a single clause. The verb agrees with the entrant (`multi`), because
 * "Zach & Matt wins it" is the kind of error that makes an app look broken.
 *
 * Returns "" when there is no winner — callers fall back to a body that does not
 * pretend to have a result.
 */
export function formatBracketSummary(entries: SummaryEntry[]): string {
  const named = entries.filter((e) => e.name);
  if (named.length === 0) return "";

  const groups = rankGroups(named);
  const lead = groups[0];
  if (!lead) return "";

  // A bracket's final has exactly one winner, so a tied lead is not a state the
  // tree can produce. Handled rather than asserted: a shared first place falls
  // back to the shape the rest of the file uses for one, and drops the
  // runner-up, because "over" makes no sense when the top is unresolved.
  if (lead.entries.length > 1) {
    return tieGroupLabel(lead.entries.map((e) => e.name), lead.position, groups.length === 1);
  }

  const winner = lead.entries[0];
  const verb = winner.multi ? "win" : "wins";
  const runnerUp = groups[1]?.entries.length === 1 ? groups[1].entries[0] : null;
  return runnerUp
    ? `${winner.name} ${verb} it, over ${runnerUp.name}`
    : `${winner.name} ${verb} it`;
}

/**
 * The clinch margin: bare totals, top two, no names.
 *
 * Names are deliberately omitted here even though the game summary includes
 * them — the title already says who clinched, so repeating it in the body spends
 * a second copy of the longest word in the notification to say nothing new. The
 * line exists to answer "by how much", and `25½ – 20½` answers it.
 */
export function formatClinchMargin(totals: number[]): string {
  const top = [...totals].sort((a, b) => b - a).slice(0, 2);
  if (top.length < 2) return "";
  return `${formatPoints(top[0])} – ${formatPoints(top[1])}`;
}

const COPY = {
  /**
   * EVERY format — golf and non-golf alike. One event ("a game finished"), one
   * shape of copy. `summary` is the result line; when it's empty (a finalize
   * with nothing to report) the body says so plainly rather than inventing one.
   */
  gameFinal: (gameName: string | null, summary: string) => ({
    title: gameName ? `Final: ${gameName}` : "A game is final",
    body: summary || "Results are in.",
  }),
  /** The highest-value push in the app — ~1-3 per trip. */
  clinched: (teamName: string, competitionName: string | null, summary: string) => ({
    title: `${teamName} clinched`,
    body: [competitionName, summary].filter(Boolean).join(" · ") || "The cup is decided.",
  }),
};

/**
 * Deep links, verified against CURRENT routing (the shell has been restructured
 * repeatedly, and a push URL is the one link you cannot fix after it ships).
 *
 * A competition game opens as a PANEL over the persistent board: `?view=cup` is
 * REQUIRED alongside `?game=` — a bare `?game=` falls back to the Trip tab and
 * hides the very panel it opened (the bug documented in `GameRow.tsx`).
 * `useCupPanel` explicitly supports a cold `?game=` deep link.
 *
 * A standalone game (no competition — ~40% of games in production) has no board
 * to panel over, so it routes to its own page via the shared `gameHref` builder.
 *
 * `/trips/{id}/leaderboard` is deliberately NOT used: it is a client-side alias
 * that `router.replace`s to `?view=cup`, costing an extra hop and an extra
 * fetch. The canonical form is the one that goes on someone's phone.
 */
function gameUrl(
  tripId: string,
  gameId: string,
  gameTypeId: string | null,
  competitionId: string | null
): string {
  if (competitionId) return `/trips/${tripId}?view=cup&game=${gameId}`;
  return gameHref(tripId, gameTypeId, gameId) ?? `/trips/${tripId}?view=cup`;
}

function cupUrl(tripId: string): string {
  return `/trips/${tripId}?view=cup`;
}

/**
 * ── The per-format notification registry (#930) ─────────────────────────────
 *
 * Every question this file asks about a format, asked ONCE, of one value.
 *
 * It replaces two booleans (`isManual` / `isStroke`) and the `isStroke ? "user"
 * : "team"` fork they drove. That fork was a two-format answer to a
 * four-competitor question, and the bracket is what it could not answer: a
 * bracket's rows are `entity_type = 'entrant'` (migration 119), so the query
 * matched nothing, the summary came back empty, and the push went out saying
 * "Results are in." for a game that had just produced a champion. Nothing
 * errored — the format simply inherited `"team"` because nothing ever ASKED it,
 * which is the shape `FORMAT_SURFACE` exists for.
 *
 * `satisfies Record<NotifyFormatKey, NotifySurface>` is what makes that
 * impossible to repeat: a fifth strategy does not compile until it answers all
 * three fields, and none of them is optional — an optional field is a question a
 * new format can decline to answer.
 *
 * Two booleans derived from one value is also how they drift (#24): they were
 * computed at the call site as `strategy === null || strategy === "bracket"` and
 * `strategy === "stroke_total"`, which is this table, spelled twice, one of them
 * in another file.
 */
type NotifyFormatKey = "stroke_total" | "match_play" | "rack_n_stack" | "bracket" | "manual" | "pickem";

interface NotifySurface {
  /**
   * Whose news is it?
   *
   * `participants` — ENGINE formats. They played it; the result is their news.
   * ~4-8 people, so a person gets ~1-2 of these on a tournament day rather than
   * one per game on the board. Cup-wide news is what the clinch push is for, and
   * the board itself is already live via the score-event broadcast.
   *
   * `competition` — the cup's assigned members. Non-golf side events and
   * brackets are team-scoped and have NO `game_participants` roster (a bracket's
   * competitors live in `bracket_entrants`), so "the game's participants" is not
   * a resolvable audience — it would resolve to nobody and the push would reach
   * no one. They are also rare (~1-5 per trip), so the wider audience is cheap.
   */
  audience: "participants" | "competition";
  /** Which `game_results` rows ARE the competitors, by `entity_type`. */
  competitor: "user" | "team" | "entrant";
  /** Which summary shape reads the resulting entries. */
  summary: "stroke" | "placement" | "bracket";
}

const NOTIFY_SURFACE = {
  stroke_total: { audience: "participants", competitor: "user", summary: "stroke" },
  // Match play writes BOTH per-side rows and team totals; `competitor: "team"`
  // is what keeps a 4-match game from reporting eight competitors.
  match_play: { audience: "participants", competitor: "team", summary: "placement" },
  rack_n_stack: { audience: "participants", competitor: "team", summary: "placement" },
  manual: { audience: "competition", competitor: "team", summary: "placement" },
  bracket: { audience: "competition", competitor: "entrant", summary: "bracket" },
  // Pick'em. Declared because the registry demands an answer from every
  // strategy, and NOT YET EXERCISED: `games.finish` refuses "pickem" through
  // its exhaustive else until the engine lands (Phase 6), so nothing reaches
  // this row today. The answers mirror match play, which is the closest
  // analogue — a real roster of people who played it (`participants`), team
  // rows as the competitors so an eight-match game does not report sixteen of
  // them, and a placement-shaped summary. Revisit when the engine writes its
  // first `game_results`, rather than assuming this was validated by shipping.
  pickem: { audience: "participants", competitor: "team", summary: "placement" },
} as const satisfies Record<NotifyFormatKey, NotifySurface>;

/** The registry key for a resolved strategy. `null` is a real answer (manual,
 *  entered by hand) rather than an absence, so it gets a name rather than a
 *  fallback — see `resolveResultStrategy`. */
export function notifySurfaceFor(strategy: ResolvedResultStrategy): NotifySurface {
  return NOTIFY_SURFACE[strategy ?? "manual"];
}

/**
 * Who hears about a finished game — see `NotifySurface.audience` for the split
 * and its reasoning.
 *
 * Guests (`users.is_guest`) need no special handling: a placeholder has no
 * account and therefore no push subscription, so it falls out at the device read.
 */
async function resolveAudience(
  admin: SupabaseClient,
  gameId: string,
  competitionId: string | null,
  audience: NotifySurface["audience"]
): Promise<string[]> {
  if (audience === "competition" && competitionId) {
    const { data } = await admin
      .from("team_assignments")
      .select("user_id")
      .eq("competition_id", competitionId);
    const ids = (data ?? []).map((r: { user_id: string }) => r.user_id);
    if (ids.length > 0) return ids;
    // Fall through: a cup-scoped game whose competition has no assignments yet.
  }
  const { data } = await admin
    .from("game_participants")
    .select("user_id")
    .eq("game_id", gameId);
  return (data ?? []).map((r: { user_id: string }) => r.user_id);
}

/**
 * What each ENTRANT id is called, for a bracket.
 *
 * An entrant is one person or a pair, so the display name is assembled from its
 * MEMBERS rather than read off a row — `bracket_entrants` carries a seed and a
 * team, not a name (migration 112). Two plain reads and a JS join, matching
 * `readBracketDraw`'s reasoning: `bracket_entrant_members` is reachable by an
 * ordinary select, and an embed that silently returns nothing is the shape of
 * #16's landmine.
 *
 * Ordered by `user_id` within an entrant — the SAME order `games.bracketPool`
 * uses, so the pair reads the same way in the notification as it does on the
 * board. Arbitrary, but arbitrary once.
 *
 * `multi` rides back because it decides a VERB ("wins it" vs "win it") and
 * cannot be recovered from the joined string without parsing it — deriving
 * grammar by looking for " & " in a name is the kind of thing that breaks on
 * someone's actual name.
 */
async function loadEntrantNames(
  admin: SupabaseClient,
  entrantIds: string[]
): Promise<Map<string, { name: string; multi: boolean }>> {
  const out = new Map<string, { name: string; multi: boolean }>();
  if (entrantIds.length === 0) return out;

  const { data: members } = await admin
    .from("bracket_entrant_members")
    .select("entrant_id, user_id")
    .in("entrant_id", entrantIds)
    .order("user_id", { ascending: true });
  if (!members || members.length === 0) return out;

  const userIds = [...new Set((members as { user_id: string }[]).map((m) => m.user_id))];
  const { data: people } = await admin.from("users").select("id, name").in("id", userIds);
  const nameByUser = new Map<string, string>(
    (people ?? []).map((p: { id: string; name: string | null }) => [p.id, p.name ?? ""])
  );

  const byEntrant = new Map<string, string[]>();
  for (const m of members as { entrant_id: string; user_id: string }[]) {
    const name = nameByUser.get(m.user_id);
    if (!name) continue;
    byEntrant.set(m.entrant_id, [...(byEntrant.get(m.entrant_id) ?? []), name]);
  }
  for (const [entrantId, names] of byEntrant) {
    out.set(entrantId, { name: joinNames(names), multi: names.length > 1 });
  }
  return out;
}

/**
 * Load the finished game's result rows and resolve display names.
 *
 * ONE read path for every format, because `game_results` is already the shared
 * spine — the roll-up "never distinguishes computed from entered", and neither
 * does this. What differs per format is only which rows are the competitors, and
 * that question is answered by `NOTIFY_SURFACE` rather than here.
 *
 * Returns [] on any failure — a notification without a result line is a minor
 * loss; a throw here would surface on a game that genuinely finished.
 *
 * EXPORTED FOR TESTS, and for the same reason the formatters are: this is the
 * half that talks to the database, and its failure mode is a query that matches
 * nothing and says so by returning an empty summary. That is exactly what #930
 * was, and it is invisible from the outside — the push still sends, the game
 * still finalizes, the body just quietly says "Results are in." A pure test
 * cannot see it, so the read gets a runtime one (CLAUDE.md #23's rule, applied
 * to our own contract rather than a library's).
 */
export async function loadSummaryEntries(
  admin: SupabaseClient,
  gameId: string,
  surface: NotifySurface
): Promise<SummaryEntry[]> {
  try {
    const { data: rows } = await admin
      .from("game_results")
      .select("entity_id, raw_score, position")
      .eq("game_id", gameId)
      .eq("entity_type", surface.competitor);
    if (!rows || rows.length === 0) return [];

    const ids = rows.map((r: { entity_id: string }) => r.entity_id);
    // An entrant's name is assembled from its members; a user's and a team's is
    // a column. Same shape out either way.
    const metaById =
      surface.competitor === "entrant"
        ? await loadEntrantNames(admin, ids)
        : new Map(
            ((
              await admin
                .from(surface.competitor === "user" ? "users" : "teams")
                .select("id, name")
                .in("id", ids)
            ).data ?? []).map((n: { id: string; name: string | null }) => [
              n.id,
              { name: n.name ?? "", multi: false },
            ])
          );

    return rows
      .map((r: { entity_id: string; raw_score: number | null; position: number | null }) => ({
        name: metaById.get(r.entity_id)?.name ?? "",
        multi: metaById.get(r.entity_id)?.multi ?? false,
        // A manual placement mirrors position into raw_score, which would read
        // as "points" and print "1st Centurions 1" — nonsense. Points are real
        // only where the format actually awards them (match play, rack). A
        // bracket's rows mirror the same way, so this covers them too.
        points: r.position != null && r.raw_score === r.position ? null : r.raw_score,
        position: r.position,
      }))
      .filter((e) => e.name);
  } catch {
    return [];
  }
}

export interface NotifyGameFinishedInput {
  tripId: string;
  gameId: string;
  gameName: string | null;
  gameTypeId: string | null;
  competitionId: string | null;
  /**
   * The engine that finalized this game, as `games.finish` resolved it.
   *
   * ONE value, not the two booleans this replaces (`isManual` / `isStroke`).
   * Those were computed at the call site as `strategy === null || strategy ===
   * "bracket"` and `strategy === "stroke_total"` — i.e. `NOTIFY_SURFACE`,
   * spelled twice, in another file. Two booleans that must always agree is how
   * they drift (#24), and it is also what made the bracket's empty summary
   * possible: the format had no way to answer a question nobody asked it.
   */
  strategy: ResolvedResultStrategy;
  /** The user who finalized. Never notified about their own action. */
  actorUserId: string;
  /** Injectable for tests; defaults to the service-role admin client. */
  admin?: SupabaseClient;
}

/**
 * Fire the "game is final" push, then check whether that finalize decided the
 * cup. Never throws.
 *
 * IDEMPOTENCE is the caller's job for the game push: `finish` is deliberately
 * re-runnable (a correction cycle is openCorrection → edit → finish again, and
 * at BBMI both golf formats in play have that wired, so it is a real sequence
 * rather than a hypothetical), so the caller only invokes this on the
 * pending/active → complete TRANSITION. A re-finish of an already-complete game
 * notifies nobody. The clinch half carries its own separate guard, below,
 * because it can become true on a finalize that is not itself a transition.
 */
export async function notifyGameFinished(input: NotifyGameFinishedInput): Promise<void> {
  try {
    const admin = input.admin ?? createAdminClient();

    // Every per-format question, asked once, of one value.
    const surface = notifySurfaceFor(input.strategy);

    const audience = await resolveAudience(
      admin,
      input.gameId,
      input.competitionId,
      surface.audience
    );

    const entries = await loadSummaryEntries(admin, input.gameId, surface);
    // Stroke's field is the whole trip, so it gets the capped form; a bracket
    // has one champion, so it gets the sentence; everything else is team-scoped
    // and small enough to list in full.
    const summary =
      surface.summary === "stroke"
        ? formatStrokeSummary(entries)
        : surface.summary === "bracket"
          ? formatBracketSummary(entries)
          : formatResultSummary(entries);

    await sendPushToUsers(audience, "game_results", {
      ...COPY.gameFinal(input.gameName, summary),
      url: gameUrl(input.tripId, input.gameId, input.gameTypeId, input.competitionId),
      // Coalesce per game: a correction → re-finish replaces the earlier notice
      // on the device instead of stacking a second one next to it.
      tag: `bt-game-${input.gameId}`,
    }, {
      excludeUserId: input.actorUserId,
      context: {
        trigger: "game_finished",
        tripId: input.tripId,
        gameId: input.gameId,
        competitionId: input.competitionId,
        actorUserId: input.actorUserId,
      },
    });
  } catch (err) {
    console.error("[notifyGameFinished] failed", { gameId: input.gameId, err });
  }
}

/**
 * Atomically claim the right to announce `teamId` as the clincher. Returns true
 * exactly once per (competition, team) — the caller sends only when it wins.
 *
 * Exported so the PostgREST filter below can be tested against a REAL database
 * rather than a stub, because a stub would happily accept a filter that means
 * something else. `.or(is.null, neq)` is how PostgREST expresses SQL's
 * `IS DISTINCT FROM`: `.not("col","is",value)` only accepts null/true/false, and
 * a bare `.neq()` would match NOTHING while the column is still NULL — which is
 * the state EVERY first clinch starts in. That failure mode is silent and points
 * the wrong way: the highest-value push in the app simply never sends.
 *
 * `.select()` is required — without it Supabase reports no affected rows and the
 * claim would always read as lost.
 *
 * ── Why this returns a RESULT and not a boolean ──────────────────────────────
 * It used to return `!error && !!data && data.length > 0`. That single `false`
 * collapsed three different events — the update ERRORED, the update matched
 * zero rows because the claim genuinely holds this team, and the update matched
 * zero rows for no reason we can name — and it DISCARDED `error` entirely. The
 * caller then printed "already_claimed" over all three, which is a confident
 * label on top of an unverified state (CLAUDE.md #16: the error is consulted and
 * then thrown away, so a real failure and a correct no-op are the same value).
 *
 * That is not hypothetical. In production this write has succeeded ZERO times
 * across 41 competitions, while passing in every local test — and each failure
 * was recorded as "already claimed" on a competition whose claim column was
 * null. The message and code this now returns are the only things that can say
 * what the PostgREST layer is actually refusing.
 */
export type ClinchClaimResult =
  /** The claim is ours; the caller sends. */
  | { outcome: "claimed" }
  /** VERIFIED suppression — the column really does hold this team. */
  | { outcome: "already_claimed"; heldBy: string }
  /** PostgREST refused the write. The message/code are the diagnosis. */
  | { outcome: "claim_error"; message: string; code: string | null }
  /** Zero rows, no error, and the column does NOT hold this team — so the
   *  filter should have matched and didn't. The unexplained case; before this
   *  split it was indistinguishable from `already_claimed`. */
  | { outcome: "claim_no_row"; heldNow: string | null };

export async function claimClinchNotification(
  admin: SupabaseClient,
  competitionId: string,
  teamId: string
): Promise<ClinchClaimResult> {
  // Migration 107. The CAS is ONE SQL statement whose WHERE sees the PRE-image.
  //
  // It used to carry its predicate as a PostgREST `or=(…)` filter on the
  // mutation, which cannot work: on the deployed PostgREST that filter is
  // applied in the scope of the RETURNING projection, so after
  // `SET clinch_notified_team_id = teamId` the row no longer satisfies
  // `IS NULL OR <> teamId` and the projection excludes the row it just wrote.
  // The write landed and reported itself lost — the caller read "already
  // claimed" and sent nothing. (With the column absent from the select it was
  // louder and easier: 42703 naming a column that plainly exists.)
  //
  // A compare-and-swap is falsified BY THE WRITE IT GUARDS, so no arrangement
  // of select and filter expresses one. Do NOT move this back into a filter.
  const { data, error } = await admin.rpc("claim_clinch_notification", {
    p_competition_id: competitionId,
    p_team_id: teamId,
  });

  if (error) {
    return {
      outcome: "claim_error",
      message: error.message,
      // The field that names the class of failure (42501 permission, PGRST202
      // function-not-found, …) and is exactly what a bare `false` could not say.
      code: (error as { code?: string }).code ?? null,
    };
  }
  if (data === true) return { outcome: "claimed" };

  // The function returned false: it updated no row. The only legitimate reading
  // is that the column already holds this team — the one state the WHERE
  // excludes. CONFIRM that rather than assume it, with a fresh read, because
  // false ALSO covers a competition id that matches nothing. The value observed
  // at the start of the pass cannot decide it: a concurrent claim between that
  // read and this write is the precise race the CAS exists for, so it is stale
  // by construction.
  const { data: now } = await admin
    .from("competitions")
    .select("clinch_notified_team_id")
    .eq("id", competitionId)
    .maybeSingle();
  const heldNow = (now?.clinch_notified_team_id as string | null) ?? null;

  return heldNow === teamId
    ? { outcome: "already_claimed", heldBy: heldNow }
    : { outcome: "claim_no_row", heldNow };
}

/**
 * Give the claim back when the cup is no longer decided, so a LATER re-clinch by
 * the SAME team can announce itself.
 *
 * ── The gap this closes ──────────────────────────────────────────────────────
 * The column only ever moved null → team. "Un-clinched" was not a state it could
 * express. So: a cup clinches and the push fires; a score correction un-clinches
 * it; the same team re-clinches — and the push is silently suppressed, because
 * the claim still names that team. The crew never learns the cup was decided.
 *
 * The product rule is unchanged and still right: the same team re-clinching
 * WITHOUT an intervening un-clinch is not news, and stays suppressed. What
 * changes is that an intervening un-clinch is now recorded, by releasing the
 * claim at the moment a recompute observes no clincher.
 *
 * ── COMPARE-AND-SWAP, not a blind clear ──────────────────────────────────────
 * `expectedTeamId` is the value observed in the SAME pass that computed "nobody
 * has clinched", and the update only lands if the column still holds exactly
 * that. This is what keeps migration 099's exactly-once property intact.
 *
 * Without it: request A recomputes and sees no clincher; concurrently request B
 * recomputes, sees clincher T, claims it and pushes; A's blind clear then wipes
 * B's claim, and the next finalize that still sees T pushes a SECOND time for
 * one clinch. The CAS makes A's clear fail instead — A's view of the world is
 * stale, and the row says so.
 *
 * A plain `=` is correct here (unlike the claim's `IS DISTINCT FROM`) precisely
 * BECAUSE the caller only invokes this with a non-null observed value: there is
 * nothing to release when the column is already null.
 *
 * ── Why this moved to SQL too (migration 107) ────────────────────────────────
 * It SETS the column it FILTERS on, which is the same shape that broke the
 * claim: if the filter is applied to the post-update projection, the row is
 * null by then, the `eq` no longer matches, and every SUCCESSFUL release
 * reports `false`. Its `.eq()` form never raised 42703, which made it look
 * unaffected — but that was never established: the probe that "cleared" it used
 * an id matching nothing, where zero rows is the right answer either way. It
 * tested error-vs-no-error, not row-return semantics. Rather than reason about
 * filter placement per operator, both halves now sit where the semantics are
 * unambiguous.
 */
export async function releaseClinchClaim(
  admin: SupabaseClient,
  competitionId: string,
  expectedTeamId: string
): Promise<boolean> {
  const { data, error } = await admin.rpc("release_clinch_claim", {
    p_competition_id: competitionId,
    p_expected_team_id: expectedTeamId,
  });
  return !error && data === true;
}

/**
 * The ONE definition of "decided" — a team's own `pointsToClinch` entry at or
 * below zero. Shared by the finalize path and the reconcile path below so the
 * two can never disagree about what a clinch is. `?? 1` is the same "absent
 * means not decided" default `rollUp` implies for a team with no entry.
 */
function isDecided(toClinch: Record<string, number>, teamId: string): boolean {
  return (toClinch[teamId] ?? 1) <= 0;
}

/**
 * Recompute whether the cup is STILL decided the way its held claim says, and
 * release the claim if it is not — so a later finalize can announce correctly
 * instead of being silently suppressed by a stale claim.
 *
 * ── Why this exists, distinct from `notifyCupClinchedIfDecided` ─────────────
 * That function has exactly ONE caller: `games.finish`. #839 releases the claim
 * there when a recompute finds no clincher — which fixes the reported bug
 * (clinch → correction → re-finish → same team re-clinches) because a
 * correction cycle always ENDS in a finalize.
 *
 * It does NOT fix the same sequence when something OTHER than a finalize does
 * the un-clinching: `games.delete`, a config edit that changes a point value,
 * `teams.delete`, or either reset primitive (game- or competition-scoped) can
 * all move the standings, and none of them call `finish`. This is the shared
 * call for THOSE paths.
 *
 * ── What it deliberately does NOT do ─────────────────────────────────────────
 * It never CLAIMS. If the recompute shows the cup newly decided — including by
 * a DIFFERENT team than the one currently held — this function leaves the claim
 * exactly as it is and sends nothing. Building the announce-a-fresh-clinch half
 * for these paths is a separate, larger gap (a delete lowering the threshold can
 * CREATE a clinch, not just remove one) that stays unaddressed here; conflating
 * "release a stale claim" with "detect and push a new one" is how a small,
 * boring fix turns into a second copy of `notifyCupClinchedIfDecided` with its
 * own drift risk.
 *
 * ── The compare-and-swap is REUSED, not reimplemented ────────────────────────
 * This calls `releaseClinchClaim` — the same CAS `notifyCupClinchedIfDecided`
 * uses — so every call site sharing this function gets the same
 * concurrent-set-vs-clear safety for free. No call site (delete, reset, a
 * points edit) implements its own clear.
 *
 * ── Why "recompute-then-decide", not an unconditional clear ─────────────────
 * A blind `SET null` after, say, `games.delete` would be WRONG whenever the
 * deleted game wasn't the one that decided the cup: the held team is often
 * STILL clinched after an unrelated game disappears, and clearing anyway would
 * make a later, unconnected finalize re-announce a clinch that never actually
 * changed. Gating on a fresh recompute of the HELD team specifically (not "is
 * anyone decided") avoids that: release only when the team the claim NAMES is
 * no longer the (or a) clincher — whether because nobody is decided now, or
 * because a different team has taken the lead.
 *
 * ── Cost ──────────────────────────────────────────────────────────────────
 * One `computeCompetitionLeaderboard` call (measured ~10ms locally) plus a PK
 * read, only on paths that are rare, deliberate admin actions — never on score
 * entry or the leaderboard's own read path.
 *
 * ── The client defaults to service-role, same reason as the claim itself ────
 * `competitions_update` requires trip Owner/Organizer, but several of this
 * function's callers (`setPointsDistribution` via `requireGameEdit`, a
 * per-game reset's completing organizer) can be satisfied by a plain trip
 * Member holding only a game-delegate grant. Through the caller's own client
 * the release would fail SILENTLY for exactly that actor — the same failure
 * mode #839 built the claim's admin-client default to avoid. Defaulting here
 * too means no call site has to get this right on its own; `admin` is
 * exposed only for tests to inject a client bound to a known role.
 */
export async function reconcileClinchClaim(
  competitionId: string,
  admin?: SupabaseClient
): Promise<void> {
  const client = admin ?? createAdminClient();
  try {
    const [board, claimRow] = await Promise.all([
      computeCompetitionLeaderboard(client, competitionId),
      client
        .from("competitions")
        .select("clinch_notified_team_id")
        .eq("id", competitionId)
        .maybeSingle(),
    ]);
    const held = (claimRow.data?.clinch_notified_team_id as string | null) ?? null;
    if (!held) return; // nothing held — nothing to reconcile

    const toClinch = (board.pointsToClinch ?? {}) as Record<string, number>;
    if (isDecided(toClinch, held)) return; // the held team is still the clincher — leave it

    await releaseClinchClaim(client, competitionId, held);
  } catch (err) {
    console.error("[reconcileClinchClaim] failed", { competitionId, err });
  }
}

export interface NotifyCupClinchedInput {
  tripId: string;
  competitionId: string;
  actorUserId: string;
  admin?: SupabaseClient;
}

/**
 * Send the clinch push if — and only if — the cup is now decided AND we have not
 * already announced that team.
 *
 * Clinch is DERIVED, never stored: `computeCompetitionLeaderboard` returns
 * `pointsToClinch`, and `<= 0` means clinched. That predicate is duplicated
 * nowhere — it is the same `(pointsToClinch[t.id] ?? 1) <= 0` the board pill and
 * `GamePageHeader` already use, so the notification and the UI cannot disagree
 * about whether the cup is decided.
 *
 * Exactly-once comes from the CONDITIONAL claim (migration 099): the UPDATE only
 * matches when `clinch_notified_team_id IS DISTINCT FROM` the clincher, so two
 * clients finishing two different games concurrently race for one row and
 * exactly one sends. `IS DISTINCT FROM` rather than `<>` is what makes a NULL
 * current value read as "unclaimed" instead of matching nothing.
 *
 * The claim is written with the SERVICE-ROLE client and this is load-bearing:
 * `competitions_update` requires trip Owner/Organizer, but a game delegate who
 * is a plain trip Member can finalize a game. Through the caller's client the
 * claim would fail SILENTLY for exactly the person most likely to be finishing
 * the deciding game on-site.
 */
/**
 * Record a clinch attempt that ended BEFORE the sender.
 *
 * The send path records itself from inside `sendPushToUsers` (#842), which works
 * because it always reaches the recorder. The clinch check's three pre-send
 * exits never do — so without this they produce no row at all, and
 * `no_clincher`, `already_claimed` and `threw` are indistinguishable from a call
 * that never ran. That ambiguity is what made a re-finalize read as "the
 * transition guard is suppressing the clinch check".
 *
 * All counters are zero because nothing was addressed: the `outcome` is the
 * whole payload here, which is why migration 106 adds it as its own column
 * rather than trying to encode intent in arithmetic.
 */
async function recordClinchOutcome(
  admin: SupabaseClient,
  input: NotifyCupClinchedInput,
  // Mirrors the exits one-for-one. `claim_error` and `claim_no_row` arrived with
  // the discriminated claim result (#846): before it, both were reported as
  // `already_claimed`, so a REFUSED write recorded itself as correct
  // suppression. Recording them under that label would have re-created the lie
  // in the durable table, which is the one place it would outlive the logs.
  outcome: "no_clincher" | "already_claimed" | "claim_error" | "claim_no_row" | "threw",
  error?: string
): Promise<void> {
  await recordPushAttempt(
    admin,
    {
      trigger: "cup_clinched",
      tripId: input.tripId,
      competitionId: input.competitionId,
      actorUserId: input.actorUserId,
    },
    {
      typeKey: "game_results",
      recipients: 0,
      skippedPreferenceOff: 0,
      subscriptionsFound: 0,
      sent: 0,
      failed: 0,
      removedDead: 0,
      notConfigured: false,
      outcome,
      error: error ?? null,
    }
  );
}

export async function notifyCupClinchedIfDecided(
  input: NotifyCupClinchedInput
): Promise<void> {
  // ── ENTRY LOG ───────────────────────────────────────────────────────────────
  // This line exists because its ABSENCE was mistaken for evidence.
  //
  // A re-finalize produced no push_send_log row and no push, and that was read
  // as "the transition guard is suppressing the clinch check". It isn't — the
  // guard wraps `notifyGameFinished` only, and this call is a separate statement.
  // But nothing could prove that from the record, because this function emitted
  // NOTHING until it reached the sender, and all three of its early exits are
  // silent. A suppressed call and a running-but-undetecting one looked identical.
  //
  // So: one line at entry, before anything can fail or return. If this appears
  // and no outcome line follows, the function threw. If it doesn't appear at all,
  // the call genuinely wasn't reached — and that is then a fact rather than an
  // inference from an adjacent row's position.
  console.info("[push] clinch check: entry", {
    competitionId: input.competitionId,
    tripId: input.tripId,
    actorUserId: input.actorUserId,
  });
  try {
    const admin = input.admin ?? createAdminClient();

    // The claim is read in the SAME pass as the recompute, and in parallel with
    // it (a PK lookup, so it adds no measurable latency). Reading it here rather
    // than at release time is what makes the release a compare-and-swap against
    // the state this decision was actually made on.
    const [board, claimRow] = await Promise.all([
      computeCompetitionLeaderboard(admin, input.competitionId),
      admin
        .from("competitions")
        .select("clinch_notified_team_id")
        .eq("id", input.competitionId)
        .maybeSingle(),
    ]);
    const heldClaim = (claimRow.data?.clinch_notified_team_id as string | null) ?? null;

    const teams = (board.teams ?? []) as { id: string; name: string | null }[];
    const toClinch = (board.pointsToClinch ?? {}) as Record<string, number>;
    // Pure substitution for the inline `(board.pointsToClinch?.[t.id] ?? 1) <= 0`
    // this replaced — same expression, now shared with `reconcileClinchClaim` via
    // `isDecided` so the two paths can't drift on what "decided" means. Behaviour
    // unchanged; #839's tests pin this path's outcomes, not the literal line.
    const clincher = teams.find((t) => isDecided(toClinch, t.id)) ?? null;
    if (!clincher) {
      // OUTCOME: no_clincher. The exit under investigation — the board says the
      // cup is decided and this says it isn't. The numbers go in the line so the
      // disagreement is diagnosable from one log entry instead of a repro: if
      // `winNumber` and the leader's `pointsToClinch` are here, the arithmetic
      // this decision was made on is visible, not reconstructed.
      console.info("[push] clinch check: no_clincher", {
        competitionId: input.competitionId,
        teamsOnPayload: teams.length,
        pointsAvailable: board.pointsAvailable,
        winNumber: board.winNumber,
        // Ids and numbers only — this is standings arithmetic, not content.
        pointsToClinch: teams.map((t) => ({ teamId: t.id, toClinch: toClinch[t.id] ?? null })),
        heldClaim,
      });
      await recordClinchOutcome(admin, input, "no_clincher");
      // Nobody has clinched. If we were still holding an announcement for a team
      // that is no longer decided, give it back — otherwise that team re-clinching
      // later would be suppressed as "already announced" and go unreported.
      // Releasing sends NOTHING; it only restores eligibility.
      if (heldClaim) await releaseClinchClaim(admin, input.competitionId, heldClaim);
      return;
    }

    const claim = await claimClinchNotification(admin, input.competitionId, clincher.id);

    if (claim.outcome === "already_claimed") {
      // CORRECT suppression — one push per clinch, not one per finalize. Logged
      // precisely because it is correct: without it, working suppression and
      // broken detection are the same silence.
      //
      // This branch now requires the column to ACTUALLY hold this team. It used
      // to be the default for any falsy return, which is how a failing write
      // spent six weeks reporting itself as correct behaviour.
      console.info("[push] clinch check: already_claimed", {
        competitionId: input.competitionId,
        clincherTeamId: clincher.id,
        heldBy: claim.heldBy,
        heldClaimAtPassStart: heldClaim,
      });
      await recordClinchOutcome(admin, input, "already_claimed");
      return;
    }

    if (claim.outcome === "claim_error") {
      // The write was REFUSED. Not a no-op, not suppression — a failure, and the
      // first time this path can say so. `console.error` deliberately: this is
      // the line that should page someone, and it is the whole reason the
      // discriminated result exists.
      console.error("[push] clinch check: claim_error", {
        competitionId: input.competitionId,
        clincherTeamId: clincher.id,
        code: claim.code,
        message: claim.message,
      });
      // The message goes in the ROW too. This is the outcome most likely to be
      // read days later by someone who no longer has the logs, and "it failed"
      // without the reason would leave them exactly where this whole
      // investigation started.
      await recordClinchOutcome(
        admin,
        input,
        "claim_error",
        claim.code ? `${claim.code}: ${claim.message}` : claim.message
      );
      return;
    }

    if (claim.outcome === "claim_no_row") {
      // Zero rows, no error, and the column does not hold this team — so the
      // filter should have matched and didn't. Nothing in the schema explains
      // this (verified in prod: the same predicate as SQL matches the row), so
      // it is logged as its own unexplained state rather than folded into
      // suppression, which is exactly the conflation that hid it.
      console.error("[push] clinch check: claim_no_row", {
        competitionId: input.competitionId,
        clincherTeamId: clincher.id,
        heldNow: claim.heldNow,
        heldClaimAtPassStart: heldClaim,
      });
      await recordClinchOutcome(admin, input, "claim_no_row");
      return;
    }

    // OUTCOME: claimed. The send follows and records its own row via
    // `sendPushToUsers`; this marks the moment the claim was won, so a failure
    // between here and the sender is still bracketed by two lines.
    console.info("[push] clinch check: claimed", {
      competitionId: input.competitionId,
      clincherTeamId: clincher.id,
    });

    const { data: comp } = await admin
      .from("competitions")
      .select("name")
      .eq("id", input.competitionId)
      .maybeSingle();

    const { data: assignments } = await admin
      .from("team_assignments")
      .select("user_id")
      .eq("competition_id", input.competitionId);
    const audience = (assignments ?? []).map((r: { user_id: string }) => r.user_id);

    // The cup standings AT the clinch — the same `teamTotals` the board renders,
    // so the notification and the board can't quote different numbers. Top two
    // only: the clincher is already named in the title, and the line exists to
    // say by how much.
    const totals = (board.teamTotals ?? {}) as Record<string, number>;
    const standingsLine = formatClinchMargin(teams.map((t) => totals[t.id] ?? 0));

    await sendPushToUsers(
      audience,
      "game_results",
      {
        ...COPY.clinched(
          clincher.name ?? "A team",
          (comp?.name as string | null) ?? null,
          standingsLine
        ),
        url: cupUrl(input.tripId),
        tag: `bt-clinch-${input.competitionId}`,
      },
      {
        excludeUserId: input.actorUserId,
        context: {
          trigger: "cup_clinched",
          tripId: input.tripId,
          competitionId: input.competitionId,
          actorUserId: input.actorUserId,
        },
      }
    );
  } catch (err) {
    // OUTCOME: threw. Same `[push] clinch check:` prefix as the other three so
    // one query returns every outcome — a filter that misses the failure case is
    // the one you needed. Kept as console.error so it also surfaces as an error
    // level, unlike the outcomes above which are ordinary events.
    console.error("[push] clinch check: threw", {
      competitionId: input.competitionId,
      err,
    });
    // The client is re-resolved here because the one inside the `try` is out of
    // scope — and if THAT client is what threw, this record attempt fails too and
    // is swallowed by `recordPushAttempt`. The log line above is the backstop for
    // that case; it has already fired by this point regardless.
    await recordClinchOutcome(
      input.admin ?? createAdminClient(),
      input,
      "threw",
      err instanceof Error ? err.message : String(err)
    );
  }
}
