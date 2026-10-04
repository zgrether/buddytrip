import { GAME_TYPE_DEFINITIONS } from "./gameTypes";
import { computeStrokeTeamStandings, rankingDirection } from "./strokePlay";
import { scoringOf, type ScoringType } from "./stableford";

/**
 * RE-CREDIT (PR 8c, ruling 18): the trip Owner moves one person's credit in a
 * FINISHED game to the team they are on now — the fix for a setup mistake, game
 * by game. Named re-credit, never "correction", which already means reopening a
 * game to edit its scores.
 *
 * Client-safe and pure (CLAUDE.md #8): the server builds the new team rows with
 * these, and they are the same function the finalize writers use, so a re-credit
 * produces exactly the rows a re-finalize through the corrected roster would.
 * `recredit.db.test.ts` pins that end to end.
 */

/**
 * The formats whose result did not depend on who was on which team — read from
 * the ONE declaration (`teamDependent: false`), never listed by hand. The
 * database keeps its own copy (`_recredit_eligible_format`, migration 204)
 * because the refusal has to live where the write does; `recredit.guard.test.ts`
 * fails the day the two disagree.
 */
export const RECREDIT_FORMATS: readonly string[] = Object.values(GAME_TYPE_DEFINITIONS)
  .filter((d) => d.teamDependent === false)
  .map((d) => d.id)
  .sort();

export const isRecreditEligible = (gameTypeId: string | null | undefined): boolean =>
  !!gameTypeId && RECREDIT_FORMATS.includes(gameTypeId);

/**
 * How each eligible format ranks its TEAMS — the scoring type its writer passes
 * to `computeStrokeTeamStandings`. Keyed by format so a format that becomes
 * team-independent without saying how its teams rank is refused at the guard
 * rather than ranked with the wrong direction.
 *   - stroke play: the game's own scoring type (Traditional or Stableford —
 *     Stableford ranks MORE first), exactly as `strokePlay.ts` reads it;
 *   - skins: "skins", exactly as `skins.ts` passes it.
 */
export const TEAM_SCORING: Record<string, (config: unknown) => ScoringType> = {
  gtt_stroke_play: (config) => scoringOf(config).type,
  gtt_skins: () => "skins",
};

/** A person's stored result row, as `game_results` holds it. */
export interface PersonResultRow {
  entity_id: string;
  raw_score: number | string | null;
  position: number | null;
}

/** A team result row, in the shape `_write_game_results` inserts. */
export interface TeamResultRow {
  id: string;
  entity_id: string;
  entity_type: "team";
  raw_score: number;
  position: number;
  value_kind: "rank";
  competition_points_earned: null;
  points: null;
  credited_team_id: string;
}

/**
 * The game's team rows, rebuilt from its STORED person rows through a roster.
 *
 * Built from the person rows rather than by re-running the writer from scores:
 * a finished game not open for review has the person rows its writer last
 * produced, and they are exactly the standings that writer passed to
 * `computeStrokeTeamStandings` (only qualified players get a row). A person row
 * with no score cannot rank, so it is left out the way the writer leaves out a
 * player who did not finish.
 */
export function recreditTeamRows(
  personRows: readonly PersonResultRow[],
  teamOf: Record<string, string>,
  scoring: ScoringType,
  mintId: () => string = () => crypto.randomUUID()
): TeamResultRow[] {
  const standings = personRows
    .filter((r) => r.raw_score !== null && r.position !== null)
    .map((r) => ({ entityId: r.entity_id, rawScore: Number(r.raw_score), position: r.position as number }));
  return computeStrokeTeamStandings(standings, teamOf, scoring).map((t) => ({
    id: mintId(),
    entity_id: t.teamId,
    entity_type: "team" as const,
    raw_score: t.total,
    position: t.position,
    value_kind: "rank" as const,
    competition_points_earned: null,
    points: null,
    credited_team_id: t.teamId,
  }));
}

/** The roster a game credits through after this person's credit moves to
 *  `toTeamId` (or to no team). Nobody else's entry changes. */
export function recreditedRoster(
  roster: Record<string, string>,
  userId: string,
  toTeamId: string | null
): Record<string, string> {
  const next = { ...roster };
  if (toTeamId) next[userId] = toTeamId;
  else delete next[userId];
  return next;
}

