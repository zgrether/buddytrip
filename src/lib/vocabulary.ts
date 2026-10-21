import type { ScoringModel } from "./gameTypes";
import type { SlateResult } from "./pickemScoring";
import type { MatchLevel } from "./matchPlay";

/**
 * THE APP'S VOCABULARY — the one home for its domain TERMS (#1619).
 *
 * Competition types, match states, result words, roles and the names of the
 * app's own actions: the words that mean one thing everywhere and have to be
 * spelled one way everywhere. One-off sentences stay inline in their
 * components; this holds terms, not copy.
 *
 * This consolidates what used to live in several places, each right on its own
 * terms and each guarded differently or not at all: `competitionWords.ts`,
 * `pickemResultWords.ts`, `MATCH_LEVEL_WORD` in `matchPlay.ts`, the result
 * words inside `ownStanding.ts`, the board's subtitle word, and a dozen inline
 * spellings (Re-credit, Side game, Withdrew, In review, Live, Final, the role
 * badges). The CLAUDE.md glossary records the DECISIONS behind these words —
 * the history, the landmines, the layer each rename touched — and points here
 * for the words themselves.
 *
 * `vocabulary.guard.test.ts` fails if a surface spells a term this file holds,
 * with two documented exceptions: generic words (Live, Final, Won, …) are
 * checked only as an exact standalone literal, and ROLES are not checked at all
 * — a role's label is spelled exactly like the stored value RLS compares
 * against, so no text check can tell the two apart.
 *
 * Display-string tier only. Nothing below the screen is renamed: stored values
 * (`scoring_model`, `pickem_slate_games.result = 'cancelled'`, the trip role
 * values) keep their spellings.
 */

// ── Competition types ─────────────────────────────────────────────────────────

/**
 * THE ONE PLACE a competition becomes a word on screen.
 *
 * In code it is a **competition** (the `competitions` table, `scoring_model`).
 * On screen it is a **Cup** when it is head to head and a **Tournament** when it
 * is points-based, teams or individuals (Zach, 2026-10-12; CLAUDE.md glossary,
 * *Container*). Never "Race" or "Tourney", and never a real event's name. A
 * bracket is a game FORMAT and is never called a tournament.
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
 * THE UMBRELLA WORD — every ENTRY POINT says "Start a Competition": the side
 * games board's start card, the trip settings row, and the create panel's
 * Build your own form (Zach, 2026-10-12, on #1604's look). Since starting
 * points (2026-10-21) the panel OPENS on "What are you playing?", the
 * starting-point picker, which also offers Just keep score (a side game, no
 * competition), so the umbrella moved to the form behind Build your own.
 * "Starting point" now names the picker's presets (`startingPoints.ts`); the
 * surfaces that open the panel are entry points. It sits above the two kinds
 * before either is picked, where "Start a Head-to-Head Cup or Tournament"
 * wrapped to two lines on a phone and repeated the options right below it. The
 * one place the code's word is copy; the guard admits it only from this file.
 */
export const COMPETITION_UMBRELLA = "Competition";

/** Help that explains both kinds (the Games tab's empty-state explainer). The
 *  entry points themselves say "Start a Competition". */
export const EITHER_CHOICE = `${COMPETITION_CHOICE_WORD.match_play} or ${COMPETITION_CHOICE_WORD.points}`;

// ── Match states ──────────────────────────────────────────────────────────────

/**
 * A match nobody leads is in one of three states, and each has ONE word (ruling
 * PR 9 #1). Six surfaces say these — the match card, two scorecards' per-hole
 * cells, the result banner, the Quick Play subtitle and the pick'em match note —
 * and used to format their own, which is how they drifted apart. The states
 * themselves (`MatchLevel`, `matchLevel()`) stay in the scoring engine,
 * `matchPlay.ts`; only their words live here.
 */
export const MATCH_LEVEL_WORD: Record<MatchLevel, string> = {
  not_started: "Not started",
  level: "AS",
  halved: "Halved",
};

/**
 * A game's or match's state as a chip or a status word. `live` and `final`
 * are the states the board and the pick'em cards show; `inReview` is a finished
 * game reopened for a correction (`corrections_open`, the board's badge) —
 * NEVER "correction" for a re-credit, which is its own action below.
 */
export const GAME_STATE_WORD = {
  live: "Live",
  final: "Final",
  inReview: "In review",
} as const;

/**
 * The engine's MARGIN for a match halved through the last hole ("3&2" |
 * "2 UP" | "AS"). Unlike every other word here it is also DATA: `matchState`
 * writes it to `game_matches.margin`, so changing it would leave every stored
 * halved match on the old spelling — a data migration, not a copy change. It
 * equals `MATCH_LEVEL_WORD.level` today and is kept separate so the label can
 * change without touching stored margins.
 */
export const HALVED_MARGIN = "AS";

// ── Navigation and structure ──────────────────────────────────────────────────

/** A navigation tab's name: the bottom nav's competition tab, when the trip has
 *  no competition label of its own. A tab, not a game's state (GAME_STATE_WORD). */
export const NAV_WORD = {
  live: "Live",
} as const;

/** A bracket ROUND's name — the draw's structure, not a game's state. The rounds
 *  past these are numbered ("Round of 32"). */
export const BRACKET_ROUND_WORD = {
  final: "Final",
  semifinals: "Semi-finals",
  quarterfinals: "Quarter-finals",
} as const;

// ── Result words ──────────────────────────────────────────────────────────────

/**
 * A result as a word: a declared match from one side's point of view (the trip
 * rail's "your standing", `ownStanding.ts`), a skins hole nobody won, a Quick
 * Play team tie. Non-golf matches say Tied, not Halved — Halved is golf's word
 * (`MATCH_LEVEL_WORD.halved`) — and an undecided match is "Not decided", never a
 * blank that reads as a result.
 */
