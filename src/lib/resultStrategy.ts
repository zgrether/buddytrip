/**
 * Which engine finalizes a GAME — the one place that question is answered.
 *
 * Pure and client-safe (no server/DB deps), because both halves of CLAUDE.md #8's
 * split need it: `games.finish` dispatches on it to decide what to compute, and
 * `computeCompetitionLeaderboard` reads it to decide how to award. Two derivations
 * of "what kind of game is this?" is how the write path and the read path come to
 * disagree about the same row.
 *
 * ── Why a resolver rather than a field ──────────────────────────────────────
 * Until the bracket, the answer was a single field: `GameTypeDefinition.
 * resultStrategy`, fixed by the format. A bracket is the first format whose
 * engine is not decided by the game TYPE at all.
 *
 * A bracket is not a game type. `gtt_generic_yard` played as a bracket and the
 * same type played head-to-head are the same format with the same rules; what
 * differs is the per-game `competition_format` descriptor. Adding
 * `gtt_bracket_*` types instead would have meant one type per category
 * (cornhole-as-bracket, card-as-bracket, …) — the two-entries-for-one-format
 * mistake the spec explicitly collapsed, multiplied by the category axis.
 *
 * So the strategy is resolved from BOTH inputs, and the dispatch stays
 * data-driven (CLAUDE.md #8): `finish` still branches on a strategy value, not on
 * a format name. The rule moved; the shape did not.
 *
 * ── The precedence, and why it points this way ──────────────────────────────
 * An ENGINE type wins over the descriptor, always. `competition_format` is
 * documented on the column as a "manual descriptor that drives the leaderboard
 * label; it does not run in-app", and golf games carry it too. If it outranked
 * the type, tagging a stroke-play game as a bracket would silently re-route its
 * finalize away from the stroke engine and score the round as a draw nobody
 * played. The descriptor may only decide the answer where the type has left it
 * open — i.e. for a manual format, whose `resultStrategy` is null precisely
 * because the format itself does not say how results arrive.
 */

import { getGameTypeDefinition, type ResultStrategy } from "@/lib/gameTypes";

/**
 * The strategies `games.finish` can dispatch to.
 *
 * `"bracket"` is deliberately NOT a member of `ResultStrategy`: that type is the
 * FORMAT's engine (`GameTypeDefinition.resultStrategy`), and no format carries
 * this value — it exists only as a resolution of type + descriptor. Keeping the
 * two types distinct is what stops someone "completing" the catalog by giving a
 * game type `resultStrategy: "bracket"`, which would reintroduce the per-category
 * bracket types this format was collapsed out of.
 *
 * `"matches"` is the SECOND such value, and arrives for exactly the same reason:
 * a cornhole game played as four 2v2 matches and the same game settled in one
 * declaration are the same game type, differing only in the per-game descriptor.
 * `gtt_matches_*` types would be one per category all over again. That the
 * bracket's reasoning generalised without amendment is the argument for having
 * written it down as a rule rather than as a bracket fact.
 *
 * `null` is a real answer (manual — the finishing order is entered by hand), and
 * is why the unknown case below is `undefined` rather than null.
 */
export type ResolvedResultStrategy = ResultStrategy | "bracket" | "matches" | null;

/**
 * The ONE `competition_format` value that resolves to the bracket engine.
 *
 * Deliberately excludes the legacy `bracket_se` / `bracket_de`. Those predate
 * migration 112 and have no `bracket_entrants`, no draw and no `bracket_config`;
 * a game holding one is a manual game that someone labelled, and its results are
 * entered by hand exactly as they always were. Routing them here would take a
 * game that could be finalized and make it unfinishable — refused for an empty
 * draw it was never given a way to build.
 *
 * This matches migration 117's readiness gate, which scopes its bracket
 * refusal to `competition_format = 'bracket'` for the same reason. The two
 * are the same claim about the same rows and are kept deliberately in step.
 */
export const BRACKET_COMPETITION_FORMAT = "bracket" as const;

