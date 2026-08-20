-- 133 — scope the `users` guest write arm to trips the actor actually runs.
--
-- Closes F2 of RLS_POLICY_AUDIT.md. Also lands the definer lookup that
-- migration 134 (which closes F1) needs to exist BEFORE its dependent code
-- deploys — CLAUDE.md Migration Workflow step 3.
--
-- ── What was wrong ────────────────────────────────────────────────────────
--
--   users_update  USING      ((id = auth.uid()::text) OR (is_guest = true))
--   users_insert  WITH CHECK ((id = auth.uid()::text) OR (is_guest = true))
--
-- The second arm is scoped to NOTHING. `is_guest = true` is a property of the
-- ROW, not a relationship to the caller, so it spanned every placeholder in
-- the database. Confirmed by probe: an account with no membership anywhere
-- renamed a placeholder in an unrelated trip, rewrote a placeholder's email,
-- and fabricated placeholder rows with a chosen id.
--
-- ── Why it was not merely untidy ──────────────────────────────────────────
--
-- It was the second link in a confirmed chain to unauthorized trip access:
--
--   1. `users_select USING (true)` hands over every placeholder id  (F1, mig 134)
--   2. repoint that placeholder's email at an address you control   (THIS)
--   3. sign up with it; `handle_new_user` matches on email + is_guest alone
--   4. `merge_guest_to_real_user` reassigns the placeholder's rows —
--      `trip_members` included — to the new account
--
-- The attacker lands as a Member of a trip they were never invited to, with no
-- trip UUID required. That is strictly easier than #985, which at least needed
-- one. Cutting step 2 breaks the chain; steps 3 and 4 are correct behaviour and
-- are deliberately NOT touched here.
--
-- ── The rule this restores ────────────────────────────────────────────────
--
-- #720: a tRPC check is not a policy. `ghostCrew.update` — the only procedure
-- that writes a placeholder row — is `requireTripRole("Owner")`. The policy
-- asked for nothing. It now asks for the same thing the procedure does.
--
-- ── Why the INSERT arm cannot be scoped the same way ──────────────────────
--
-- A placeholder is created BEFORE its `trip_members` row exists (both callers:
-- `ghostCrew.create`, `tripMembers.inviteByEmail`), so at INSERT time it
-- belongs to no trip and an EXISTS-over-membership check would refuse the
-- legitimate write. Same bootstrap ordering migration 128 hit.
--
-- So the INSERT arm pins ATTRIBUTION instead: you may create a placeholder, but
-- it is stamped as yours and you cannot forge one as somebody else. Both
-- callers already set `created_by` to the acting user, so no code changes.
--
-- Residual, stated plainly: an authenticated caller can still mint a
-- placeholder row with an id of their choosing. It is inert. Attaching it to a
-- trip is a `trip_members` INSERT, and since migration 128 that requires
-- `is_trip_planner` of the target trip — so a fabricated placeholder reaches
-- nobody else's trip. What it can no longer do is impersonate another user's
-- authorship, or be pointed at an address whose signup would carry someone
-- else's memberships across.
--
-- ── Unaffected by design ──────────────────────────────────────────────────
--
-- `handle_new_user`, `merge_guest_to_real_user`, `link_guest_to_account` and
-- `handle_user_delete` are all SECURITY DEFINER owned by `postgres` (verified
-- against the live DB, not assumed), so the signup/merge/delete paths bypass
-- RLS entirely and this narrowing cannot reach them.
--
-- Deleted accounts are placeholders too (migration 130 sets `is_guest = true`),
-- so they fall under the same arm. That is correct — an Owner may still fix a
-- roster row — and their `email` is NULL, so the chain above cannot target them
-- regardless. Migration 132's `deleted_at` guard covers only deleted
-- placeholders, never ordinary ones, and so never covered this.

-- ── Helper: does the caller run a trip this placeholder belongs to? ────────
--
-- SECURITY DEFINER because a policy on `users` that subqueries `trip_members`
-- would otherwise be evaluated under the caller's own RLS. Mirrors the
-- existing `is_trip_member` / `has_trip_role` helpers.
CREATE OR REPLACE FUNCTION public.can_admin_guest(p_user_id text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.trip_members tm
    WHERE tm.user_id = p_user_id
      AND public.has_trip_role(tm.trip_id, ARRAY['Owner'::text])
  );
