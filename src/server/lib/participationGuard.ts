import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The "don't orphan a participant" guard (#951).
 *
 * Removing someone from a trip deletes their `trip_members` row and nothing
 * else. Every scoring table keys to `users`, not to `trip_members`, so nothing
 * cascades and nothing errors — the removal is a SILENT SUCCESS that leaves
 * their participation behind. It surfaces later as a scorecard row reading
 * "Player", because names resolve from `tripMembers.list` while ids come from
 * `game_participants` (#952 owns that string; it is currently the only thing
 * that makes this class visible at all).
 *
 * ── Why ONE guard rather than a cascade per table ──────────────────────────
 * It is not one table. A removal today orphans:
 *
 *   game_participants.user_id          score_entries.participant_id
 *   score_entries.submitted_by         game_results.entity_id
 *   game_delegates.user_id/.granted_by match_hole_outcomes.submitted_by
 *   bracket_entrant_members.user_id    game_matches.side_a / .side_b  (JSONB)
 *
 * `team_assignments` is the only one currently cleared (`clearTripTeamAssignments`).
 *
 * The last entry is why "add the missing cascades" is not merely unattractive
 * but IMPOSSIBLE: `game_matches.side_a/side_b` hold `{type,id}` inside JSONB,
 * which cannot be an FK and therefore cannot cascade. One guard on the removal
 * is the only shape available. (Same JSONB blind spot CLAUDE.md's merge rule
 * already warns about — a column-name audit cannot see it.)
 *
 * ── Why this one is APPLICATION-layer, unlike #824's and #957's guards ─────
 * Three guards now sit at three layers, and the criterion that separates them
 * is whether bypassing the app GAINS the actor something:
 *
 *   #824 role trigger (DB)   an Organizer setting their own role to Owner
 *                            gains a privilege. The app is the only thing in
 *                            the way, so the check cannot live there.
 *   #957/#123 Owner-row (DB) removing the Owner strands the trip for everyone
 *                            in a state nobody can recover through the app.
 *   THIS ONE (app)           the actor is ALREADY entitled to delete the row.
 *                            Bypassing gains nothing; the consequence is a mess
 *                            on their own trip, and it is recoverable — the
 *                            codebase already has a verb for moving a person's
 *                            history (`merge_guest_to_real_user` repoints).
 *
 * DB hardening is deliberately deferred (see the issue): a BEFORE DELETE
 * trigger on `trip_members` is exactly what broke production in migration 123,
 * and it would have to be threaded past the trip-cascade path AND the merge's
 * collision delete. Bad trade three weeks out, against a threat that requires
 * deliberately bypassing your own UI to corrupt your own trip.
 */

export interface ParticipationBlocker {
  gameId: string;
  gameName: string;
  /** Real per-hole scores exist. This is the half that is irreplaceable. */
  hasScores: boolean;
}

/**
 * Games in `tripId` where `userId` is still a participant or has scores.
 *
 * Empty array = removing them is clean, which is the common case (10 of 16 on
 * the trip of record). Both signals are checked because they can diverge: a
 * score row can outlive its participant row, and it is the half holding data
 * that cannot be re-derived.
 */
export async function findParticipationBlockers(
  supabase: SupabaseClient,
  tripId: string,
  userId: string
): Promise<ParticipationBlocker[]> {
  const { data: games, error: gamesErr } = await supabase
    .from("games")
    .select("id, name")
    .eq("trip_id", tripId);
  if (gamesErr) throw new Error(`Failed to read the trip's games: ${gamesErr.message}`);

  const gameIds = (games ?? []).map((g) => g.id as string);
  if (gameIds.length === 0) return [];

  const [parts, scores] = await Promise.all([
    supabase.from("game_participants").select("game_id").eq("user_id", userId).in("game_id", gameIds),
    supabase
      .from("score_entries")
      .select("game_id")
      .eq("participant_id", userId)
      .eq("participant_type", "user")
      .in("game_id", gameIds),
  ]);
  if (parts.error) throw new Error(`Failed to read game participants: ${parts.error.message}`);
  if (scores.error) throw new Error(`Failed to read score entries: ${scores.error.message}`);

  const scored = new Set((scores.data ?? []).map((r) => r.game_id as string));
  const involved = new Set<string>([
    ...(parts.data ?? []).map((r) => r.game_id as string),
    ...scored,
  ]);
  if (involved.size === 0) return [];

  const nameOf = new Map((games ?? []).map((g) => [g.id as string, (g.name as string | null) ?? "Untitled game"]));
  return [...involved].map((gameId) => ({
    gameId,
    gameName: nameOf.get(gameId) ?? "Untitled game",
    hasScores: scored.has(gameId),
  }));
}

/**
 * The refusal message.
 *
 * Names the games, because ~40% of a real roster is in the blocked case and a
 * message that just says "no" would be hit often enough to be infuriating. It
 * points at the DOCUMENTED workaround (`GAME_FORMATS.md`: enter a score for
 * anyone who can't play, so the field stays complete) rather than leaving the
 * person stuck — there is no withdrawal feature yet, and this refusal exists
 * precisely so that one can be designed properly later
 * (`DEFERRED.md` — Withdrawn status: scores preserved, excluded from ranking).
 */
export function participationRefusalMessage(
  displayName: string,
  blockers: ParticipationBlocker[]
): string {
  const names = blockers.slice(0, 3).map((b) => `"${b.gameName}"`);
  const rest = blockers.length - names.length;
  const list = rest > 0 ? `${names.join(", ")} and ${rest} more` : names.join(", ");
  const scored = blockers.filter((b) => b.hasScores).length;
  const total = blockers.length;
  const g = (n: number) => `${n} game${n > 1 ? "s" : ""}`;

  // The count and the LIST must describe the same set. Found by looking at the
  // rendered panel: an earlier version said "has scores in 1 game" and then
  // named two, because the count came from the scored subset while the list
  // came from all blockers. ~40% of a real roster reaches this message, so a
  // sentence that contradicts the list under it is not a cosmetic problem.
  const what =
    scored === 0
      ? `is playing in ${g(total)}`
      : scored === total
        ? `has scores in ${total > 1 ? "all " : ""}${g(total)}`
        : `is playing in ${g(total)}, with scores in ${scored}`;

  return (
    `${displayName} ${what}: ${list}. Removing them now would leave those scores ` +
    `attached to someone no longer on the trip, and the scorecard would stop showing their name. ` +
    `Enter a score for them if they can't play, or leave them on the roster.`
  );
}
