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

/** A name field's example, following the type (Zach, on #1604's look). */
export const COMPETITION_NAME_EXAMPLE = {
  match_play: "e.g. The Turkey Cup",
  points: "e.g. The Yert Open",
} as const satisfies Record<ScoringModel, string>;

/** For a surface that can't know the kind, after the choice: a refusal, a
 *  notification setting, the rail's key for the trophy. */
export const EITHER_COMPETITION = "Cup or Tournament";

/**
 * THE CHOOSING FORM (Zach, 2026-10-12). Where someone is choosing a type — the
 * create panel's shape options, help that explains the two — the head-to-head
 * kind says what it is: **Head-to-Head Cup**. Everywhere after the choice it is
 * plain **Cup**. Tournament is the same word in both places.
 */
export const COMPETITION_CHOICE_WORD = {
  match_play: "Head-to-Head Cup",
  points: "Tournament",
} as const satisfies Record<ScoringModel, string>;

/**
 * THE UMBRELLA WORD — every starting point says "Start a Competition": the
 * create panel's title, the side games board's start card and the trip
 * settings row (Zach, 2026-10-12, on #1604's look). It sits above the two kinds
 * before either is picked, where "Start a Head-to-Head Cup or Tournament"
 * wrapped to two lines on a phone and repeated the options right below it. The
 * one place the code's word is copy; `competitionWords.guard.test.ts` admits it
 * only from this file.
 */
export const COMPETITION_UMBRELLA = "Competition";

/** Help that explains both kinds (the Games tab's empty-state explainer). The
 *  starting points themselves say "Start a Competition". */
export const EITHER_CHOICE = `${COMPETITION_CHOICE_WORD.match_play} or ${COMPETITION_CHOICE_WORD.points}`;
