import type { BracketDrawMatch } from "./bracket";
import type { ResolvedMatch, WinnerBySeed } from "./bracketAdvance";
import type { EntrantPlacement } from "./bracketPlacements";
import { resolveDraw } from "./bracketAdvance";
import { resolveDoubleDraw } from "./bracketDoubleAdvance";
import { bracketPlacements } from "./bracketPlacements";
import { doubleBracketPlacements } from "./bracketDoublePlacements";

/**
 * bracketFormat — THE ONE PLACE THAT KNOWS BOTH ELIMINATION FORMATS EXIST.
 *
 * `resolveDraw`, `resolveDoubleDraw`, `bracketPlacements` and
 * `doubleBracketPlacements` each know only their own format, and that stays
 * true: this module does not push a branch down into them. It is the
 * composition root, promoted out of `NonGolfGameView` so the server can share
 * it — picking a strategy is what a composition root is for.
 *
 * ── The bug (Phase 0 F1) ───────────────────────────────────────────────────
 *
 * A double-elimination bracket finalized as SINGLE elimination, and production's
 * one double bracket was posted with 4 of 15 matches undecided.
 *
 * `deriveBracketPlacements` called `resolveDraw` unconditionally.
 * `resolveDraw` handles `main` + `consolation` and DROPS `lower`/`final` rows —
 * documented in its own return line. The completeness gate right after it is
 * `drawComplete(resolved)` = `resolved.every(m => !m.playable)`, so the
 * undecided lower-bracket rows were not in the set it checked: **the guard could
 * not see the matches it exists to check**, returned true, and `bracketPlacements`
 * placed from `main` alone.
 *
 * ── It was TWO duplications, not one ───────────────────────────────────────
 *
 * Fixing the resolver alone yields a quieter wrong build: it would stop
 * finalizing early (good) and still post SINGLE-elim placements (bad), because
 * the server only ever called `bracketPlacements`. So the two dispatches are
 * paired here and both take the DRAW:
 *
 *   resolveAnyDraw(draw, winners)      -> the right resolver
 *   placementsForDraw(draw, resolved)  -> the matching placement rule
 *
 * `placementsForDraw` deliberately takes `draw` rather than an `isDouble` flag.
 * A flag is a second thing to pass correctly, and passing it wrongly is exactly
 * the defect: both re-derive from the same source, so a caller CANNOT pair
 * `resolveDraw` with `doubleBracketPlacements`.
 *
 * ── Why the DRAW decides, not the config ───────────────────────────────────
 *
 * Three call sites derived this, from two different sources: the client read
 * `bracketConfig.elimination` (`NonGolfGameView.tsx:750`), `games.bracketPick`
 * read the draw (`games.ts:698`), and the finalize path asked nothing. Config
 * and draw can disagree — a config edited after the draw was built describes a
 * tree nobody is playing.
 *
 * The persisted structure wins. A config flip cannot retroactively change a tree
 * people are already playing: config BUILDS a draw, it does not INTERPRET one.
 * `games.bracketPick` already reasoned its way here ("the persisted structure is
 * the authority for how it must be resolved, and it cannot disagree with
 * itself"); this makes that the only answer anywhere.
 */

/**
 * Is this a double-elimination draw? THE decider — every reader goes through
 * here.
 *
 * A double draw carries `lower` and `final` rows that a single draw structurally
 * cannot have (`consolation` is single-elim only and can never co-occur with
 * `lower` — glossary). An empty draw is not double; there is no tree to read.
 */
export function isDoubleElimination(draw: readonly BracketDrawMatch[]): boolean {
  return draw.some((m) => m.bracket === "lower" || m.bracket === "final");
}

/** Resolve a draw with the resolver its own structure calls for. */
export function resolveAnyDraw(
  draw: BracketDrawMatch[],
  winners: WinnerBySeed = {},
): ResolvedMatch[] {
  return isDoubleElimination(draw) ? resolveDoubleDraw(draw, winners) : resolveDraw(draw, winners);
}

/**
 * Place a resolved draw with the rule its own structure calls for.
 *
 * Takes the DRAW as well as the resolved rows on purpose — see the header. The
 * resolved set alone would work for a correctly-resolved double draw (it carries
 * the `lower`/`final` rows), but it would ALSO silently accept the rows a
 * single-elim resolver returned for a double draw, which is the wrong build this
 * exists to make unrepresentable.
 */
export function placementsForDraw(
  draw: readonly BracketDrawMatch[],
  resolved: ResolvedMatch[],
): EntrantPlacement[] {
  return isDoubleElimination(draw) ? doubleBracketPlacements(resolved) : bracketPlacements(resolved);
}
