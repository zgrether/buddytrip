/**
 * ONE AWARD DECISION, for the match-slate formats — pure, client-safe, no DB.
 *
 * Who gets a game's points is decided HERE and nowhere else. Before this module
 * there were two answers to that question and they disagreed:
 *
 *   finalize   `tallyMatchAwards` — `if (!aTeam || !bTeam) continue;`
 *   projection `rollupMatchPlay`  — `add = (teamId, n) => { if (teamId) … }`
 *
 * Read them side by side and the gap is one match with ONE unteamed side: the
 * projection credits the side that HAS a team, and the finalize then pays
 * nobody. The board shows a team ahead by that match's value, the game is
 * finalized, and those points are simply not there. Nothing errors. That is the
 * F1 pattern — two implementations of one decision, agreeing until they don't —
 * and `rollupMatchPlay`'s own doc comment claimed the parity it did not have
 * ("exactly as the finish path awards it"), which is how it went unread.
 *
 * ── The rule, stated once ──────────────────────────────────────────────────
 *
 * A match pays only when BOTH sides resolve to a cup team. That is the
 * finalize's existing rule and it is the one kept, deliberately: the cup's pot
 * is divided between cup teams, and a match where one competitor is not on a
 * team is not a contest between them. Aligning the projection to the finalize
 * changes what the BOARD PROMISES; aligning the finalize to the projection
 * would change what a cup PAYS, and that is a product decision rather than a
 * deduplication.
 *
 * The alternative — pay the teamed side, treat the unteamed one as a forfeit
 * against them — is defensible and is NOT what this does. If it is ever wanted,
 * it is one branch here and it moves both surfaces at once, which is the point.
 *
 * ── It has never fired in production ───────────────────────────────────────
 *
 * Measured 2026-09-22: of 79 paired matches across every cup game, ZERO have a
 * side that fails to resolve to a team. So this unification repairs no live
 * number — it removes a divergence that was waiting for the first game with an
 * unassigned player. Said plainly, because "fixes a production bug" would be a
 * more exciting and less true description.
 */

/**
 * What a match has resolved to, from whichever surface is asking.
 *
 * The two callers arrive at this differently and that difference is legitimate:
 * a FINALIZE reads `game_matches.result` (decided, recorded), a PROJECTION reads
 * the current standing ("if today holds"). Both reduce to the same three
 * payable shapes plus "nothing to award yet", which is what lets one rule serve
 * both without either pretending to be the other.
 */
export type MatchOutcome =
  /** Side A takes it. */
  | "a"
  /** Side B takes it. */
  | "b"
  /** Halved — the value splits. */
  | "split"
  /** Undecided, or not started. Contributes nothing and is not a forfeit. */
  | null;

/** One match, reduced to what the award rule needs and nothing else. */
export interface AwardableMatch {
  /** The cup team on each side, already resolved. `null` = not on a cup team. */
  aTeamId: string | null;
  bTeamId: string | null;
  outcome: MatchOutcome;
  /** This match's own value — the per-match override, else the game's even share.
   *  Resolved by the caller, because the even share is derived differently on
   *  each side (a live divisor here, a passed fallback there). */
  value: number;
}

export interface MatchAwardResult {
  /** teamId → points. Only teams that were paid appear. */
  byTeam: Record<string, number>;
  /**
   * Matches that HAD an outcome and still paid nobody, because a side did not
   * resolve to a cup team.
   *
   * Counted rather than silently skipped: "this match paid nothing" and "this
   * match has not been played" are different facts, and a caller that cannot
   * tell them apart is the empty-is-not-unknown mistake one level up from the
   * display. The board uses it to say a game's points are not all in play.
   */
  unpayable: number;
}

/**
 * The award rule itself. Win takes the match's value; a halve splits it; a match
 * with an unresolved side pays nobody and is counted.
 *
 * Deliberately takes resolved team ids rather than a `sideTeam` resolver: the
 * resolution genuinely differs per caller (a server query, a bulk-fetched
 * roster, a client-loaded one) and the arithmetic must not. Keeping the
 * resolver OUT is what makes this testable without a fixture that mimics a
 * database.
 */
export function awardMatches(matches: readonly AwardableMatch[]): MatchAwardResult {
  const byTeam: Record<string, number> = {};
  let unpayable = 0;
  const add = (teamId: string, n: number) => {
    byTeam[teamId] = (byTeam[teamId] ?? 0) + n;
  };

  for (const m of matches) {
    if (m.outcome === null) continue; // nothing decided — not a forfeit
    if (m.aTeamId === null || m.bTeamId === null) {
      unpayable += 1;
      continue;
    }
    if (m.outcome === "a") add(m.aTeamId, m.value);
    else if (m.outcome === "b") add(m.bTeamId, m.value);
    else {
      add(m.aTeamId, m.value / 2);
      add(m.bTeamId, m.value / 2);
    }
  }

  return { byTeam, unpayable };
}