/**
 * UNEQUAL TEAMS (Zach's ruling on #1561, 2026-10-04): a stroke or skins team
 * total is the SUM of its finishers, so a team with more players counting posts
 * a bigger number. Keep the sum; WARN, never block — unequal teams are the
 * organizer's choice, and the app's job is to make the consequence visible.
 *
 * The direction is the point of the warning, and it comes from the ONE place
 * that says which way a scoring type ranks (`rankingDirection`):
 *   - low wins (traditional stroke): a bigger total is WORSE, so the bigger team
 *     is at a disadvantage — why re-crediting someone TO a team can lose it the
 *     game;
 *   - high wins (Stableford, skins): a bigger total is better — an advantage.
 *
 * One sentence, shared by every surface that warns (the re-credit sheet now;
 * game setup and the trade preview next), so they cannot word it two ways.
 */

/** People with a result in the game, per team, through `roster`. A finisher on
 *  no team counts for no team, as the team total leaves them out. */
export function finishersByTeam(
  personRows: readonly PersonResultRow[],
  roster: Record<string, string>
): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of personRows) {
    if (r.raw_score === null || r.position === null) continue;
    const team = roster[r.entity_id];
    if (team) out.set(team, (out.get(team) ?? 0) + 1);
  }
  return out;
}

const NUMBER_WORDS = ["none", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const numberWord = (n: number) => NUMBER_WORDS[n] ?? String(n);
const playersWord = (n: number) => `${numberWord(n)} player${n === 1 ? "" : "s"}`;

/**
 * "Spartans would have three players counting in Day 1 Stroke, Centurions two —
 * in stroke play a team's total is its players' strokes added up, so the bigger
 * team is at a disadvantage." Null when every team counts the same number.
 *
 * `teams` is every team of the cup: a team with nobody counting is named with
 * none, because a team scoring nothing is the most unequal case of all.
 */
export function unequalTeamsNote(input: {
  gameName: string;
  scoring: ScoringType;
  counts: ReadonlyMap<string, number>;
  teams: readonly { teamId: string; teamName: string }[];
  /** "would" previews a change; "has" describes the state as it is. */
  mood: "would" | "has";
}): string | null {
  const rows = input.teams
    .map((t) => ({ name: t.teamName, n: input.counts.get(t.teamId) ?? 0 }))
    .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  if (rows.length < 2 || rows.every((r) => r.n === rows[0].n)) return null;
  const [first, ...rest] = rows;
  const verb = input.mood === "would" ? "would have" : "has";
  const others = rest.map((r) => `${r.name} ${numberWord(r.n)}`).join(", ");
  const format = input.scoring === "skins" ? "skins" : input.scoring === "stableford" ? "Stableford" : "stroke play";
  const unit = input.scoring === "skins" ? "skins" : input.scoring === "stableford" ? "points" : "strokes";
  const effect = rankingDirection(input.scoring) === "low_wins" ? "at a disadvantage" : "at an advantage";
  return (
    `${first.name} ${verb} ${playersWord(first.n)} counting in ${input.gameName}, ${others} — ` +
    `in ${format} a team's total is its players' ${unit} added up, so the bigger team is ${effect}.`
  );
}

// ── What a preview carries (the server builds it, the sheet renders it) ──

export interface TeamPoints {
  teamId: string;
  teamName: string;
  place: number | null;
  points: number;
}

export interface RecreditGame {
  gameId: string;
  name: string;
  /** The team this person's result counts for now; null = no team. */
  fromTeamId: string | null;
  fromTeamName: string | null;
  /** Per team, this game's place and points as the board computes them. */
  before: TeamPoints[];
  after: TeamPoints[];
  /** The unequal-teams warning after the move (#1561's ruling), or null. */
  unequalTeams: string | null;
  /** What confirm checks the game against (`_game_credit_fingerprint`). */
  fingerprint: string;
}

export interface StandingGame {
  gameId: string;
  name: string;
  /** Why it is not offered. */
  reason: "team_dependent" | "in_review";
}

export interface RecreditPreview {
  personName: string;
  /** The destination — the team they are on now. Null = no team. */
  toTeamId: string | null;
  toTeamName: string | null;
  eligible: RecreditGame[];
  standing: StandingGame[];
}
