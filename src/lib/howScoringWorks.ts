import { formatLine } from "./formatLines";
import { awardsPerMatch } from "./pointsDistribution";
import {
  AWARD_WORD,
  COMPETING_WORD,
  fmtPts,
  joinAnd,
  NONGOLF_FORMAT_WORD,
  ptsWord,
  SPLIT_WORD,
  splitValuesLine,
  WIN_RULE,
} from "./vocabulary";

/**
 * The How scoring works card, as lines (Zach's rulings, 2026-10-22): who is
 * competing, how the winner is decided, and what each game is worth. Built only
 * from the competition's own settings, as the board already has them, and
 * worded only from shared modules: the vocabulary (`WIN_RULE`, `COMPETING_WORD`,
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
  teams: ReadonlyArray<{ name: string }>;
  teamless: boolean;
  games: ReadonlyArray<HowScoringGameInput>;
}

export interface HowScoringWorks {
  /** "2 teams" and "Alpha and Bravo", or "Individuals" and nothing. */
  competing: { label: string; names: string | null };
  /** How the winner is decided, one sentence each. */
  rules: string[];
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
  if (!(total > 0)) return AWARD_WORD.none;
  const value = `${fmtPts(total)} ${ptsWord(total)}`;
  if (awardsByMatch(g) || g.gameTypeId === "gtt_pickem") return value;
  const values = g.distribution ?? [];
  return `${value} · ${values.length >= 2 ? splitValuesLine(values) : SPLIT_WORD.winnerTakesAll}`;
}

export function howScoringWorks(i: HowScoringInput): HowScoringWorks {
  const competing = i.teamless
    ? { label: COMPETING_WORD.individuals, names: null }
    : { label: COMPETING_WORD.teamCount(i.teams.length), names: joinAnd(i.teams.map((t) => t.name)) };

  const rules: string[] =
    i.scoringModel === "match_play"
      ? [WIN_RULE.cupTarget, WIN_RULE.cupTargetDrops, WIN_RULE.cupLevel]
      : [WIN_RULE.tournament, WIN_RULE.tournamentTie];
  // Tied places only mean something where a game awards by place.
  if (i.games.some((g) => !awardsByMatch(g))) rules.push(WIN_RULE.tiedPlaces);

  return {
    competing,
    rules,
    games: i.games.map((g) => ({
      id: g.id,
      name: g.name,
      line: gameLine(g),
      worth: worth(g),
    })),
  };
}
