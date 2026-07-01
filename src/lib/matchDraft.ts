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

/** True when both sides carry exactly `playersPerSide` players. */
export function isMatchFilled(match: MatchSides, playersPerSide: number): boolean {
  return match.a.length === playersPerSide && match.b.length === playersPerSide;
}

/** The filled subset — the matches that would actually be created/scored. */
export function filledMatches<M extends MatchSides>(draft: M[], playersPerSide: number): M[] {
  return draft.filter((m) => isMatchFilled(m, playersPerSide));
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
export function hasValidMatch(draft: MatchSides[], playersPerSide: number): boolean {
  return filledMatches(draft, playersPerSide).length > 0;
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

/**
 * Which accordion row is expanded on the settings overlay (page-owned). The two
 * "draft editor" rows (matches/handicaps) persist their client draft on collapse;
 * the rest either persist another way (modifiers) or need no flush.
 */
export type SettingsRow =
  | "matches"
  | "handicaps"
  | "players"
  | "course"
  | "config"
  | "modifiers"
  | null;

/** The persist to run when the settings overlay CLOSES with a row still open. */
export type CloseFlush = "draft" | "modifiers" | null;

/**
 * Persist-on-CLOSE decision (companion to the accordion's persist-on-collapse).
 * The accordion only commits a draft editor when the OPEN ROW changes; closing
 * the whole settings overlay with a row still expanded — the common "assign the
 * matches → tap Back" path — bypassed that commit, so the just-entered pairings
 * were dropped and reopening the game showed no matches. This is the pure core of
 * the close handler: given the open row and whether the draft was actually edited,
 * say which persist (if any) the overlay-close must fire.
 *
 * - matches/handicaps → "draft" (the pairings/handicaps write) — but ONLY when the
 *   draft was touched, so an opened-but-untouched row closing writes nothing (a
 *   `setPairings` clean-replace would needlessly churn match rows otherwise).
 * - modifiers → "modifiers" (a single idempotent `games.update`).
 * - everything else (course/config/players, or no open row) → null.
 */
export function flushOnOverlayClose(openRow: SettingsRow, draftTouched: boolean): CloseFlush {
  if ((openRow === "matches" || openRow === "handicaps") && draftTouched) return "draft";
  if (openRow === "modifiers") return "modifiers";
  return null;
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
