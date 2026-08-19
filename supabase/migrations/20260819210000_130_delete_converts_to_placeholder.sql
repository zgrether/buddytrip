-- ────────────────────────────────────────────────────────────────────────
-- Migration 130 — deleting an account converts it to a PLACEHOLDER
-- ────────────────────────────────────────────────────────────────────────
--
-- Until now `handle_user_delete()` did `DELETE FROM public.users`, and the FK
-- fan-out decided everyone's fate. Measured consequences of that, on the live
-- database:
--
--   * `expenses.paid_by_user_id` CASCADEs — deleting ONE account removed 2
--     expenses and the 14 splits owed by 14 OTHER people. Their balances
--     changed because someone else left.
--   * `score_entries.participant_id`, `game_results.entity_id` and the
--     `game_matches.side_a/side_b` JSONB carry person ids with NO FK, so they
--     were left pointing at a row that no longer existed — 2 orphaned score
--     rows and 1 match still listing the deleted player as a side.
--
-- ── The design: this is `merge_guest_to_real_user` run backwards ───────────
--
-- A placeholder is not a new concept to introduce — it is the state MOST of
-- this app's people start in. A name-only `users` row that cannot sign in,
-- holds scores, occupies team slots, and renders correctly on every surface
-- that already exists. `merge_guest_to_real_user` converts placeholder → real
-- at signup. Account deletion is that operation in reverse.
--
-- So the row STAYS and is emptied of the person instead:
--
--   name       -> 'Deleted User'
--   email      -> NULL      (required — see below)
--   avatar_url -> NULL
--   is_guest   -> true      (it is a placeholder now, by definition)
--
-- The auth.users row is still deleted by Supabase; they cannot sign in again.
--
-- ── Why this is the right shape, and not merely the gentler one ────────────
--
-- Every orphan above dangles ONLY because the row vanished. Keep a shell and
-- all of them resolve — with no need to teach the delete path about
-- polymorphic ids or `jsonb_set`, and no second cleanup routine to keep in
-- lockstep with the schema (which is exactly the maintenance burden that let
-- `merge_guest_to_real_user` drift for whole eras). One decision closes the
-- integrity bug and the shared-data question together.
--
-- It also stops the expense cascade dead, without touching those FKs: they
-- only fire when a `users` row is deleted, and now it isn't. The FK behaviours
-- are still wrong on their own terms and are fixed separately — but no account
-- deletion reaches them any more.
--
-- ── Nulling the email is REQUIRED, not hygiene ─────────────────────────────
--
-- `handle_new_user` auto-links a new signup to any `users` row where
-- `email = NEW.email AND is_guest = true`. A placeholder that kept its address
-- would therefore be resurrected into the hands of whoever next signs up with
-- it. Nulling the email is what makes that impossible — verified by reading
-- both link paths, not assumed.
--
-- `trip_members.nickname` is cleared for the same reason: it is per-trip
-- display text that can name the person. An owner may set a new one afterwards
-- (`ghostCrew.update` already allows exactly that on placeholders), which is a
-- deliberate, owner-initiated act rather than residue of the deleted account.

CREATE OR REPLACE FUNCTION public.handle_user_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  -- 1. The account becomes a placeholder. NOT deleted: every score, match side,
  --    result row and expense that references this id stays valid.
  UPDATE public.users
     SET name       = 'Deleted User',
         email      = NULL,
         avatar_url = NULL,
         is_guest   = true
   WHERE id = OLD.id::text;

  -- 2. Genuinely personal rows go. These are about the PERSON and about nobody
  --    else — no other member's record depends on them, so there is nothing to
  --    anonymize and no reason to keep them.
  DELETE FROM public.push_subscriptions WHERE user_id = OLD.id::text;
  DELETE FROM public.chat_reads         WHERE user_id = OLD.id::text;
  DELETE FROM public.news_reads         WHERE user_id = OLD.id::text;

  -- 3. Per-trip display text that can name them.
  UPDATE public.trip_members SET nickname = NULL WHERE user_id = OLD.id::text;

  RETURN OLD;
END;
$function$;

COMMENT ON FUNCTION public.handle_user_delete() IS
  'Fired by on_auth_user_deleted. Converts the public.users row to a placeholder (name "Deleted User", email/avatar nulled, is_guest true) rather than deleting it, so shared records — scores, match sides, results, expenses and the splits other people owe — stay intact and keep resolving. Deletes only rows that are about the person alone. Nulling the email is required: it is what stops handle_new_user auto-linking the placeholder to a future signup (migration 130).';
