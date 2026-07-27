-- 095 — merge_guest_to_real_user: full person-reference coverage + collision safety.
--
-- ── Why ──────────────────────────────────────────────────────────────────────
-- Production had 2 trips holding 123 rows (including 93 real per-hole scores)
-- pointing at ghost users who were no longer trip members: rosters rendered
-- "Unknown", and `game_participants` still gated scoring for the ghost, so the
-- real person could not enter scores in a game they were rostered in.
--
-- The CAUSE was not this function — it was `ghostCrew.update`'s auto-link
-- branch, which repointed `trip_members` only and never called the merge (fixed
-- in the same PR). But making that branch call this function exposes two real
-- problems that must be fixed FIRST, because a merge DELETES the ghost:
--
--   1. COVERAGE. Columns this function never moved would be cascade-deleted or
--      null'd out by that DELETE — destroying data the broken state currently
--      preserves. The fix would have been more dangerous than the bug.
--   2. COLLISIONS. Six tables already in this function have a UNIQUE/PK
--      including user_id. If the ghost AND the real user both have a row
--      (same trip, same game, same vote), the UPDATE raises 23505. This
--      function runs inside the `on_auth_user_created` trigger, so that
--      aborts the whole INSERT and SIGNUP FAILS — the exact class of breakage
--      migration 023 was written to fix. Latent today; this closes it.
--
-- ── What changed ─────────────────────────────────────────────────────────────
-- * Collision-safe move for every UNIQUE-constrained table: delete the ghost's
--   losing row where the real user already holds that key, then move the rest.
--   The real account's row always wins (it is the surviving identity).
-- * NEW coverage — CASCADE columns (these would have been DELETED with the
--   ghost): game_delegates.user_id, news_posts.author_id, archived_ideas.user_id,
--   circle_members.user_id, chat_reads.user_id, news_reads.user_id,
--   push_subscriptions.user_id.
-- * NEW coverage — SET NULL columns (these would have been orphaned to null):
--   game_delegates.granted_by, schedule_items.created_by, schedule_items
--   .confirmed_by, logistics_items.created_by, idea_lodging_options.created_by,
--   circles.created_by, courses.created_by.
-- * NEW: JSONB match sides. `game_matches.side_a/side_b` store
--   {type,id} and are unreachable by `UPDATE ... SET col = ...`; they need
--   jsonb_set, guarded on ->>'type' = 'user'. play_group sides are left alone —
--   their membership lives in game_participants, which is moved above.
--
-- Every referenced table/column was verified to exist against the live schema
-- before writing this: a reference to a missing object here does not fail
-- quietly, it breaks all signup (migration 023).
--
-- Idempotent (CREATE OR REPLACE), replayable from zero, no environment-specific
-- ids — the repair of already-broken rows is a separate confirm-per-pair script
-- (scripts/repair-ghost-orphans.mjs), NOT a data migration keyed on ids (the
-- 044 anti-pattern).

