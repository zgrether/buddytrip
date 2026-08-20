-- 134 — `users` is readable by people you actually share a trip with.
--
-- Closes F1 of RLS_POLICY_AUDIT.md, the last tier-1 finding.
--
-- ── What was wrong ────────────────────────────────────────────────────────
--
--   users_select  USING (true)
--
-- Any browser JWT could `GET /rest/v1/users?select=*` and take the whole
-- table. Probed: 89 rows in prod, every address, no filter and no limit.
--
-- The only caller is `users.search`, which is deliberately the opposite — its
-- own comment says "email-exact lookup only": it requires an `@`, matches
-- `.eq("email", …)` with `.limit(1)`, and drops self and placeholders. It is
-- built as an existence check for an address you already know, never a
-- directory. The policy behind it asked for nothing.
--
-- That is the #985 shape exactly, and the reason it survived three migrations
-- that edited this table: every test drives tRPC, and a test going through the
-- callers cannot see a policy wider than its callers. The procedures were
-- right. The app never did the thing the policy allowed, so nothing failed.
--
-- ── Why this needed a design change, not a tighter predicate ──────────────
--
-- One legitimate read genuinely crosses trip boundaries: invite-by-email has
-- to answer "does this address already have an account?" for someone the
-- caller shares no trip with. Narrow the policy to self-plus-shares-a-trip and
-- that breaks — which is why the policy was `true` in the first place.
--
-- So migration 133 added `lookup_user_by_email`, a SECURITY DEFINER that
-- answers exactly that question and nothing else: exact address, at most one
-- row, and never the record (id, display name, placeholder flag, avatar — no
-- email echoed back, no created_at, no prefs). The contract `users.search`
-- described in a comment is now enforced by the function. All five
-- cross-boundary readers moved onto it before this migration lands.
--
-- ── Every read of `users` was enumerated before this policy changed ───────
--
-- A narrowed SELECT policy returns FEWER ROWS rather than erroring, so a
-- missed read renders as a blank name or a vanished row, not a failure. The
-- full set (29 sites: 27 direct, 2 PostgREST embeds), by what now admits it:
--
--   SELF          users.getMe / updateMe / updateAvatar, notifications
--                 get/setPreferences, feedback, tripMembers ownerName
--   SHARES A TRIP tripMembers.list roster hydration; getDisplayName;
--                 emailCrew's recipient read; ownerGuard's
--                 `trip_members … users!inner(is_guest)` — an INNER join, so
--                 an invisible user would have silently dropped the whole
--                 membership row and under-reported the orphan-trip blocker.
--                 Every row it reads is a member of a trip the caller owns.
--   DEFINER RPC   users.search, ghostCrew.create, ghostCrew.update,
--                 tripMembers.checkEmail, tripMembers.inviteByEmail
--   SERVICE ROLE  gameFinishNotify, sendPush, sendPushToUsers, inviteLink
--                 (both its `addressHasAccount` and the invites embed) —
--                 RLS does not apply, unaffected
--
-- Chat authorship, leaderboard names, expense payers and team panels resolve
-- through the roster (`tripMembers.list`), not through a second read of
-- `users`: `messages.list` returns `user_id` only. Nothing else turns an id
-- into a name server-side.
--
-- One consequence worth naming: `ghostCrew.create`'s INSERT used RETURNING,
-- which is evaluated against THIS policy. A freshly-minted placeholder shares
-- no trip yet — its `trip_members` row is written a moment later — so the
-- RETURNING would have found nothing and failed with the row already inserted.
-- Split into INSERT + local construction (CLAUDE.md enforced pattern #4) in
-- the code PR that precedes this migration.
--
-- ── Deliberately unchanged ────────────────────────────────────────────────
--
-- Placeholders stay readable to their own trip: they hold `trip_members` rows,
-- so `shares_trip_with_me` admits them exactly like anyone else. Rosters keep
-- naming everyone.
--
-- Members can still see the addresses of people on their own trips. That is a
-- narrowing from "every address in the database" to "the ones you travel
-- with", and going further means column-level restriction, which is a
-- different job with a different blast radius. Named here so it is a decision
-- on the record rather than an oversight.

-- ── Helper ────────────────────────────────────────────────────────────────
--
-- SECURITY DEFINER so a policy on `users` that subqueries `trip_members` is
-- not itself evaluated under the caller's RLS. Mirrors `is_trip_member` /
-- `has_trip_role` / `can_admin_guest`.
--
-- Both sides of the join are indexed (`idx_trip_members_user_id`,
-- `idx_trip_members_trip_id`), and every caller already scopes its read by id
-- or by a roster it just fetched, so this is evaluated over a handful of rows
-- rather than the table.
CREATE OR REPLACE FUNCTION public.shares_trip_with_me(p_user_id text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.trip_members mine
    JOIN public.trip_members theirs ON theirs.trip_id = mine.trip_id
    WHERE mine.user_id = (auth.uid())::text
      AND theirs.user_id = p_user_id
  );
$function$;

COMMENT ON FUNCTION public.shares_trip_with_me(text) IS
  'True when the caller and the given person are on at least one trip together. Placeholders count — they hold trip_members rows — so rosters keep naming everyone. Gates users_select (migration 134).';

REVOKE ALL ON FUNCTION public.shares_trip_with_me(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shares_trip_with_me(text) TO authenticated;

-- ── The policy ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS users_select ON public.users;
CREATE POLICY users_select ON public.users
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    id = (auth.uid())::text
    OR public.shares_trip_with_me(id)
  );

COMMENT ON POLICY users_select ON public.users IS
  'Yourself, plus people you share a trip with. Was USING (true), which handed any authenticated caller the entire table including every email address — while its only caller, users.search, was an exact-address lookup limited to one row. The one read that legitimately crosses trips now goes through lookup_user_by_email (migration 133). See migration 134, closing audit F1.';