/**
 * The ONE `competition_format` value that resolves to the per-match engine.
 *
 * A new value rather than the retired `live_results` slot it takes in the picker
 * (migrations 168/169). The tile's SLOT moved; its VALUE did not, because this
 * column stopped being cosmetic the moment this function began branching on it —
 * a string reading `live_results` and meaning "head to head matches across
 * teams" would be a load-bearing lie. There was also one real production row
 * holding the old value, on a COMPLETE game, which reusing it would have
 * re-routed away from the manual arm that wrote its results.
 */
export const MATCHES_COMPETITION_FORMAT = "matches" as const;

/**
 * The engine that finalizes this game.
 *
 * Returns `undefined` — NOT null — when the game type is absent from the code
 * catalog. The distinction is load-bearing: `null` means "manual, finalized by an
 * entered order", which is a served arm of the dispatch, while `undefined` means
 * "we do not recognise this game", which `games.finish` turns into a refusal
 * rather than a compute. Collapsing the two would restore exactly the silent
 * stroke-play fallback the B2 guard exists to prevent.
 */
export function resolveResultStrategy(
  gameTypeId: string | null | undefined,
  competitionFormat: string | null | undefined
): ResolvedResultStrategy | undefined {
  const def = getGameTypeDefinition(gameTypeId);
  if (!def) return undefined;
  // An engine format's strategy is fixed by the format. See the precedence note.
  if (def.resultStrategy !== null) return def.resultStrategy;
  // Two descriptors now resolve to an engine, and they are mutually exclusive by
  // construction: a game carries ONE `competition_format`. Anything else — the
  // legacy bracket values, `best_of_n`, `head_to_head`, null — is still the
  // manual arm, which stays the default rather than a fallthrough nobody named.
  if (competitionFormat === BRACKET_COMPETITION_FORMAT) return "bracket";
  if (competitionFormat === MATCHES_COMPETITION_FORMAT) return "matches";
  return null;
}

/**
 * Is this game scored by the bracket engine? A convenience over the resolver, so
 * a reader that only wants the yes/no does not restate the rule — and so the
 * grep for "who treats a game as a bracket?" has one answer.
 */
export function isBracketGame(
  gameTypeId: string | null | undefined,
  competitionFormat: string | null | undefined
): boolean {
  return resolveResultStrategy(gameTypeId, competitionFormat) === "bracket";
}

/**
 * Is this game scored by the pick'em engine?
 *
 * Beside `isBracketGame` and for the same reason: the leaderboard has to award a
 * pick'em game from the ENGINE that finalized it, not from the shape of a
 * `points_distribution` column pick'em never writes. Resolving both paths through
 * this one file is what stops the write and the read disagreeing about what kind
 * of game they are looking at.
 *
 * The descriptor argument rides along unused today — pick'em's strategy is fixed
 * by the format — but the signature matches `isBracketGame` deliberately: a caller
 * asking "which engine is this?" should not have to know which formats happen to
 * consult the descriptor.
 */
export function isPickemGame(
  gameTypeId: string | null | undefined,
  competitionFormat: string | null | undefined
): boolean {
  return resolveResultStrategy(gameTypeId, competitionFormat) === "pickem";
}

/**
 * Is this game scored by the per-match engine (non-golf Matches)?
 *
 * Third in the row beside `isBracketGame` and `isPickemGame`, and the same
 * argument: the write path and the read path must derive "what kind of game is
 * this?" from ONE place, or they come to disagree about the same row.
 *
 * Note what this does NOT answer. It is not "does this game have match rows"
 * (pick'em has them too) and not "does its points pool divide by them" — that is
 * `pointsDivideByMatchRows`, which stays a separate predicate because merging
 * questions that currently share an answer is the mistake that one exists to
 * undo. This answers only which engine finalizes the game.
 */
export function isMatchesGame(
  gameTypeId: string | null | undefined,
  competitionFormat: string | null | undefined
): boolean {
  return resolveResultStrategy(gameTypeId, competitionFormat) === "matches";
}
