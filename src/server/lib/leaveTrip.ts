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

/**
 * Take them out of this trip's GAMES: vacate any match seat they hold, and drop
 * their `game_participants` rows.
 *
 * ── The bug this exists for (#1013) ────────────────────────────────────────
 * Removal deleted `trip_members` and cleared `team_assignments`, and stopped
 * there. `game_matches.side_a/side_b` still pointed at them, so the seat kept
 * rendering — as `"Player"`, because names resolve through `tripMembers.list`
 * and they are no longer on it. The seat looked like a person nobody could act
 * on: not assignable, not clearable, not anybody.
 *
 * This is the same removal-that-clears-everything-but-one-table shape as
 * `clearTripTeamAssignments` above and #882's participant zombies, arriving for
 * the third time through a third table.
 *
 * ── Why VACATE rather than tombstone ───────────────────────────────────────
 * An unfilled seat is a state the game already has and already renders: matches
 * sit empty through the whole of setup, `setPairings` writes `null` sides on
 * purpose, and `assignPlayer` vacates a seat every time it moves someone. So
 * there is nothing to invent — the seat goes back to the state it was in before
 * anyone was put in it. Readiness is DERIVED (`isConfigured` recomputes
 * `paired === total` on every read), so the game returns to Setting-up with no
 * state written anywhere.
 *
 * ── Why a USER side and not a doubles side ─────────────────────────────────
 * A 1v1 seat IS the person, so it empties. A 2v2 seat is a `play_group` SHARED
 * with their partner — emptying it would remove the partner too, from a match
 * they are still in. Their membership of that group is the `game_participants`
 * row, so deleting the row below is what takes them out of the pair, and the
 * side survives with its remaining member. Both cases are handled by the same
 * two steps; only one of them touches the JSONB.
 *
 * ── The order is load-bearing ──────────────────────────────────────────────
 * Seats first, participant rows second. The participant row is what makes a
 * person a member of a doubles side; delete it first and a `play_group` side
 * can no longer be resolved to them at all.
 *
 * Best-effort, exactly like `clearTripTeamAssignments`: the removal the owner
 * already watched succeed must not fail because the tidy-up did, and a failure
 * leaves the state we were already in rather than a worse one.
 *
 * NOTE this runs only AFTER `findContributionBlockers` has passed, which is what
 * makes it safe. A match with a recorded result — scores, hole outcomes, a
 * decided status — refuses the removal outright, so a seat is never vacated out
 * from under a result. That guard is the precondition for this function, not a
 * separate concern.
 */
export async function vacateTripGameSeats(
  supabase: SupabaseClient,
  tripId: string,
  userId: string
): Promise<void> {
  const { data: games } = await supabase.from("games").select("id").eq("trip_id", tripId);
  const gameIds = ((games ?? []) as { id: string }[]).map((g) => g.id);
  if (gameIds.length === 0) return;

  type Side = { type?: string; id?: string } | null;
  const { data: matches } = await supabase
    .from("game_matches")
    .select("id, game_id, side_a, side_b")
    .in("game_id", gameIds);

  for (const m of (matches ?? []) as { id: string; game_id: string; side_a: Side; side_b: Side }[]) {
    const onA = m.side_a?.id === userId;
    const onB = m.side_b?.id === userId;
    if (!onA && !onB) continue;

    await supabase
      .from("game_matches")
      .update(onA ? { side_a: null } : { side_b: null })
      .eq("id", m.id);

    // A match-play handicap is RELATIVE — `setHandicap` gives one side the
    // strokes and zeroes the other — so the survivor's number was set against
    // the person who just left and means nothing without them. `assignPlayer`
    // already clears both sides' handicaps whenever it vacates a match; this is
    // the same clean-up for the same reason. The handicap's home follows the
    // side's type: a user side keeps it on `game_participants`, a doubles side
    // on `play_groups`.
    const other = onA ? m.side_b : m.side_a;
    if (other?.id) {
      if (other.type === "play_group") {
        await supabase
          .from("play_groups")
          .update({ handicap_strokes: null })
          .eq("id", other.id)
          .eq("game_id", m.game_id);
      } else {
        await supabase
          .from("game_participants")
          .update({ handicap_strokes: null })
          .eq("game_id", m.game_id)
          .eq("user_id", other.id);
      }
    }
  }

  await supabase.from("game_participants").delete().eq("user_id", userId).in("game_id", gameIds);
}

/**
 * Everything leaving a trip clears beyond the membership row — the ONE entry
 * point both removal paths call.
 *
 * The umbrella exists so the next table is added in one place instead of two.
 * `team_assignments` was found missing from both paths once (#120) and
 * `game_participants` from both paths again (#951/#1013); each time the fix had
 * to be made twice and could have been made once. Two call sites that must
 * always agree is the shape CLAUDE.md #22 names — the delta between them IS the
 * bug — so there is now no delta to have.
 *
 * **Any new path that deletes a `trip_members` row must call this**, and the
 * source guard in `leaveTripAssignments.test.ts` fails the build if one doesn't.
 * `merge_guest_to_real_user` stays exempt for the reason given above.
 */
export async function clearTripParticipation(
  supabase: SupabaseClient,
  tripId: string,
  userId: string
): Promise<void> {
  await clearTripTeamAssignments(supabase, tripId, userId);
  await vacateTripGameSeats(supabase, tripId, userId);
}