CREATE OR REPLACE FUNCTION public.merge_guest_to_real_user(p_ghost_id text, p_real_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  -- ── Trip + planning era ────────────────────────────────────────────────────
  -- UNIQUE (trip_id, user_id): drop the ghost's row when the real user is
  -- already a member of that trip, then move what's left.
  DELETE FROM public.trip_members g
   WHERE g.user_id = p_ghost_id
     AND EXISTS (SELECT 1 FROM public.trip_members r
                  WHERE r.trip_id = g.trip_id AND r.user_id = p_real_id);
  UPDATE public.trip_members SET user_id = p_real_id WHERE user_id = p_ghost_id;

  -- PK (idea_id, user_id) — the real user's existing vote wins.
  DELETE FROM public.idea_votes g
   WHERE g.user_id = p_ghost_id
     AND EXISTS (SELECT 1 FROM public.idea_votes r
                  WHERE r.idea_id = g.idea_id AND r.user_id = p_real_id);
  UPDATE public.idea_votes SET user_id = p_real_id WHERE user_id = p_ghost_id;

  -- PK (window_id, user_id).
  DELETE FROM public.date_poll_votes g
   WHERE g.user_id = p_ghost_id
     AND EXISTS (SELECT 1 FROM public.date_poll_votes r
                  WHERE r.window_id = g.window_id AND r.user_id = p_real_id);
  UPDATE public.date_poll_votes SET user_id = p_real_id WHERE user_id = p_ghost_id;

  -- PK (expense_id, user_id).
  DELETE FROM public.expense_splits g
   WHERE g.user_id = p_ghost_id
     AND EXISTS (SELECT 1 FROM public.expense_splits r
                  WHERE r.expense_id = g.expense_id AND r.user_id = p_real_id);
  UPDATE public.expense_splits SET user_id = p_real_id WHERE user_id = p_ghost_id;

  -- PK (trip_id, user_id, visibility) — read receipts, NEW coverage (CASCADE).
  DELETE FROM public.chat_reads g
   WHERE g.user_id = p_ghost_id
     AND EXISTS (SELECT 1 FROM public.chat_reads r
                  WHERE r.trip_id = g.trip_id AND r.visibility = g.visibility
                    AND r.user_id = p_real_id);
  UPDATE public.chat_reads SET user_id = p_real_id WHERE user_id = p_ghost_id;

  -- PK (trip_id, user_id) — NEW coverage (CASCADE).
  DELETE FROM public.news_reads g
   WHERE g.user_id = p_ghost_id
     AND EXISTS (SELECT 1 FROM public.news_reads r
                  WHERE r.trip_id = g.trip_id AND r.user_id = p_real_id);
  UPDATE public.news_reads SET user_id = p_real_id WHERE user_id = p_ghost_id;

  -- PK (circle_id, user_id) — NEW coverage (CASCADE).
  DELETE FROM public.circle_members g
   WHERE g.user_id = p_ghost_id
     AND EXISTS (SELECT 1 FROM public.circle_members r
                  WHERE r.circle_id = g.circle_id AND r.user_id = p_real_id);
  UPDATE public.circle_members SET user_id = p_real_id WHERE user_id = p_ghost_id;

  -- Unconstrained on user_id — plain moves.
  UPDATE public.messages          SET user_id         = p_real_id WHERE user_id         = p_ghost_id;
  UPDATE public.expenses          SET paid_by_user_id = p_real_id WHERE paid_by_user_id = p_ghost_id;
  UPDATE public.archived_ideas    SET user_id         = p_real_id WHERE user_id         = p_ghost_id; -- NEW (CASCADE)
  UPDATE public.news_posts        SET author_id       = p_real_id WHERE author_id       = p_ghost_id; -- NEW (CASCADE)
  -- push_subscriptions is UNIQUE on `endpoint`, not user_id, so this is safe:
  -- a ghost and a real account cannot share an endpoint.
  UPDATE public.push_subscriptions SET user_id        = p_real_id WHERE user_id         = p_ghost_id; -- NEW (CASCADE)

  -- Authorship / audit columns (SET NULL if the ghost were deleted).
  UPDATE public.quick_info_tiles     SET created_by   = p_real_id WHERE created_by   = p_ghost_id;
  UPDATE public.users                SET created_by   = p_real_id WHERE created_by   = p_ghost_id;
  UPDATE public.invites              SET created_by   = p_real_id WHERE created_by   = p_ghost_id;
  UPDATE public.schedule_items       SET created_by   = p_real_id WHERE created_by   = p_ghost_id; -- NEW
  UPDATE public.schedule_items       SET confirmed_by = p_real_id WHERE confirmed_by = p_ghost_id; -- NEW
  UPDATE public.logistics_items      SET created_by   = p_real_id WHERE created_by   = p_ghost_id; -- NEW
  UPDATE public.idea_lodging_options SET created_by   = p_real_id WHERE created_by   = p_ghost_id; -- NEW
  UPDATE public.circles              SET created_by   = p_real_id WHERE created_by   = p_ghost_id; -- NEW
  UPDATE public.courses              SET created_by   = p_real_id WHERE created_by   = p_ghost_id; -- NEW

  -- ── Competition / scoring era ──────────────────────────────────────────────
  -- PK (competition_id, user_id) — one team per person per competition.
  DELETE FROM public.team_assignments g
   WHERE g.user_id = p_ghost_id
     AND EXISTS (SELECT 1 FROM public.team_assignments r
                  WHERE r.competition_id = g.competition_id AND r.user_id = p_real_id);
  UPDATE public.team_assignments SET user_id = p_real_id WHERE user_id = p_ghost_id;

  -- UNIQUE (game_id, user_id) — rostered participation. Its CASCADE FK would
  -- otherwise delete these rows with the ghost.
  DELETE FROM public.game_participants g
   WHERE g.user_id = p_ghost_id
     AND EXISTS (SELECT 1 FROM public.game_participants r
                  WHERE r.game_id = g.game_id AND r.user_id = p_real_id);
  UPDATE public.game_participants SET user_id = p_real_id WHERE user_id = p_ghost_id;

  -- PK (game_id, user_id) — NEW coverage (CASCADE): delegate grants.
  DELETE FROM public.game_delegates g
   WHERE g.user_id = p_ghost_id
     AND EXISTS (SELECT 1 FROM public.game_delegates r
                  WHERE r.game_id = g.game_id AND r.user_id = p_real_id);
  UPDATE public.game_delegates SET user_id    = p_real_id WHERE user_id    = p_ghost_id; -- NEW
  UPDATE public.game_delegates SET granted_by = p_real_id WHERE granted_by = p_ghost_id; -- NEW

  -- Polymorphic (type,id) pairs — user-typed rows ONLY; team / play_group rows
  -- are a different identity space and must not be touched.
  UPDATE public.score_entries       SET participant_id = p_real_id WHERE participant_id = p_ghost_id AND participant_type = 'user';
  UPDATE public.score_entries       SET submitted_by   = p_real_id WHERE submitted_by   = p_ghost_id;
  UPDATE public.game_results        SET entity_id      = p_real_id WHERE entity_id      = p_ghost_id AND entity_type      = 'user';
  UPDATE public.match_hole_outcomes SET submitted_by   = p_real_id WHERE submitted_by   = p_ghost_id;

  -- JSONB match sides — NEW. Unreachable by `SET col = value`; the id lives
  -- inside the document. Guarded on type='user' so play_group sides are left
  -- intact (their members moved via game_participants above).
  UPDATE public.game_matches
     SET side_a = jsonb_set(side_a, '{id}', to_jsonb(p_real_id))
   WHERE side_a ->> 'type' = 'user' AND side_a ->> 'id' = p_ghost_id;
  UPDATE public.game_matches
     SET side_b = jsonb_set(side_b, '{id}', to_jsonb(p_real_id))
   WHERE side_b ->> 'type' = 'user' AND side_b ->> 'id' = p_ghost_id;

  -- ── Retire the now-empty ghost ─────────────────────────────────────────────
  DELETE FROM public.users WHERE id = p_ghost_id AND is_guest = true;
END;
$$;

COMMENT ON FUNCTION public.merge_guest_to_real_user(text, text) IS
  'Reassign every person-reference from a guest row to a real account, then delete the guest. '
  'Runs inside the signup trigger (handle_new_user) AND, via link_guest_to_account, from '
  'ghostCrew.update''s auto-link branch. MUST cover every table with a person reference — a new '
  'such table has to be added here, or the ghost DELETE will cascade its rows away or null them out.';

-- ── link_guest_to_account — the AUTHORIZED entry point for the app ───────────
--
-- merge_guest_to_real_user is intentionally NOT executable by `authenticated`
-- (ACL is postgres + service_role only, per the REVOKE-FROM-PUBLIC rule in
-- migration 066), and it must stay that way: it takes two arbitrary ids and
-- moves one identity's entire history onto another. Granting it directly would
-- be an account-takeover primitive.
--
-- So the app calls this guarded wrapper instead — same shape as
-- set_team_captain: SECURITY DEFINER, authorization checked HERE at the
-- database layer rather than trusted from the caller, then delegating to the
-- revoked core.
--
-- Checks, in order: the caller owns the trip; the row being merged away really
-- is a guest; that guest is actually on this trip (so an owner can't reach into
-- another trip's placeholder); and the target account exists.
CREATE OR REPLACE FUNCTION public.link_guest_to_account(
  p_trip_id text,
  p_ghost_id text,
  p_real_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
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

  PERFORM public.merge_guest_to_real_user(p_ghost_id, p_real_id);
END;
$$;

COMMENT ON FUNCTION public.link_guest_to_account(text, text, text) IS
  'Owner-only, trip-scoped wrapper around merge_guest_to_real_user. The core stays revoked from '
  'authenticated; this is what the app may call.';

-- The wrapper is guarded, so `authenticated` may execute it. The CORE is not
-- re-granted here — it keeps its postgres/service_role-only ACL.
REVOKE ALL ON FUNCTION public.link_guest_to_account(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.link_guest_to_account(text, text, text) TO authenticated;
