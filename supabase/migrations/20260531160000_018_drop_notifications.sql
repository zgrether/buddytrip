-- Migration 018 — drop the notifications feature
--
-- Removes the in-app notification center entirely: the notification_events /
-- notification_reads tables (CASCADE also drops their RLS policies, indexes,
-- FKs, and removes notification_events from the supabase_realtime
-- publication), plus the now-unused date_polls.notify_sent column.
--
-- The merge_guest_to_real_user() function is redefined without its two
-- notification UPDATE statements, since those tables no longer exist.

DROP TABLE IF EXISTS public.notification_reads CASCADE;
DROP TABLE IF EXISTS public.notification_events CASCADE;

ALTER TABLE public.date_polls DROP COLUMN IF EXISTS notify_sent;

-- Redefine merge_guest_to_real_user() without the notification_reads /
-- notification_events UPDATE lines. The remaining body matches migration 001
-- exactly (including the historical references to already-dropped tables,
-- which stay harmless because plpgsql bodies aren't validated until runtime).
CREATE OR REPLACE FUNCTION public.merge_guest_to_real_user(p_ghost_id text, p_real_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  UPDATE public.trip_members       SET user_id         = p_real_id WHERE user_id         = p_ghost_id;
  UPDATE public.team_assignments   SET user_id         = p_real_id WHERE user_id         = p_ghost_id;
  UPDATE public.players            SET user_id         = p_real_id WHERE user_id         = p_ghost_id;
  UPDATE public.player_hole_scores SET player_id       = p_real_id WHERE player_id       = p_ghost_id;
  UPDATE public.idea_votes         SET user_id         = p_real_id WHERE user_id         = p_ghost_id;
  UPDATE public.idea_comments      SET user_id         = p_real_id WHERE user_id         = p_ghost_id;
  UPDATE public.date_poll_votes    SET user_id         = p_real_id WHERE user_id         = p_ghost_id;
  UPDATE public.expense_splits     SET user_id         = p_real_id WHERE user_id         = p_ghost_id;
  UPDATE public.messages           SET user_id         = p_real_id WHERE user_id         = p_ghost_id;
  UPDATE public.expenses           SET paid_by_user_id = p_real_id WHERE paid_by_user_id = p_ghost_id;
  UPDATE public.rounds             SET closed_by       = p_real_id WHERE closed_by       = p_ghost_id;
  UPDATE public.scoreboard_shares  SET created_by      = p_real_id WHERE created_by      = p_ghost_id;
  UPDATE public.quick_info_tiles   SET created_by      = p_real_id WHERE created_by      = p_ghost_id;
  UPDATE public.group_results      SET submitted_by    = p_real_id WHERE submitted_by    = p_ghost_id;
  UPDATE public.series             SET owner_id        = p_real_id WHERE owner_id        = p_ghost_id;
  UPDATE public.trips              SET owner_id        = p_real_id WHERE owner_id        = p_ghost_id;
  UPDATE public.users              SET created_by      = p_real_id WHERE created_by      = p_ghost_id;
  UPDATE public.invites            SET created_by      = p_real_id WHERE created_by      = p_ghost_id;
  DELETE FROM public.users WHERE id = p_ghost_id AND is_guest = true;
END;
$function$;
