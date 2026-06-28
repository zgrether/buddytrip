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

/** A side-pairing — the only fields the readiness rule needs. */
export interface MatchSides {
  a: string[];
  b: string[];
}

/** True when both sides carry exactly `playersPerSide` players. */
export function isMatchFilled(match: MatchSides, playersPerSide: number): boolean {
  return match.a.length === playersPerSide && match.b.length === playersPerSide;
}

/** The filled subset — the matches that would actually be created/scored. */
export function filledMatches<M extends MatchSides>(draft: M[], playersPerSide: number): M[] {
  return draft.filter((m) => isMatchFilled(m, playersPerSide));
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
export function allMatchesFilled(draft: MatchSides[], playersPerSide: number): boolean {
  return matchPlayReady(filledMatches(draft, playersPerSide).length, draft.length);
}
