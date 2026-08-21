-- 138 — groundwork for F5, F8 and F9. Purely ADDITIVE: a nullable column and
-- two functions. Nothing is narrowed here and no existing behaviour changes.
--
-- Each of the three remaining audit findings needs a capability to exist BEFORE
-- the policy behind it can be narrowed, so this lands and deploys first
-- (CLAUDE.md Migration Workflow step 3). The narrowing is migration 139, after
-- the code that uses these is live.
--
-- ══ F5 groundwork — `expenses.created_by` ═════════════════════════════════
--
-- F5: any trip member can INSERT a split row onto a receipt they neither own
-- nor paid, assigning debt to arbitrary people. `expense_splits_insert` checks
-- only `is_trip_member(ex.trip_id)`.
--
-- The obvious narrowing — Owner OR payer — breaks a real flow. `expenses.create`
-- is `requireTripMember` and takes `paidByUserId` from input, so "I'm recording
-- that Zach paid for dinner" is a supported and ordinary thing for a member to
-- do; under Owner-OR-payer the split insert that immediately follows would be
-- refused and expense creation would break for everyone but the payer.
--
-- The information needed to tell "the person who logged this receipt" from
-- "somebody adding rows to it afterwards" does not exist: `expenses` has
-- id, trip_id, title, amount, paid_by_user_id, created_at, updated_at, date —
-- and no authorship column at all. So the fix is to record authorship, not to
-- guess at it.
--
-- A design that avoided the column was probed and rejected: allow the insert
-- when the expense has no splits yet (true for `create`, and for
-- `updateSplits`, which deletes them first). It works — but only because a
-- multi-row INSERT's per-row check cannot see its own siblings, so it would
-- break silently the day someone refactored `create` to insert splits one at a
-- time. It also cannot be written inline: a policy on `expense_splits` that
-- subqueries `expense_splits` raises `infinite recursion detected in policy`,
-- so it needs a SECURITY DEFINER helper as well. A nullable column is less
-- clever and survives contact with the next reader.
--
-- Nullable with no backfill, deliberately. Existing rows keep NULL — their
-- author is genuinely unknown and inventing one would be worse than admitting
-- it. Migration 139's predicate treats NULL as "no author to appeal to", which
-- falls back to Owner-or-payer for those rows.
--
-- `ON DELETE SET NULL`, matching every other `created_by` in this schema
-- (users, quick_info_tiles, circles, schedule_items, logistics_items,
-- idea_lodging_options): deleting an account must not delete shared money.
-- That is the same rule migration 131 established for `expenses` itself.
--
-- ══ F8 / F9 groundwork — two definer RPCs ════════════════════════════════
--
-- F8: a team captain can change `team_assignments.user_id`, swapping a
--     teammate for anyone in the database.
-- F9: a team captain can change `teams.competition_id`, moving their team
--     between cups in the trip.
--
-- Both are ROSTER and STRUCTURE powers. `requireTeamIdentityEdit`'s own comment
-- draws the line explicitly — "the gate is 'identity + presentation of a team
-- you already run', not 'roster control'... MEMBERSHIP stays owner-only and
-- does NOT use this gate — don't widen it" — and the tRPC layer honours it. The
-- POLICY does not: `teams_update` and `team_assignments_update` admit the
-- captain to the whole row, and RLS cannot express "these columns only".
--
-- ── Why NOT a trigger, which is the obvious answer ────────────────────────
--
-- A BEFORE UPDATE trigger comparing OLD to NEW is the standard way to say "this
-- column may not change". It is the wrong tool here, and dangerously so:
--
--   `merge_guest_to_real_user` runs
--       UPDATE public.team_assignments SET user_id = p_real_id
--        WHERE user_id = p_ghost_id;
--   inside the `handle_new_user` signup trigger.
--
-- That is EXACTLY the operation F8 must forbid, performed by the one writer
-- that is correct — and triggers fire regardless of SECURITY DEFINER, so being
-- a definer does not exempt the merge. A trigger would have to tell "the merge
-- repointing a retired placeholder" from "a captain swapping a teammate", and
-- at the row level those are the same UPDATE. Migration 122 hit this exact
-- shape on `trip_members` and had to special-case its way out with an early
-- exit; there is no equivalent signal here.
--
-- So the capability moves instead of being fenced. Each RPC is SECURITY
-- DEFINER, re-checks authorization itself (it bypasses RLS, so it must), and
-- can only perform the operation it is named for. Migration 139 then removes
-- the captain arms from the raw-table policies, leaving captains with these two
-- doors and no others.

-- ── F5 groundwork ─────────────────────────────────────────────────────────

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS created_by text REFERENCES public.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.expenses.created_by IS
  'Who logged this receipt, which is not necessarily who paid for it — expenses.create lets any trip member record an expense on someone else''s behalf. NULL for every row predating migration 138 and for rows whose author deleted their account; readers must tolerate that. Added so expense_splits_insert can tell the person who created a receipt from somebody adding rows to it afterwards (migration 138, groundwork for audit F5).';