export const RESULT_WORD = {
  won: "Won",
  lost: "Lost",
  tied: "Tied",
  pending: "Not decided",
} as const;

/**
 * A stored pick'em slate result as a word. The stored value is `cancelled`
 * (`pickem_slate_games.result`); the screen says **Canceled** — US spelling,
 * Zach's call (2026-10-08). The two differ by one letter ON PURPOSE: a stored
 * value is an identifier, not copy. Renaming a value that RLS and four writers
 * compare against, to fix a spelling, is the highest-risk tier for a cosmetic
 * gain (CLAUDE.md glossary).
 *
 * Only `cancelled` lives here. `push` is worded per surface on purpose ("Push"
 * on the segment, "Pushed" on the settled line) and is not a spelling question.
 */
export const SLATE_RESULT_WORD = {
  cancelled: "Canceled",
} as const satisfies Partial<Record<SlateResult, string>>;

/** The board's subtitle for a live game whose team cells carry projection
 *  pills (`liveSubtitle`, GameRow). */
export const PROJECTED_RESULTS = "Projected results";

// ── Roles ─────────────────────────────────────────────────────────────────────

/**
 * A trip role's LABEL (badges, the news author line). Keyed on the stored role
 * values, which are spelled the same — and that is the landmine: the role
 * values are what RLS branches on (CLAUDE.md glossary, *Rights*), so only the
 * DISPLAY moves here and every comparison against the stored value stays where
 * it is. If the screen word ever changes (as Planner → Organizer once did), it
 * changes here and nowhere a policy reads.
 */
export const TRIP_ROLE_WORD = {
  Owner: "Owner",
  Organizer: "Organizer",
  Member: "Member",
} as const satisfies Record<"Owner" | "Organizer" | "Member", string>;

/** The one game-scope role (CLAUDE.md glossary: `delegate`). */
export const DELEGATE_WORD = "Delegate";

// ── Actions and tags ──────────────────────────────────────────────────────────

/**
 * Moving a finished game's credit to another team (`game_recredits`, ruling 18,
 * PR 8c). NEVER "correction", which already means reopening a finished game to
 * edit its scores, and both can show on the same board row.
 */
export const RECREDIT_WORD = {
  action: "Re-credit",
  by: "Re-credited by",
} as const;

/** A game that belongs to no competition (PR 6b): its tag and its option. */
export const SIDE_GAME_WORD = "Side game";

/** A bracket entrant who left the draw after it was built. */
export const WITHDREW_WORD = "Withdrew";

/**
 * Someone on the trip who is on no team of this cup (PR 9b; stroke and skins
 * groupings since the #1668 look). One phrase for the one state: builders,
 * groupings, their boards and the Rosters screen, which said "Unassigned
 * crew" until #1670.
 */
export const NOT_ON_A_TEAM_WORD = "Not on a team";

// ── Setup: what a game still needs ────────────────────────────────────────────

/**
 * Why a game is not ready yet (Zach's Needs-attention rulings, 2026-10-21).
 * `gameSetupReasons` (src/lib/gameReadiness.ts) decides WHICH reasons hold;
 * this decides the WORDS, in two forms:
 *
 *  - `line`: the short phrase a list shows (the board's game rows).
 *  - `blocked`: the sentence a settings page shows beside the control it
 *    blocks. A database refusal for the same reason says the same sentence.
 *
 * `too_many_places` has no entry: its words are `tooManyPlacesWords` below,
 * because they carry the counts.
 */
export const SETUP_REASON_WORD = {
  points_missing: { line: "No point value", blocked: "Set a point value before enabling scoring" },
  matches_none: { line: "No matches drawn", blocked: "Pair every match before enabling scoring" },
  matches_unpaired: {
    line: (n: number) => `${n} ${n === 1 ? "match" : "matches"} not paired`,
    blocked: "Pair every match before enabling scoring",
  },
  player_not_on_team: {
    line: "A paired player isn't on a team",
    blocked: "A paired player isn't on a team. Fix the matchups before enabling scoring.",
  },
  groups_none: { line: "No groups yet", blocked: "Add at least one group before enabling scoring" },
  bracket_field: {
    line: "Needs 2 entrants",
    blocked: "A bracket needs at least two entrants before it can go live",
  },
  slate_empty: {
    line: "No games on the slate",
    blocked: "Add at least one game to the slate before opening picks.",
  },
} as const;

/** "3 places, but only 2 teams can finish." The one sentence for a split with
 *  more places than can be filled: settings, the finalize refusal and the board. */
export function tooManyPlacesWords(places: number, count: number, unit: { one: string; many: string }): string {
  return `${places} places, but only ${count} ${count === 1 ? unit.one : unit.many} can finish.`;
}

// ── Points ────────────────────────────────────────────────────────────────────

/**
 * Points are AWARDED, never paid (Zach, 2026-10-19, the #1668 look). "Pay" and
 * "payout" are money words, and this app has real money in it (expenses), so
 * points borrowing them blurs the one place where money is meant. The guard
 * fails on a pay word in copy outside the files where it means money.
 *
 * `label` heads what a game will award at finalize, `unawarded` totals the
 * places nobody can fill, and `none` is the finish confirm every format shows
 * before a game that awards nothing.
 */
/**
 * Skins are WON, or CARRIED OVER to the next hole — never paid, the same rule
 * as points (Zach, 2026-10-19). A tie on the last hole leaves a pot nobody can
 * win; every surface that says so says it this way.
 */
export const SKINS_DEAD_POT = "Nobody won the last skins.";

export const AWARD_WORD = {
  label: "Points",
  unawarded: "Not awarded",
  none: "This game awards no points.",
} as const;
