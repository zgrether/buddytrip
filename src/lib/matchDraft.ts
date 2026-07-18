/**
 * Pure, client-safe predicates for the match-setup draft (W-GAMEPAGE-01 §6.1/§7).
 *
 * The setup face builds matches one at a time (build-as-you-go) and HARD-BLOCKS
 * "Enable scoring" until every match is fully paired. The gate is derived, not
 * snapshotted — it recomputes on every roster edit — so the rule lives here as a
 * pure function the page and its tests share (no React/tRPC/DB deps).
 *
 * A "side" holds exactly `playersPerSide` member ids (1 for singles, 2 for 2v2).
 * A match is FILLED when both sides are at full strength; an empty or half-filled
 * slot is an unfinished add, not a quiet drop.
 */

/** A side-pairing — the only fields the readiness rule needs. `playersPerSide` is
 *  the match's own shape (1 = 1v1, 2 = 2v2), so a mixed game's readiness is judged
 *  per match, not off an ambient game-level flag (Refactor A2a). */
export interface MatchSides {
  playersPerSide: 1 | 2;
  a: string[];
  b: string[];
}

/**
 * The "×" action on the setup draft (Matches panel): REMOVE the match at `index`.
 * 0 matches is now a VALID empty state — the table hides and only "Add match"
 * shows — so the last match is deletable (no floor-clamp). The server allows an
 * empty match list (`setPairings`/`setDoublesPairings` `.min(0)`, `removeMatch`
 * with no ≥1 throw). Pure — returns a new draft, never mutates.
 */
export function removeMatchRow<M extends MatchSides>(draft: M[], index: number): M[] {
  return draft.filter((_, j) => j !== index);
}

/** True when both sides carry exactly the match's own `playersPerSide` players. */
export function isMatchFilled(match: MatchSides): boolean {
  return match.a.length === match.playersPerSide && match.b.length === match.playersPerSide;
}

/** The filled subset — the matches that would actually be created/scored. */
export function filledMatches<M extends MatchSides>(draft: M[]): M[] {
  return draft.filter((m) => isMatchFilled(m));
}

/**
 * Does ≥1 valid (fully-paired) match exist? (Readiness rework P3 — the downstream
 * gate.) Points / Handicaps / Modifiers mean nothing before there's a match to
 * apply them to, so they stay LOCKED until this is true. This is the ONE "a match
 * exists" definition the setup rows share — distinct from `matchPlayReady` (which
 * needs ALL matches paired, the stricter Enable bar). A seeded-but-empty match
 * does NOT count.
 *
 * ⚠ P-C seam: P-C adds "Points > 0 joins the Enable gate." That's a *separate*
 * predicate on the Points value — it does NOT change THIS match-existence gate.
 * Keep them apart: P3 = "can the row be edited at all"; P-C = "does the Enable
 * button light up."
 */
export function hasValidMatch(draft: MatchSides[]): boolean {
  return filledMatches(draft).length > 0;
}

/**
 * The ONE match-play readiness threshold (readiness rework P1b). A match game is
 * ready ⟺ it has ≥1 match AND **every** match is paired — `paired === total`, no
 * empty slots. Both surfaces consume THIS so they can't drift: the setup-page
 * Enable gate (via `allMatchesFilled`, over the client draft) and the server
 * `isConfigured` (over `game_matches` rows). Before this, setup demanded all-paired
 * while the list called ≥1-paired "ready" — a 3/5 game read "ready" on the list but
 * "can't enable" on setup. Now list-ready ⟺ setup-can-enable.
 */
export function matchPlayReady(pairedCount: number, totalCount: number): boolean {
  return totalCount > 0 && pairedCount === totalCount;
}

/**
 * The Enable-scoring gate: at least one match AND every match fully paired. An
 * empty draft is NOT ready (nothing to score); a draft with any unfilled slot is
 * NOT ready (the hard block — no silent collapse to the filled count). Delegates
 * to `matchPlayReady` so the threshold is shared with the server, not duplicated.
 */
export function allMatchesFilled(draft: MatchSides[]): boolean {
  return matchPlayReady(filledMatches(draft).length, draft.length);
}

/** A server match side: one user (1v1), one play_group (2v2), or an empty slot. */
export type ServerSide = { type: "user" | "play_group"; id: string } | null;

/**
 * The member user-ids on a server match side, resolved from the side's OWN `type`
 * — NOT an ambient singles/doubles flag. A `user` side is that one user; a
 * `play_group` side (2v2) expands to its members via the play_group→members map.
 *
 * Keying on the side's type keeps the setup re-seed correct even in the window
 * before the game row (which carries the format) has loaded: `matches.listByGame`
 * and `games.getById` are separate queries, so on a fresh reopen matches can land
 * first, when the page's `sided` flag is still its pre-load fallback (false). The
 * old `sided ? members : [id]` rebuilt a doubles side as a lone "user" whose id was
 * actually the play_group id — the match then read as unfilled and silently
 * vanished on reopen. The side already tells us what it is; trust it.
 */
export function sideMemberIds(side: ServerSide, membersOfSide: Map<string, string[]>): string[] {
  if (!side?.id) return [];
  return side.type === "play_group" ? (membersOfSide.get(side.id) ?? []) : [side.id];
}

/**
 * The POINTS term of the Enable gate (W-GAMEPAGE Phase C / P-C). A match game can't
 * Enable scoring at 0 points-per-match — there's nothing to award — so points > 0
 * joins all-matches-paired in the gate. This is the SAME truth the Points row reads
 * for its resolved/empty state (`GameSetupRows`), so the row and the gate can't
 * disagree: points > 0 ⟺ Points row resolved ⟺ this term satisfied. Kept separate
 * from `matchPlayReady` (the server shares that for `isConfigured`) — this is a
 * client-gate extension of the family, not a change to the shared pairing threshold.
 */
export function pointsReady(pointsPerMatch: number): boolean {
  return pointsPerMatch > 0;
}
