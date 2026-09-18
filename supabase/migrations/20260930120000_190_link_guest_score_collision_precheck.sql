-- 190 — link_guest_to_account refuses a score collision, readably (#1024)
--
-- `merge_guest_to_real_user` moves score rows with a plain
--   UPDATE score_entries SET participant_id = real WHERE participant_id = ghost
-- and `score_entries` is UNIQUE (game_id, participant_id, unit_label). When the
-- placeholder and the account both hold a score for the same hole of the same
-- game, that UPDATE raises 23505 and the whole link rolls back. The owner saw
-- "Failed to link existing account: duplicate key value violates unique
-- constraint score_entries_game_id_participant_id_unit_label_key" as a 500.
--
-- ── Refuse, not pick a winner ────────────────────────────────────────────
--
-- Every other UNIQUE-keyed table in the merge resolves a collision by deleting
-- the guest's losing row (migration 095). That is right for a duplicate vote or
-- a read-marker. It is wrong for a score: two scores for one hole are two
-- records of a round somebody played, and which to keep is a person's call,
-- not the function's. Migration 141 reached the same conclusion for the invite
-- claim and refuses there with a sentence; this makes the owner-link path agree
-- with it, so the two routes into the same state do not disagree about what it
-- means.
--
-- ── Why the wrapper and not the merge ────────────────────────────────────
--
-- Same reasoning as migration 132 §4: the merge is ~300 lines, runs inside the
-- signup trigger, and a mistake in it breaks signup for everyone. Signup cannot
-- reach this collision anyway — `handle_new_user` inserts the real row seconds
-- before merging into it, so the target owns no scores. Only the two callers
-- that merge into an EXISTING account can, and both now refuse before calling
-- it. The merge body is untouched.
--
-- Everything below the new block is migration 132's body, verbatim.
--
-- ── The message ──────────────────────────────────────────────────────────
--
-- Read by the trip OWNER, who can act on it, so it names a next step. It does
-- NOT name the game: through the router the collision is always on ANOTHER
-- trip (ghostCrew.update refuses an account already on this one), which the
-- owner may not be on — a definer function naming it would leak it.
--
-- Raised as unique_violation, matching 141, so `ghostCrew.update` can map it to
-- a CONFLICT. The pre-check guarantees any 23505 from this function is ours.
--
-- Production when written (2026-09-18): 83 placeholders, 1 with an email, none
-- on more than one trip, none whose email matches a real account. Unreached;
-- fixed because it is structurally reachable and the fix is small.

CREATE OR REPLACE FUNCTION public.link_guest_to_account(p_trip_id text, p_ghost_id text, p_real_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF p_ghost_id = p_real_id THEN
    RETURN; -- nothing to merge
  END IF;

  IF NOT public.has_trip_role(p_trip_id, ARRAY['Owner'::text]) THEN
    RAISE EXCEPTION 'Only the trip owner can link a crew member to an account'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.users WHERE id = p_ghost_id AND is_guest = true
  ) THEN
    RAISE EXCEPTION 'Only a placeholder crew member can be linked to an account'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Migration 132. A deleted account is a placeholder in every structural
  -- sense, so the is_guest check above admits it; only `deleted_at` can tell
  -- the two apart.
  IF EXISTS (
    SELECT 1 FROM public.users WHERE id = p_ghost_id AND deleted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'That person deleted their account. Their history cannot be reattached to a new one.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- The guest must belong to THIS trip. Call this BEFORE repointing
  -- trip_members, or the check has nothing left to find.
  IF NOT EXISTS (
    SELECT 1 FROM public.trip_members
     WHERE trip_id = p_trip_id AND user_id = p_ghost_id
  ) THEN
    RAISE EXCEPTION 'That placeholder is not on this trip'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_real_id) THEN
    RAISE EXCEPTION 'Target account not found' USING ERRCODE = 'check_violation';
  END IF;

  -- Migration 190 (#1024). The same predicate as 141's claim pre-check.
  IF EXISTS (
    SELECT 1
    FROM public.score_entries g
    JOIN public.score_entries r
      ON r.game_id = g.game_id
     AND r.unit_label = g.unit_label
     AND r.participant_id = p_real_id
     AND r.participant_type = 'user'
    WHERE g.participant_id = p_ghost_id
      AND g.participant_type = 'user'
  ) THEN
    RAISE EXCEPTION 'This placeholder and that account both have a score for the same hole in a game, so linking them would mean throwing one of those rounds away. Keep them as separate crew members, or have the duplicate scores removed from that game and link again.'
      USING ERRCODE = 'unique_violation';
  END IF;

  PERFORM public.merge_guest_to_real_user(p_ghost_id, p_real_id);
END;
$function$;
