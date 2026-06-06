-- ────────────────────────────────────────────────────────────────────────
-- Migration 025 — Cascade auth-user deletion into public.users
-- ────────────────────────────────────────────────────────────────────────
--
-- Problem: deleting a user in the Supabase dashboard (or via the admin API)
-- removes the `auth.users` row but leaves its `public.users` mirror row behind.
-- The two can't be linked by a foreign key (auth.users.id is uuid, our
-- public.users.id is text), and we only had an INSERT-side trigger
-- (handle_new_user) — nothing on DELETE. Result: the app still sees the user,
-- and because public.users.email is UNIQUE, that email can't be re-registered
-- (a fresh signup collides on users_email_key and the signup trigger rolls back).
--
-- Fix: mirror handle_new_user with a delete-side trigger that removes the
-- public.users row when its auth.users row is deleted. FKs into public.users
-- (trip_members, team_assignments, idea_votes, date_poll_votes, expense_splits,
-- messages, expenses.paid_by_user_id, quick_info_tiles.created_by, invites, …)
-- are ON DELETE CASCADE, so the rest of that user's rows clean up automatically.
--
-- Idempotent (CREATE OR REPLACE + DROP TRIGGER IF EXISTS) and safe to re-apply.

CREATE OR REPLACE FUNCTION public.handle_user_delete()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
AS $function$
BEGIN
  -- public.users.id stores the auth uuid as text.
  DELETE FROM public.users WHERE id = OLD.id::text;
  RETURN OLD;
END;
$function$;

DROP TRIGGER IF EXISTS on_auth_user_deleted ON auth.users;
CREATE TRIGGER on_auth_user_deleted
  AFTER DELETE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_user_delete();
