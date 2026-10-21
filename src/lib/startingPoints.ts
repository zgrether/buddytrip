import type { PointsDistribution } from "./pointsDistribution";
import type { ScoringModel } from "./gameTypes";
import type { COMPETITION_FORMATS } from "./configDraft";

/** A current format (never the retired bracket_se / bracket_de a create refuses). */
type CompetitionFormat = (typeof COMPETITION_FORMATS)[number];

/**
 * Starting points (roadmap Next item 1, Zach's rulings on the mockup,
 * 2026-10-21): "Start a Competition" opens on what people want to do, and each
 * choice sets up the competition and suggests its games.
 *
 * TRIP-AGNOSTIC on purpose (Zach): nothing here names a trip, a competition or
 * a person, so the same picker can run from the dashboard once standalone play
 * arrives. The app reads this catalog; the database stores only which starting
 * point a competition came from and which suggestions were skipped (migration
 * 220), so improving a starting point needs no data change.
 *
 * Just keep score and Build your own sit on the picker too, but they are not
 * starting points here: the first makes a side game (no competition), the
 * second is the ordinary chooser. Pick'em pool is held until per-person
 * results exist.
 *
 * Point values were proposed by Claude and ruled on by Zach (2026-10-21).
 * Match Play and Rack-n-Stack take a game TOTAL, not a value per match: their
 * settings show only a total and the share it divides into, so a per-match
 * value with no total would read 0 there while awarding 1. Eight divides
 * evenly across 8, 4 or 2 matches or pairings. The splits never have more
 * places than the field can fill, so finalize never refuses them.
 */

export const STARTING_POINT_IDS = ["team_cup_weekend", "golf_week", "bar_night_bracket"] as const;
export type StartingPointId = (typeof STARTING_POINT_IDS)[number];

/** Who plays, which decides the review's setup step and the team count. */
export type StartingPointPlayers =
  /** A head-to-head cup: always two teams. */
  | "two_teams"
  /** Individuals by default, or teams (two or more) when chosen. */
  | "individuals_or_teams"
  /** Teams, two or more. */
  | "teams";

export interface StartingPoint {
  id: StartingPointId;
  name: string;
  /** One short line under the name on the picker tile. */
  blurb: string;
  scoringModel: ScoringModel;
  players: StartingPointPlayers;
}

export const STARTING_POINTS: Record<StartingPointId, StartingPoint> = {
  team_cup_weekend: {
    id: "team_cup_weekend",
    name: "Team cup weekend",
    blurb: "Two teams, first to clinch.",
    scoringModel: "match_play",
    players: "two_teams",
  },
  golf_week: {
    id: "golf_week",
    name: "Golf week",
    blurb: "Everyone for themselves.",
    scoringModel: "points",
    players: "individuals_or_teams",
  },
  bar_night_bracket: {
    id: "bar_night_bracket",
    name: "Bar-night bracket",
    blurb: "Lose and you’re out.",
    scoringModel: "points",
    players: "teams",
  },
};

export function isStartingPointId(id: string | null | undefined): id is StartingPointId {
  return !!id && (STARTING_POINT_IDS as readonly string[]).includes(id);
}

/**
 * Does this setup fit the starting point? `teamCount` 0 means individuals. The
 * create procedure asks this before storing a starting point, so a competition
 * can never claim a starting point whose suggestions it could not hold.
 */
export function startingPointFits(id: StartingPointId, scoringModel: ScoringModel, teamCount: number): boolean {
  const sp = STARTING_POINTS[id];
  if (sp.scoringModel !== scoringModel) return false;
  switch (sp.players) {
    case "two_teams":
      return teamCount === 2;
    case "individuals_or_teams":
      return teamCount === 0 || teamCount >= 2;
    case "teams":
      return teamCount >= 2;
  }
}

/** One suggested game: everything `games.create` needs, and its key. */
export interface SuggestedGame {
  /** Stable identity: the format's game type id, plus `:<competition_format>`
   *  when it sets one. Stored in `competitions.skipped_suggestions`. */
  key: string;
  gameTypeId: string;
  competitionFormat: CompetitionFormat | null;
  /** The new game's name. */
  name: string;
  pointsTotal: number;
  pointsDistribution: PointsDistribution;
}

export function suggestionKey(gameTypeId: string, competitionFormat: CompetitionFormat | null | undefined): string {
  return competitionFormat ? `${gameTypeId}:${competitionFormat}` : gameTypeId;
}

/** A total split by place, sized to what can finish: two places for two teams. */
function placementTen(teamCount: number): PointsDistribution {
  return { type: "placement", values: teamCount === 2 ? [7, 3] : [5, 3, 2] };
}

function suggestion(
  gameTypeId: string,
  name: string,
  pointsTotal: number,
  pointsDistribution: PointsDistribution,
  competitionFormat: CompetitionFormat | null = null
): SuggestedGame {
  return { key: suggestionKey(gameTypeId, competitionFormat), gameTypeId, competitionFormat, name, pointsTotal, pointsDistribution };
}

/**
 * The games a starting point suggests, for a competition with `teamCount` teams
 * (0 = individuals). Scramble joins Golf week only with teams: a scramble's
 * groups are its teams.
 */
export function suggestedGames(id: StartingPointId, teamCount: number): SuggestedGame[] {
  switch (id) {
    case "team_cup_weekend":
      return [
        suggestion("gtt_match_play", "Match Play", 8, { type: "per_match", value: 0 }),
        suggestion("gtt_rack_n_stack", "Rack-n-Stack", 8, { type: "per_match", value: 0 }),
      ];
    case "golf_week":
      return [
        suggestion("gtt_stroke_play", "Stroke Play", 10, placementTen(teamCount)),
        suggestion("gtt_skins", "Skins", 10, placementTen(teamCount)),
        ...(teamCount >= 2 ? [suggestion("gtt_scramble", "Scramble", 10, placementTen(teamCount))] : []),
      ];
    case "bar_night_bracket":
      return [suggestion("gtt_generic_bar", "Bracket", 10, { type: "placement", values: [7, 3] }, "bracket")];
  }
}

/**
 * The suggestions still to show: not skipped, and no game of that format yet. A
 * suggestion counts as added once a game of its format exists (Zach), so adding
 * a game by hand clears its suggestion too.
 */
export function remainingSuggestions(
  id: StartingPointId,
  teamCount: number,
  existingGames: { game_type_id: string | null; competition_format: string | null }[],
  skipped: readonly string[]
): SuggestedGame[] {
  const present = new Set(
    existingGames.map((g) => suggestionKey(g.game_type_id ?? "", (g.competition_format as CompetitionFormat | null) ?? null))
  );
  return suggestedGames(id, teamCount).filter((s) => !skipped.includes(s.key) && !present.has(s.key));
}
