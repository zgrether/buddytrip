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

// ── Needs attention: the organizer's board card ───────────────────────────────

/** The card's title (Zach's rulings, 2026-10-21). */
export const NEEDS_ATTENTION_TITLE = "Needs attention";

/** "A and B", "A, B and C": a short list read aloud. */
export function joinAnd(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** "Mo and Oz aren't on a team". Three names at most, then a count. */
export function notOnATeamLine(names: readonly string[]): string {
  const shown = names.length > 3 ? [...names.slice(0, 2), `${names.length - 2} others`] : names;
  return `${joinAnd(shown)} ${names.length === 1 ? "isn't" : "aren't"} on a team`;
}

/** "Playing Day 2 Stroke — won't count": the games those people are in. */
export function wontCountLine(games: readonly string[]): string {
  const shown = games.length > 2 ? [games[0], `${games.length - 1} more`] : games;
  return `Playing ${joinAnd(shown)} — won't count`;
}

/** "Bravo has no players". */
export function emptyTeamLine(teamName: string): string {
  return `${teamName} has no players`;
}

/** "Teams are uneven: 6 v 5", in team order. */
export function unevenTeamsLine(sizes: readonly number[]): string {
  return `Teams are uneven: ${sizes.join(" v ")}`;
}

/** "3 places, but only 2 teams can finish." The one sentence for a split with
 *  more places than can be filled: settings, the finalize refusal and the board. */
export function tooManyPlacesWords(places: number, count: number, unit: { one: string; many: string }): string {
  return `${places} places, but only ${count} ${count === 1 ? unit.one : unit.many} can finish.`;
}

// ── How scoring is described ──────────────────────────────────────────────────
//
// Moved here from the screens that spelled them (2026-10-22), so the How
// scoring works card can be written from shared words and every screen that
// already says these things says them from one place. Each value is EXACTLY
// what its screen showed before the move; vocabulary.guard.test.ts pins them.

/** A point value as people read it: "8", "8½", "½", or "2.67" for anything
 *  that is not a whole or a half. Points come in halves (a halved match, an
 *  averaged tie). One formatter: the board and the game screens had a copy each. */
export function fmtPts(n: number): string {
  if (Number.isInteger(n)) return String(n);
  const whole = Math.floor(n);
  if (Math.abs(n - whole - 0.5) < 0.001) return whole === 0 ? "½" : `${whole}½`;
  return String(Math.round(n * 100) / 100);
}

/** "pt" for exactly one point, "pts" otherwise. */
export function ptsWord(n: number): string {
  return n === 1 ? "pt" : "pts";
}

/** The Cup's race, as the hero says it. */
export const RACE_WORD = {
  /** "First to 14½ wins". `target` is already formatted (`fmtPts`). */
  firstTo: (target: string) => `First to ${target} wins`,
  /** "Blue wins". */
  wins: (name: string) => `${name} wins`,
  /** "Blue has clinched · 3 games remain". */
  hasClinched: (name: string, gamesRemaining: number) =>
    `${name} has clinched · ${gamesRemaining} game${gamesRemaining === 1 ? "" : "s"} remain${gamesRemaining === 1 ? "s" : ""}`,
  /** The expanded hero before any game is worth anything. */
  noPointsInPlay: "No points in play yet",
  /** The collapsed bar's shorter form of the same fact. */
  noPoints: "No points yet",
  /** A Cup that ended level (Zach, 2026-10-22): "Final · Shared". */
  shared: "Shared",
} as const;

/** Clinching, wherever it is announced. */
export const CLINCH_WORD = {
  /** The pick'em match card's state pill. */
  pill: "Clinched",
  /** The push to the whole trip: "Blue clinched". */
  pushTitle: (teamName: string) => `${teamName} clinched`,
  /** Pick'em's team roll-up: "Blue has clinched — 4 still to play." */
  rollUp: (teamName: string, remaining: number) => `${teamName} has clinched — ${remaining} still to play.`,
} as const;

/** How a game's points are split across finishing places. */
export const SPLIT_WORD = {
  /** One place takes the whole value. */
  winnerTakesAll: "Winner takes all",
  /** The non-golf row's name for a split of two or more places. */
  custom: "Custom placement split",
  /** The non-golf row's name for an even pool. */
  even: "Even",
  /** The Winner takes all row's explanation. */
  winnerTakesAllHelp: "1st place takes the whole pool. Add places to split it across the field.",
} as const;

/** "5 · 3 · 2 pts": a split's values, highest place first. */
export function splitValuesLine(values: readonly number[]): string {
  return `${values.map(fmtPts).join(" · ")} pts`;
}

/** What a game that awards match by match (or slot by slot) is worth. */
export const PER_MATCH_WORD = {
  label: "Points per match",
  /** Rack-n-Stack's unit is a slot. */
  slotLabel: "Points per Slot",
  /** The share when some matches carry their own value. */
  custom: "Custom",
  customLine: "Custom — some matches overridden",
  /** "Even — 2 per match". `share` is already formatted. */
  evenLine: (share: string) => `Even — ${share} per match`,
  /** "Win 2 · Draw 1 each". Both already formatted. */
  winDraw: (win: string, draw: string) => `Win ${win} · Draw ${draw} each`,
  /** Rack before it has groups. */
  rackPending: "Splits across the rack’s slots once groups are set.",
} as const;

/** The How scoring works card's title (the roadmap's own name for it). */
export const HOW_SCORING_WORKS_TITLE = "How scoring works";

/**
 * How the winner is decided, in the card's sentences (approved by Zach,
 * 2026-10-22). The numbers behind them are `winThreshold` / `rollUp`
 * (src/lib/competitionPlacement.ts) and `placementPoints` (a tie shares the
 * average of its places' points); these say what that arithmetic does.
 */
export const WIN_RULE = {
  tournament: "Most points wins.",
  tournamentTie: "Finish level and you share the place.",
  cupTarget: `Win the ${COMPETITION_WORD.match_play} with more than half the points in play.`,
  cupTargetDrops: "The target drops if a finished game awards less than it was worth.",
  cupLevel: `A ${COMPETITION_WORD.match_play} that ends level is shared.`,
  tiedPlaces: "Tied places split their points.",
} as const;

/** Who is competing: a tournament of individuals, or N teams. Moved from the
 *  create panel and the starting-point review, which spelled them. */
export const COMPETING_WORD = {
  individuals: "Individuals",
  teams: "Teams",
  teamCount: (n: number) => `${n} teams`,
} as const;

/** What each kind of competition is, in one sentence (the create panel) and in
 *  a few words (its settings). Keyed by `scoring_model`. */
export const COMPETITION_KIND_LINE = {
  match_play: "Two teams play matches against each other. First to the target wins.",
  points: "Everyone earns points across the games you add. Play as individuals, or split into teams.",
} as const;
export const COMPETITION_SHAPE_WORD = {
  match_play: "Head to head",
  points: "Points across the games",
} as const;

/** The non-golf formats: the name and the one line the add-game picker shows.
 *  Keyed by `games.competition_format`. The Matches line is also pick'em's
 *  description of its individual matches: the same idea. */
export const NONGOLF_FORMAT_WORD = {
  head_to_head: { label: "Simple", desc: "Choose winner/loser of game." },
  bracket: { label: "Bracket", desc: "We support single and double elimination." },
  best_of_n: { label: "Best of N", desc: "First to win the majority of games." },
  matches: { label: "Matches", desc: "Head to head matches across teams." },
} as const;

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
