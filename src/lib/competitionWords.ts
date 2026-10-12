import type { ScoringModel } from "./gameTypes";

/**
 * THE ONE PLACE a competition becomes a word on screen.
 *
 * In code it is a **competition** (the `competitions` table, `scoring_model`).
 * On screen it is a **Cup** when it is head to head and a **Tournament** when it
 * is points-based, teams or individuals (Zach, 2026-10-12; CLAUDE.md glossary,
 * *Container*). Never "Race" or "Tourney", and never a real event's name. A
 * bracket is a game FORMAT and is never called a tournament.
 *
 * Display-string tier only: `scoring_model` keeps its values and nothing below
 * the screen is renamed. `competitionWords.guard.test.ts` fails if a surface
 * spells a retired word, or names the container itself, instead of reading it
 * from here.
 */
export const COMPETITION_WORD = {
  match_play: "Cup",
  points: "Tournament",
} as const satisfies Record<ScoringModel, string>;

export type CompetitionWord = (typeof COMPETITION_WORD)[ScoringModel];

/** The kind's name, capitalised: titles, labels, buttons ("Cup settings").
 *  An unset model is head to head, the column's own default. */
export function competitionWord(model: ScoringModel | null | undefined): CompetitionWord {
  return COMPETITION_WORD[model ?? "match_play"];
}

/** The same word inside a sentence ("this tournament is played as individuals"). */
export function competitionNoun(model: ScoringModel | null | undefined): string {
  return competitionWord(model).toLowerCase();
}

/** For a surface that can't know the kind: before one exists, or across trips. */
export const EITHER_COMPETITION = "Cup or Tournament";
