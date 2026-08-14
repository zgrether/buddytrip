import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * What has to be cleared when someone LEAVES a trip, beyond the membership row.
 *
 * ── The bug this exists for ────────────────────────────────────────────────
 * Removing someone deleted their `trip_members` row and nothing else, so their
 * cup `team_assignments` stayed behind. The result is two surfaces disagreeing
 * about one team: anything reading `team_assignments` directly still counted
 * them, while the bracket's field picker — which intersects assignments with the
 * trip CREW — did not. Found as "The Field shows Manhattans with 6 players" when
 * the roster said 8; there were 4 such orphans in production, all guests removed
 * from a trip they still held a cup assignment in.
 *
 * Same shape as #882's participant-row zombies: a removal that clears everything
 * about someone except their membership in a related table.
 *
 * ── Why this is a shared helper and NOT a DELETE trigger ───────────────────
 * A trigger on `trip_members` would cover every writer at once, including any
 * future one, which is the better instinct in general and is WRONG here.
 * `merge_guest_to_real_user` deletes a `trip_members` row as collision
 * resolution — when a guest and their real account are both on a trip — and it
 * does that near the TOP of the function (offset ~422 of the definition), while
 * it repoints `team_assignments` much later (~4646). A trigger would therefore
 * fire during the merge and delete the guest's assignments before the merge
 * reached the line that hands them to the real account. Signup would silently
 * drop the new user's cup team.
 *
 * So the merge is deliberately NOT covered here: it already handles
 * `team_assignments` correctly, including the PK collision (it deletes the
 * guest's losing row, then repoints the rest). Covering it twice is what would
 * break it.
 *
 * **Any NEW path that deletes a `trip_members` row must call this.** The two
 * that exist — `tripMembers.remove` and `ghostCrew.remove` — both do. That is
 * the whole writer set as of migration 120; `merge_guest_to_real_user` is the
 * third writer and is exempt for the reason above.
 */

/**
 * Drop every cup team assignment this person holds in this trip's competitions.
 *
 * Scoped to the TRIP, never to the person globally: someone removed from one
 * trip keeps their teams in every other trip they are still on. The two-step
 * (read the trip's competition ids, then delete by them) is PostgREST's shape
 * for what would be one statement with a subquery; there is no correctness
 * difference, because a competition cannot move between trips.
 *
 * Best-effort by design, like the orphan-guest cleanup beside it: the removal
 * the owner already saw succeed must not fail because the tidy-up did. A failure
 * leaves exactly the orphan this function exists to prevent, which is the state
 * we were already in — not a worse one.
 */
export async function clearTripTeamAssignments(
  supabase: SupabaseClient,
  tripId: string,
  userId: string
): Promise<void> {
  const { data: competitions } = await supabase
    .from("competitions")
    .select("id")
    .eq("trip_id", tripId);

  const competitionIds = ((competitions ?? []) as { id: string }[]).map((c) => c.id);
  if (competitionIds.length === 0) return;

  await supabase
    .from("team_assignments")
    .delete()
    .eq("user_id", userId)
    .in("competition_id", competitionIds);
}
