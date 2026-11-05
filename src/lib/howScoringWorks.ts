import { formatLine } from "./formatLines";
import { awardsPerMatch } from "./pointsDistribution";
import {
  AWARD_WORD,
  COMPETING_WORD,
  fmtPts,
  joinAnd,
  NONGOLF_FORMAT_WORD,
  ptsWord,
  pointsInPlayLine,
  SPLIT_WORD,
  splitValuesLine,
} from "./vocabulary";

/**
 * The How scoring works card, as lines (Zach's rulings, 2026-10-22, and his
 * look on #1694): who is competing, the points in play and awarded so far, and
 * what each game is worth. The rule sentences came off the card at the look. Built only
 * from the competition's own settings, as the board already has them, and
 * worded only from shared modules: the vocabulary (`COMPETING_WORD`,
 * `SPLIT_WORD`, `AWARD_WORD`, `fmtPts`) and the format lines (`formatLine`).
 * Nothing here is new copy; a sentence that is not in those modules does not
 * appear.
 *
 * What each game is worth is its total and its split, and no more (ruling 3):
 * a match game's per-match value and count are not sent to members, so the
 * card never states them.
 *
 * Pure: the card renders what this returns.
 */

export interface HowScoringGameInput {
  id: string;
  name: string;
  gameTypeId: string | null;
  competitionFormat?: string | null;
  /** Points in play (the board row's `pointsTotal`). */
  pointsTotal: number | null;
  /** A placement split's values, or null (the board row's `distribution`). */
  distribution: number[] | null;
}

export interface HowScoringInput {
  scoringModel: "match_play" | "points";
  /** Points in play across the competition (the board's `pointsAvailable`). */
  pointsAvailable: number;
  /** Points awarded so far, or null until a game has finished. */
  awarded: number | null;
  teams: ReadonlyArray<{ name: string }>;
  teamless: boolean;
  games: ReadonlyArray<HowScoringGameInput>;
}

export interface HowScoringWorks {
  /** "2 teams" and "Alpha and Bravo", or "Individuals" and nothing. */
  competing: { label: string; names: string | null };
  /** "24 points in play · 8 awarded". */
  points: string;
  games: { id: string; name: string; line: string | null; worth: string }[];
}

/** A game whose points go match by match (or slot by slot), not by place. */
function awardsByMatch(g: HowScoringGameInput): boolean {
  return awardsPerMatch(g.gameTypeId, g.competitionFormat ?? null) || g.gameTypeId === "gtt_rack_n_stack";
}

/** What the game is, in one line: the format's line, or for a non-golf game
 *  played as Matches or Best of N, that format's own line, which says more
 *  than "Any card game". Simple keeps the type's line: its picker line is an
 *  instruction to the organizer, not a description. */
function gameLine(g: HowScoringGameInput): string | null {
  const format = g.competitionFormat ?? null;
  if (format === "matches" || format === "best_of_n") return NONGOLF_FORMAT_WORD[format].desc;
  return formatLine(g.gameTypeId, format);
}

/** Total, and the split when it is a split by place. Pick'em's split depends on
 *  settings the board does not carry, so it states its total only. */
function worth(g: HowScoringGameInput): string {
  const total = g.pointsTotal ?? 0;
  if (!(total > 0)) return AWARD_WORD.noPoints;
  const value = `${fmtPts(total)} ${ptsWord(total)}`;
  if (awardsByMatch(g) || g.gameTypeId === "gtt_pickem") return value;
  const values = g.distribution ?? [];
  return `${value} · ${values.length >= 2 ? splitValuesLine(values) : SPLIT_WORD.winnerTakesAll}`;
}

/** The points line's awarded half: the banked totals summed, once any game
 *  has finished. Null before that, so the line says the points in play alone
 *  (Zach's look on #1694). */
export function awardedSoFar(games: ReadonlyArray<{ status: string }>, unitTotals: Record<string, number>): number | null {
  if (!games.some((g) => g.status === "complete")) return null;
  return Object.values(unitTotals).reduce((a, b) => a + b, 0);
}

export function howScoringWorks(i: HowScoringInput): HowScoringWorks {
  const competing = i.teamless
    ? { label: COMPETING_WORD.individuals, names: null }
    : { label: COMPETING_WORD.teamCount(i.teams.length), names: joinAnd(i.teams.map((t) => t.name)) };

  return {
    competing,
    points: pointsInPlayLine(i.pointsAvailable, i.awarded),
    games: i.games.map((g) => ({
      id: g.id,
      name: g.name,
      line: gameLine(g),
      worth: worth(g),
    })),
  };
}
