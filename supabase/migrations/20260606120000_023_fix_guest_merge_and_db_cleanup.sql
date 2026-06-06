-- 023 — Fix the guest→real-user merge (launch-blocking) + pre-launch DB cleanup
--
-- All statements are idempotent and transaction-safe (no CONCURRENTLY), so
-- `supabase db push` applies this cleanly. Index work here is on tiny tables
-- (and the DB is reset before launch), so a plain CREATE INDEX is instantaneous;
-- larger/live indexes in the competition build will be applied CONCURRENTLY
-- out-of-band (CONCURRENTLY can't run inside the transaction db push wraps each
-- migration in).

-- ── 1. CRITICAL: fix merge_guest_to_real_user ──────────────────────────────
-- This runs from handle_new_user() (the on_auth_user_created signup trigger)
-- whenever someone signs up with an email that matches an existing guest
-- (placeholder) row. The previous body referenced six tables dropped in the
-- squash/refactors (players, player_hole_scores, idea_comments, rounds,
-- scoreboard_shares, group_results) and a non-existent trips.owner_id column,
-- so the conversion raised "relation does not exist" and the entire signup
-- rolled back. Rewritten to reassign only the guest-owned rows that exist in
-- the current schema. Ownership lives in trip_members (role='Owner'), not a
-- trips.owner_id column, so that line is gone.
CREATE OR REPLACE FUNCTION public.merge_guest_to_real_user(p_ghost_id text, p_real_id text)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
AS $function$
BEGIN
  UPDATE public.trip_members     SET user_id         = p_real_id WHERE user_id         = p_ghost_id;
  UPDATE public.team_assignments SET user_id         = p_real_id WHERE user_id         = p_ghost_id;
  UPDATE public.idea_votes       SET user_id         = p_real_id WHERE user_id         = p_ghost_id;
  UPDATE public.date_poll_votes  SET user_id         = p_real_id WHERE user_id         = p_ghost_id;
  UPDATE public.expense_splits   SET user_id         = p_real_id WHERE user_id         = p_ghost_id;
  UPDATE public.messages         SET user_id         = p_real_id WHERE user_id         = p_ghost_id;
  UPDATE public.expenses         SET paid_by_user_id = p_real_id WHERE paid_by_user_id = p_ghost_id;
  UPDATE public.quick_info_tiles SET created_by      = p_real_id WHERE created_by      = p_ghost_id;
  UPDATE public.series           SET owner_id        = p_real_id WHERE owner_id        = p_ghost_id;
  UPDATE public.users            SET created_by      = p_real_id WHERE created_by      = p_ghost_id;
  UPDATE public.invites          SET created_by      = p_real_id WHERE created_by      = p_ghost_id;
  DELETE FROM public.users WHERE id = p_ghost_id AND is_guest = true;
END;
$function$;

-- ── 2. Drop duplicate indexes (redundant with the UNIQUE-constraint index) ──
DROP INDEX IF EXISTS public.invites_token_idx;       -- dup of invites_token_key (unique)
DROP INDEX IF EXISTS public.idx_users_email;         -- dup of users_email_key (unique)
DROP INDEX IF EXISTS public.idx_golf_courses_place_id; -- dup of golf_courses_place_id_key (unique)

-- ── 3. Index the messages.user_id foreign key (unindexed, grows fastest) ────
CREATE INDEX IF NOT EXISTS idx_messages_user_id ON public.messages (user_id);

-- ── 4. Drop verified-dead columns ──────────────────────────────────────────
-- travel_plans_crew_visible: only ever declared in a TS type, never read/written.
-- events.modifiers: never selected, inserted, or read anywhere in the app.
-- (NB: trips.comparison_mode and trips.itinerary_enabled are NOT dropped —
--  comparison_mode is read in page.tsx/TripCard; itinerary_enabled is read by
--  HomeTab→ItineraryPanel. Both are still live reads.)
ALTER TABLE public.trips  DROP COLUMN IF EXISTS travel_plans_crew_visible;
ALTER TABLE public.events DROP COLUMN IF EXISTS modifiers;