$function$;

COMMENT ON FUNCTION public.can_admin_guest(text) IS
  'True when the caller is Owner of at least one trip the given person belongs to. Gates the placeholder write arm of users_update so it matches ghostCrew.update''s requireTripRole("Owner") instead of admitting every placeholder in the database (migration 133).';

REVOKE ALL ON FUNCTION public.can_admin_guest(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_admin_guest(text) TO authenticated;

-- ── Helper: the one sanctioned cross-trip read of `users` ─────────────────
--
-- Invite-by-email has to answer "does this address already have an account?"
-- for someone the caller shares no trip with. That single question is why
-- `users_select` was `true`. Migration 134 narrows the policy; this function is
-- what that read becomes, so the contract is enforced by the function instead
-- of left as a convention the policy could not express:
--   exact address only (no prefix, no wildcard, no listing)
--   at most one row
--   never the row — id, display name, placeholder flag, avatar. No email
--   echoed back (the caller supplied it), no created_at, no prefs.
--
-- Landed here rather than in 134 so it exists in prod before the code that
-- calls it deploys (CLAUDE.md Migration Workflow step 3).
--
-- This is an existence oracle for an exact address, which is what
-- `users.search` already was by design. It is strictly narrower than the
-- `USING (true)` it replaces: one row for an address you must already know,
-- versus the whole table.
CREATE OR REPLACE FUNCTION public.lookup_user_by_email(p_email text)
RETURNS TABLE (id text, name text, is_guest boolean, avatar_icon text)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path TO ''
AS $function$
  SELECT u.id, u.name, u.is_guest, u.avatar_icon
  FROM public.users u
  WHERE u.email = lower(trim(p_email))
  LIMIT 1;
$function$;

COMMENT ON FUNCTION public.lookup_user_by_email(text) IS
  'Exact-address account lookup, the only sanctioned read of users that crosses trip boundaries. Returns at most one row and never the full record. Normalises the address the way every caller already did (lower+trim). Deleted accounts have a NULL email (migration 130) so they can never match. See migration 133; consumed by users.search, ghostCrew.create/update and tripMembers (migration 134 narrows users_select around it).';

REVOKE ALL ON FUNCTION public.lookup_user_by_email(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lookup_user_by_email(text) TO authenticated;

-- ── The policies ──────────────────────────────────────────────────────────
--
-- WITH CHECK is spelled out rather than left to default to USING. It defaulted
-- before, which is legal but meant the new-row rule was invisible in the policy
-- text — and on this table the two arms differ in what they imply for a new
-- row. Writing it out costs nothing and stops the next reader inferring it.
DROP POLICY IF EXISTS users_update ON public.users;
CREATE POLICY users_update ON public.users
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (
    id = (auth.uid())::text
    OR (is_guest = true AND public.can_admin_guest(id))
  )
  WITH CHECK (
    id = (auth.uid())::text
    OR (is_guest = true AND public.can_admin_guest(id))
  );

COMMENT ON POLICY users_update ON public.users IS
  'Your own row, or a placeholder on a trip you own. The old second arm was a bare `is_guest = true`, which scoped to nothing and let any account rewrite every placeholder in the database — including repointing one''s email so a later signup inherited its trip memberships (migration 133, closing audit F2).';

DROP POLICY IF EXISTS users_insert ON public.users;
CREATE POLICY users_insert ON public.users
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
    id = (auth.uid())::text
    OR (is_guest = true AND created_by = (auth.uid())::text)
  );

COMMENT ON POLICY users_insert ON public.users IS
  'Your own row, or a placeholder you are recorded as having created. Membership cannot be required here — the placeholder is inserted before its trip_members row exists — so this pins authorship instead: a placeholder cannot be forged as someone else''s. Attaching one to a trip still needs is_trip_planner there (migration 128), which is what keeps a fabricated row inert (migration 133, closing audit F2).';
