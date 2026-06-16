// ── Competition access predicate ───────────────────────────────────────────
//
// THE single "can this user access the competition right now?" check. It drives
// two things that must never disagree:
//   - the "Live" bottom-nav entry — shown when this is TRUE
//   - the pre-live "Competition isn't live yet" wall — shown when this is FALSE
// Computing them from one predicate makes the failure mode (nav shows but wall
// also shows, or vice-versa) impossible.
//
// A competition is accessible to its BUILDERS at all times (owner / organizer /
// co-admin via `canEdit`; a game delegate via `amDelegate`) and to EVERYONE once
// it's live (`status === "active"` — go-live is what reveals it to plain crew).
// Callers gate on the competition EXISTING separately (no competition ⇒ nothing
// to access, "Live" hidden for everyone).

export interface CompetitionAccessInput {
  /** Trip Owner/Organizer → competition owner/co-admin. */
  canEdit: boolean;
  /** Delegates any game in the competition (a builder, even if member-role). */
  amDelegate: boolean;
  /** competition.status — "upcoming" | "active" | "completed" (or null). */
  status: string | null | undefined;
}

export function canAccessCompetition({
  canEdit,
  amDelegate,
  status,
}: CompetitionAccessInput): boolean {
  return canEdit || amDelegate || status === "active";
}