-- ── F8 groundwork — reorder a team's roster, and nothing else ─────────────

CREATE OR REPLACE FUNCTION public.reorder_team_roster(
  p_competition_id text,
  p_team_id        text,
  p_ordered_user_ids text[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_trip_id text;
  v_current text[];
  v_given   text[];
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- The team must belong to the named competition. Without this a caller could
  -- pair a team they captain with a competition they merely belong to.
  SELECT c.trip_id INTO v_trip_id
    FROM public.competitions c
    JOIN public.teams t ON t.competition_id = c.id
   WHERE c.id = p_competition_id AND t.id = p_team_id;
  IF v_trip_id IS NULL THEN
    RAISE EXCEPTION 'Team not found in that competition'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Same gate as requireTeamIdentityEdit: trip Owner, or THIS team's captain.
  IF NOT (public.has_trip_role(v_trip_id, ARRAY['Owner'::text])
          OR public.is_team_captain(p_team_id)) THEN
    RAISE EXCEPTION 'Only the owner or this team''s captain can reorder it'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- The input must be a PERMUTATION of the current roster: same multiset, no
  -- extras, no omissions, no duplicates. This is what makes reorder unable to
  -- add, drop or move anyone — the property that let it sit on the captain
  -- gate in the first place (migration 094).
  SELECT array_agg(ta.user_id ORDER BY ta.user_id) INTO v_current
    FROM public.team_assignments ta
   WHERE ta.competition_id = p_competition_id AND ta.team_id = p_team_id;

  SELECT array_agg(u ORDER BY u) INTO v_given
    FROM unnest(p_ordered_user_ids) AS u;

  IF coalesce(v_current, ARRAY[]::text[]) IS DISTINCT FROM coalesce(v_given, ARRAY[]::text[]) THEN
    RAISE EXCEPTION 'Order must be exactly this team''s current roster'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_ordered_user_ids IS NULL OR cardinality(p_ordered_user_ids) = 0 THEN
    RETURN;
  END IF;

  -- sort_order ONLY. There is no statement in this function that can write
  -- user_id, team_id or is_captain, which is the whole point of it existing.
  UPDATE public.team_assignments ta
     SET sort_order = x.ord
    FROM (
      SELECT u AS uid, ord
        FROM unnest(p_ordered_user_ids) WITH ORDINALITY AS t(u, ord)
    ) x
   WHERE ta.competition_id = p_competition_id
     AND ta.team_id        = p_team_id
     AND ta.user_id        = x.uid;
END;
$function$;

COMMENT ON FUNCTION public.reorder_team_roster(text, text, text[]) IS
  'Reorder a team''s roster. The ONLY roster write a captain gets once migration 139 removes the captain arm from team_assignments_update. Re-checks authorization itself because SECURITY DEFINER bypasses RLS, validates the input is a permutation of the current roster, and writes sort_order alone — it contains no statement that can change user_id, team_id or is_captain. A trigger was rejected for this: merge_guest_to_real_user repoints team_assignments.user_id inside the signup trigger, and triggers fire even for SECURITY DEFINER (migration 138, groundwork for audit F8).';

REVOKE ALL ON FUNCTION public.reorder_team_roster(text, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reorder_team_roster(text, text, text[]) TO authenticated;

-- ── F9 groundwork — a team's identity, and nothing else ───────────────────

CREATE OR REPLACE FUNCTION public.update_team_identity(
  p_team_id    text,
  p_name       text DEFAULT NULL,
  p_short_name text DEFAULT NULL,
  p_color      text DEFAULT NULL,
  p_color_dim  text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_trip_id text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT c.trip_id INTO v_trip_id
    FROM public.teams t
    JOIN public.competitions c ON c.id = t.competition_id
   WHERE t.id = p_team_id;
  IF v_trip_id IS NULL THEN
    RAISE EXCEPTION 'Team not found' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF NOT (public.has_trip_role(v_trip_id, ARRAY['Owner'::text])
          OR public.is_team_captain(p_team_id)) THEN
    RAISE EXCEPTION 'Only the owner or this team''s captain can edit its identity'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- NULL means "leave alone", matching the optional fields on teams.update.
  -- competition_id is absent from this statement by construction: a captain
  -- cannot move their team to another cup through here, which is F9.
  UPDATE public.teams
     SET name       = COALESCE(p_name,       name),
         short_name = COALESCE(p_short_name, short_name),
         color      = COALESCE(p_color,      color),
         color_dim  = COALESCE(p_color_dim,  color_dim)
   WHERE id = p_team_id;
END;
$function$;

COMMENT ON FUNCTION public.update_team_identity(text, text, text, text, text) IS
  'Set a team''s name, short name and colours — the four columns teams.update has always accepted. The ONLY teams write a captain gets once migration 139 removes the captain arm from teams_update. competition_id is absent from its UPDATE by construction, which is what closes audit F9: the row-level policy could not express "these columns only", so the capability moved into a function that can only do the one thing (migration 138).';

REVOKE ALL ON FUNCTION public.update_team_identity(text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_team_identity(text, text, text, text, text) TO authenticated;
