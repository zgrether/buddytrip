-- ════════════════════════════════════════════════════════════════════════════
-- 120 · Clear cup team assignments left behind by a trip removal
--
-- Found as "The Field shows Manhattans with 6 players" when the cup roster said
-- 8. Both numbers were faithful to their own query: the bracket's field picker
-- intersects `team_assignments` with the trip CREW, while anything reading
-- assignments directly does not. The difference was two people holding a team
-- assignment for a trip they were no longer a member of.
--
-- ── The leak, now closed in the app ────────────────────────────────────────
-- `tripMembers.remove` and `ghostCrew.remove` deleted the `trip_members` row and
-- nothing else. Both now call `clearTripTeamAssignments` (src/server/lib/
-- leaveTrip.ts). This migration cleans what they already stranded.
--
-- Same shape as #882's participant-row zombies: a removal clearing everything
-- about someone except their membership in a related table.
--
-- ── Why this is NOT a trigger ──────────────────────────────────────────────
-- A `BEFORE/AFTER DELETE ON trip_members` trigger would cover every writer at
-- once, which is the better instinct in general and is WRONG here.
-- `merge_guest_to_real_user` deletes a `trip_members` row as PK-collision
-- resolution near the top of its body, and repoints `team_assignments`
-- thousands of characters later. A trigger would therefore fire mid-merge and
-- delete the guest's assignments before the merge reached the line that hands
-- them to the real account — silently dropping a new user's cup team at signup.
--
-- So the merge is deliberately exempt: it already handles `team_assignments`
-- correctly, collision included. Covering it twice is what would break it.
--
-- ── Replay-safe (the #636 rule) ────────────────────────────────────────────
-- Keyed on the orphan CONDITION, never on the ids of the four rows found in
-- production. On a fresh database this matches nothing and is a no-op, which is
-- what makes it replayable from zero; on production it removed exactly the rows
-- whose owner is not a member of the competition's trip.
-- ════════════════════════════════════════════════════════════════════════════

DELETE FROM public.team_assignments ta
USING public.competitions c
WHERE c.id = ta.competition_id
  AND NOT EXISTS (
    SELECT 1
    FROM public.trip_members tm
    WHERE tm.trip_id = c.trip_id
      AND tm.user_id = ta.user_id
  );
