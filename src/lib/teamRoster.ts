/**
 * Team-roster integrity predicates (team-identity Phase 0 → PR 1) — PURE, client-safe.
 *
 * The KEYSTONE both the config readiness verdict (this PR) and the leaderboard
 * degraded-state detection (PR 3) derive from. Built once, in a shared home so the
 * setup page AND the server leaderboard import the SAME rule.
 *
 * Distinct from the slot-filled readiness predicates in `matchDraft.ts`: those ask
 * "are the slots FILLED?"; THESE ask "are the filled slots' players still on TEAMS?"
 * — two different questions, never merged. The decided rule: in a (2-team)
 * competition, match-play players are picked FROM teams, so a paired participant
 * with no team is a roster-integrity break even though the match's SLOTS are full
 * (the dropped-after-paired case). Standalone match play has no teams → N/A.
 *
 * Identity is the PERSON's roster (`team_assignments`), never the screen slot.
 */

/** The set of users who currently have a team (one entry per `team_assignments` row). */
export function teamedUserIdSet(assignments: ReadonlyArray<{ user_id: string }>): Set<string> {
  return new Set(assignments.map((a) => a.user_id));
}

/**
 * Does every player on a side currently have a team? Intended for a FILLED side; an
 * empty side is vacuously true, so gate on "filled" via `matchRosterValid` rather
 * than reading this directly for an unfilled side.
 */
export function sideHasTeam(memberIds: ReadonlyArray<string>, teamed: ReadonlySet<string>): boolean {
  return memberIds.every((id) => teamed.has(id));
}

/**
 * Is a match roster-valid — both FILLED sides fully teamed? An UNFILLED match is
 * "not applicable" → returns true, so this never double-flags the slot-filled gap
 * (that's `matchDraft`'s job). It ONLY catches a fully-paired side whose player has
 * since lost their team. `playersPerSide` = 1 (singles) / 2 (2v2).
 */
export function matchRosterValid(
  a: ReadonlyArray<string>,
  b: ReadonlyArray<string>,
  playersPerSide: number,
  teamed: ReadonlySet<string>,
): boolean {
  const filled = a.length === playersPerSide && b.length === playersPerSide;
  if (!filled) return true; // unfilled is slot-filling's concern, not roster's
  return sideHasTeam(a, teamed) && sideHasTeam(b, teamed);
}
