-- ────────────────────────────────────────────────────────────────────────
-- Migration 129 — score_entries.submitted_by no longer blocks account deletion
-- ────────────────────────────────────────────────────────────────────────
--
-- Deleting an account fails outright for anyone who has ever entered a score:
--
--   23503: update or delete on table "users" violates foreign key constraint
--          "score_entries_submitted_by_fkey" on table "score_entries"
--   CONTEXT: SQL statement "DELETE FROM public.users WHERE id = OLD.id::text"
--            PL/pgSQL function public.handle_user_delete() line 4
--
-- (Reproduced against production, in an aborted transaction, on a real account
-- with 2 score entries. It is the ONLY blocking FK left: an inventory of all 27
-- FKs referencing public.users found every other one already CASCADE or SET
-- NULL. This is the straggler.)
--
-- ── This continues migration 027, which set the policy and could not have
--    covered this column because it did not exist yet ────────────────────────
--
-- 027: "a deleted user's TRIP CONTENT survives with authorship anonymized, and
-- their TRANSIENT / personal rows are removed" — SET NULL for authorship,
-- CASCADE for the user's own transient rows. `submitted_by` is authorship, so
-- SET NULL.
--
-- CASCADE would be actively destructive here and is worth naming so nobody
-- "fixes" it that way later: it would DELETE the score rows. A score belongs to
-- the GAME, not to whoever typed it — deleting one person's account would
-- silently punch holes in a finished round's card for everyone else in it.
-- SET NULL keeps the score and drops only the provenance.
--
-- ── Why it survived: the rule existed for the other exit ───────────────────
--
-- CLAUDE.md has a standing rule that ADDING a person-referencing column means
-- updating `merge_guest_to_real_user` in the same migration. Migration 078 did
-- exactly that for this column — and its own header even names the hazard:
--
--     "score_entries.submitted_by -> users  ON DELETE NO ACTION (RESTRICT-like)"
--
-- It saw the blocking FK, handled the MERGE exit, and left the DELETE exit. The
-- two are the same rule at two different doors, and only one door was written
-- down. Hence the guard below, so the next person-referencing column cannot
-- reintroduce this by being merged correctly and deleted wrongly.

-- ── The fix ───────────────────────────────────────────────────────────────
-- Column is already nullable (verified: is_nullable = YES), so no DROP NOT NULL
-- is needed. Idempotent, per 027's pattern.
ALTER TABLE public.score_entries DROP CONSTRAINT IF EXISTS score_entries_submitted_by_fkey;
ALTER TABLE public.score_entries ADD  CONSTRAINT score_entries_submitted_by_fkey
  FOREIGN KEY (submitted_by) REFERENCES public.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.score_entries.submitted_by IS
  'Who entered this score. NULL once that account is deleted — the score survives, the provenance does not (migration 129, continuing 027 policy). Any reader must tolerate a null submitter.';

-- ── The guard ─────────────────────────────────────────────────────────────
-- Observational, not remembered: reads the LIVE catalog and returns every FK
-- into public.users whose ON DELETE would block `handle_user_delete`. A test
-- asserts this comes back empty, so a new person-referencing column added with
-- the default NO ACTION fails CI instead of failing a person's account
-- deletion months later. Same shape as the configHash coverage guard.
--
-- SECURITY DEFINER + a pinned search_path so it can read pg_catalog when called
-- through PostgREST as `authenticated`; it exposes constraint metadata only, no
-- row data.
CREATE OR REPLACE FUNCTION public.user_delete_blocking_fks()
RETURNS TABLE (constraint_name text, child_table text, child_column text, on_delete text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT
    c.conname::text,
    c.conrelid::regclass::text,
    (SELECT a.attname::text
       FROM unnest(c.conkey) WITH ORDINALITY k(attnum, ord)
       JOIN pg_catalog.pg_attribute a
         ON a.attrelid = c.conrelid AND a.attnum = k.attnum
      ORDER BY k.ord LIMIT 1),
    CASE c.confdeltype WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT' END
  FROM pg_catalog.pg_constraint c
  WHERE c.contype = 'f'
    AND c.confrelid = 'public.users'::regclass
    AND c.confdeltype IN ('a', 'r');
$function$;

COMMENT ON FUNCTION public.user_delete_blocking_fks() IS
  'Every FK into public.users whose ON DELETE (NO ACTION / RESTRICT) would block handle_user_delete and fail account deletion. Must return zero rows; pinned by userDeleteFks.coverage.test.ts (migration 129).';
