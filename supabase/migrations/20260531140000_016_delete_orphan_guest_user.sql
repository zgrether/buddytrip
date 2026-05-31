-- 016: delete_orphan_guest_user — free a removed guest's email for reuse
--
-- A guest is just a trip-scoped placeholder in public.users (is_guest = true).
-- When a guest is removed from their last trip, the old behavior left the
-- users row behind forever. Because users.email is UNIQUE, re-adding the same
-- email later silently resolved back to the stale guest (with its old name)
-- instead of honoring the freshly-typed name — the "ghost name returns from
-- the dead" bug.
--
-- RLS blocks the Owner's user-scoped client from DELETEing a users row, so the
-- cleanup runs through this SECURITY DEFINER function (mirroring
-- merge_guest_to_real_user / increment_member_email_count). It is deliberately
-- conservative:
--   • Only deletes guests (is_guest = true) — real BT accounts are untouched.
--   • Only when the guest has zero trip_members rows (orphaned everywhere).
--   • Catches foreign_key_violation: a guest who actually participated has
--     expense/score rows with ON DELETE RESTRICT, so their row is kept.
--
-- Callable by authenticated; the only caller is the Owner-gated
-- ghostCrew.remove handler, and the function can only ever touch already-
-- orphaned guests, so broad EXECUTE is safe.

CREATE OR REPLACE FUNCTION public.delete_orphan_guest_user(p_user_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  DELETE FROM public.users u
    WHERE u.id = p_user_id
      AND u.is_guest = true
      AND NOT EXISTS (
        SELECT 1 FROM public.trip_members tm WHERE tm.user_id = p_user_id
      );
EXCEPTION
  WHEN foreign_key_violation THEN
    -- Guest has expense/score history (ON DELETE RESTRICT) — keep the row.
    NULL;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.delete_orphan_guest_user(text) TO authenticated;
