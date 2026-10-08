-- 205 · Leaving a trip is an ARCHIVE — the database half of PR 8d
--
-- Ruling 19 (settled 2026-10-02) and Zach's four rulings on 8d's verify-first
-- (2026-10-08): leaving a trip, or being removed from one, takes the trip off
-- the person's list and stops its notifications; their finished results stay
-- attached to them. DESIGN A: the membership row is DELETED — every membership
-- check stays correct by construction — and what deleting it used to lose is
-- carried by two things here:
--
--   - `trip_departures`: the name the crew SAW (trip nickname, else account
--     name), so a departed person's results, chat and expenses keep a name.
--     Read narrowly: trip members only, display name only, nothing about why.
--   - `archive_trip_member`: ONE path for leaving and for removal, which keeps
--     everything in FINISHED games exactly as it is and vacates seats only in
--     unfinished ones ("for a game still in progress, someone leaving really
--     has left"). It replaces the app-side clean-up, which ran with the
--     caller's rights — a Member leaving on their own has none to clear seats
--     with, and the service-role key is absent on previews.
--
-- Design B (an archived flag on the row) was rejected: about 115 policies route
-- through seven helpers, but 4 policies, 19 functions, ~25 server reads, 39
-- screens and every FUTURE check would each have to exclude archived rows, and
-- it opened three holes — a member could flip their own flag back (they may
-- UPDATE their own row), an archive by UPDATE skips the role guard, and the
-- one-row-per-person key would need new rules in add, invite, claim and merge.
--
-- ── Closing the direct self-delete (Zach: early, not as an afterthought) ───
--
-- `trip_members_delete` admitted `user_id = auth.uid()`, so any member could
-- delete their own row straight through the API, skipping every clean-up and
-- guard. It is narrowed to Owners/Organizers here. When the app's remove paths
-- move onto `archive_trip_member` (8d-2), the policy goes entirely and the
-- archive becomes the only way a membership ends — a follow-up migration,
-- because today's deployed code still deletes rows directly.

-- ── 1 · The departures record ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.trip_departures (
  trip_id      text NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  user_id      text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  -- The name the crew saw: the trip nickname if they had one, else the account
  -- name. Snapshotted at departure — the nickname lived on the row that is
  -- being deleted, and the account name is no longer readable to the crew
  -- once they share no trip with the person (`users_select`).
  display_name text NOT NULL,
  left_at      timestamptz NOT NULL DEFAULT now(),
  -- One record per person per trip: leaving again after re-joining refreshes it.
  PRIMARY KEY (trip_id, user_id)
);

COMMENT ON TABLE public.trip_departures IS
  'Who has left (or been removed from) a trip, with the name the crew saw (migration 205, PR 8d). Written only by archive_trip_member. Read by name resolution for people no longer on the trip.';

-- #1440's rule: grants ship with the table. Members SELECT; writes only
-- through the definer function; anon nothing. REVOKE first, because the
-- default ACL has already granted ALL at CREATE TABLE.
REVOKE ALL ON TABLE public.trip_departures FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.trip_departures TO authenticated;
GRANT ALL ON TABLE public.trip_departures TO service_role;

ALTER TABLE public.trip_departures ENABLE ROW LEVEL SECURITY;

-- The trip's current members, and nobody else. Deliberately NOT the departed
-- person themselves: the trip has left their list, and this record is the
-- crew's, not theirs.
DROP POLICY IF EXISTS trip_departures_select ON public.trip_departures;
CREATE POLICY trip_departures_select ON public.trip_departures
  FOR SELECT TO authenticated
  USING (public.is_trip_member(trip_id));

-- ── 2 · The archive ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.archive_trip_member(p_trip_id text, p_user_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_caller      text := auth.uid()::text;
  v_role        text;
  v_nickname    text;
  v_caller_role text;
  v_name        text;
  v_game_ids    text[];
  v_match       record;
  v_other       jsonb;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'ARCHIVE_NOT_SIGNED_IN' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT tm.role, tm.nickname INTO v_role, v_nickname
    FROM public.trip_members tm
   WHERE tm.trip_id = p_trip_id AND tm.user_id = p_user_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ARCHIVE_NOT_A_MEMBER' USING ERRCODE = 'no_data_found';
  END IF;

  IF p_user_id = v_caller THEN
    -- LEAVING. The Owner cannot: a trip without an Owner has nobody who can
    -- run it. Hand the trip over first (Zach, ruling 3).
    IF v_role = 'Owner' THEN
      RAISE EXCEPTION 'ARCHIVE_OWNER_MUST_TRANSFER' USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;
  ELSE
    -- REMOVING someone. The same rules the role guard enforces on a raw
    -- delete (migrations 122/123): Owners and Organizers remove Members; only
    -- the Owner removes an Organizer; nobody removes the Owner.
    SELECT tm.role INTO v_caller_role
      FROM public.trip_members tm
     WHERE tm.trip_id = p_trip_id AND tm.user_id = v_caller;
    IF v_caller_role IS NULL OR v_caller_role NOT IN ('Owner', 'Organizer') THEN
      RAISE EXCEPTION 'ARCHIVE_NOT_ALLOWED' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF v_role = 'Owner' THEN
      RAISE EXCEPTION 'ARCHIVE_CANNOT_REMOVE_OWNER' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF v_caller_role = 'Organizer' AND v_role <> 'Member' THEN
      RAISE EXCEPTION 'ARCHIVE_ORGANIZER_REMOVES_MEMBERS_ONLY' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  -- The name the crew saw, before the row holding the nickname goes.
  SELECT coalesce(nullif(btrim(v_nickname), ''), nullif(btrim(u.name), ''), 'Someone')
    INTO v_name
    FROM public.users u WHERE u.id = p_user_id;

  INSERT INTO public.trip_departures (trip_id, user_id, display_name, left_at)
  VALUES (p_trip_id, p_user_id, coalesce(v_name, 'Someone'), now())
  ON CONFLICT (trip_id, user_id)
  DO UPDATE SET display_name = EXCLUDED.display_name, left_at = EXCLUDED.left_at;

  -- Cup team assignments in this trip's competitions. Finished games keep
  -- their credit regardless: they credit through `games.credited_roster`
  -- (migration 203), never through today's assignments.
  DELETE FROM public.team_assignments ta
   USING public.competitions c
   WHERE c.id = ta.competition_id AND c.trip_id = p_trip_id AND ta.user_id = p_user_id;

  -- Seats in UNFINISHED games only. A finished game is history and keeps its
  -- participant rows and match sides exactly as they were.
  SELECT coalesce(array_agg(g.id), '{}') INTO v_game_ids
    FROM public.games g
   WHERE g.trip_id = p_trip_id AND g.status IS DISTINCT FROM 'complete';

  IF array_length(v_game_ids, 1) > 0 THEN
    -- A one-on-one match side naming them is vacated, and the OPPONENT's
    -- handicap cleared: it was set against a person who is no longer there
    -- (as the app-side vacate did, `leaveTrip.ts`).
    FOR v_match IN
      SELECT gm.id, gm.game_id, gm.side_a, gm.side_b
        FROM public.game_matches gm
       WHERE gm.game_id = ANY(v_game_ids)
         AND (gm.side_a ->> 'id' = p_user_id OR gm.side_b ->> 'id' = p_user_id)
    LOOP
      IF v_match.side_a ->> 'id' = p_user_id THEN
        UPDATE public.game_matches SET side_a = NULL WHERE id = v_match.id;
        v_other := v_match.side_b;
      ELSE
        UPDATE public.game_matches SET side_b = NULL WHERE id = v_match.id;
        v_other := v_match.side_a;
      END IF;
      IF v_other ->> 'id' IS NOT NULL THEN
        IF v_other ->> 'type' = 'play_group' THEN
          UPDATE public.play_groups SET handicap_strokes = NULL
           WHERE id = v_other ->> 'id' AND game_id = v_match.game_id;
        ELSE
          UPDATE public.game_participants SET handicap_strokes = NULL
           WHERE game_id = v_match.game_id AND user_id = v_other ->> 'id';
        END IF;
      END IF;
    END LOOP;

    DELETE FROM public.game_participants
     WHERE user_id = p_user_id AND game_id = ANY(v_game_ids);
  END IF;

  -- The membership itself. The marker tells the role guard this delete is the
  -- archive's own, for exactly this membership — so an Organizer can LEAVE
  -- (the guard otherwise lets only the Owner delete an Organizer's row)
  -- without any direct delete becoming admissible. Transaction-local, and not
  -- reachable from the API: PostgREST exposes the app's functions, not
  -- set_config.
  PERFORM set_config('buddytrip.archiving', p_trip_id || ':' || p_user_id, true);
  DELETE FROM public.trip_members WHERE trip_id = p_trip_id AND user_id = p_user_id;
  PERFORM set_config('buddytrip.archiving', '', true);
END;
$$;

REVOKE ALL ON FUNCTION public.archive_trip_member(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.archive_trip_member(text, text) TO authenticated, service_role;

-- ── 3 · Close the direct self-delete ──────────────────────────────────────
-- Was: USING ((user_id = auth.uid()) OR is_trip_planner(trip_id)), migration
-- 122. The self arm let any member end their own membership straight through
-- the API with no clean-up and no guard. Leaving is now `archive_trip_member`.

DROP POLICY IF EXISTS trip_members_delete ON public.trip_members;
CREATE POLICY trip_members_delete ON public.trip_members
  AS PERMISSIVE FOR DELETE TO authenticated
  USING (public.is_trip_planner(trip_id));

-- ── 4 · The role guard admits the archive's own delete (verbatim from 124 plus STEP 1d) ──

CREATE OR REPLACE FUNCTION public.enforce_trip_member_role_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  v_trip_id text;
  v_has_owner boolean;
BEGIN
  -- STEP 1 — THE EARLY EXIT. MUST COME FIRST. Do not hoist the auth check
  -- above it: `merge_guest_to_real_user` repoints memberships (SET user_id,
  -- never role) inside the `handle_new_user` signup trigger, where the acting
  -- identity is the new user. Full reasoning in migration 122.
  IF TG_OP = 'UPDATE' AND NEW.role IS NOT DISTINCT FROM OLD.role THEN
    RETURN NEW;
  END IF;

  v_trip_id := COALESCE(NEW.trip_id, OLD.trip_id);

  -- STEP 1b — trusted infrastructure. No JWT ⇒ not a user acting. RLS is the
  -- outer gate and rejects anon before this runs. See migration 122.
  IF auth.uid() IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  -- STEP 1c — CASCADE FROM A TRIP DELETE (migration 124, the fix).
  -- The parent row is deleted before the FK cascade runs, so a missing trip
  -- means "this whole trip is going away", not "someone is removing a person".
  -- Roster rules have nothing to protect at that point. A caller acting on a
  -- LIVE trip still sees the trip row and is still held to every rule below.
  IF TG_OP = 'DELETE'
     AND NOT EXISTS (SELECT 1 FROM public.trips WHERE id = v_trip_id) THEN
    RETURN OLD;
  END IF;

  -- STEP 1d — THE ARCHIVE (migration 205). `archive_trip_member` marks the
  -- one membership it is ending, transaction-locally, and has already applied
  -- its own rules (an Organizer may LEAVE; only the Owner removes an
  -- Organizer; nobody removes the Owner). Without this an Organizer leaving
  -- would be refused by STEP 5. The marker names trip AND person, so it admits
  -- that delete and no other, and nothing reachable from the API can set it.
  IF TG_OP = 'DELETE'
     AND current_setting('buddytrip.archiving', true) = OLD.trip_id || ':' || OLD.user_id THEN
    RETURN OLD;
  END IF;

  -- STEP 2 — 'Member' grants nothing, so anyone RLS admits may create one.
  IF TG_OP = 'INSERT' AND NEW.role = 'Member' THEN
    RETURN NEW;
  END IF;

  -- STEP 3 — bootstrap: the FIRST Owner of a brand-new trip (`trips.create`
  -- inserts its creator as Owner when no Owner row exists yet).
  IF TG_OP = 'INSERT' AND NEW.role = 'Owner' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.trip_members
      WHERE trip_id = NEW.trip_id AND role = 'Owner'
    ) INTO v_has_owner;
    IF NOT v_has_owner THEN
      RETURN NEW;
    END IF;
  END IF;

  -- STEP 4 — Members (and ghosts, which are Members) may be removed by any
  -- Organizer. Removing an Owner or a fellow Organizer may not (mig 122/123).
  IF TG_OP = 'DELETE' AND OLD.role = 'Member' THEN
    RETURN OLD;
  END IF;

  -- STEP 5 — everything left touches who is trusted. Owner only.
  IF NOT public.has_trip_role(v_trip_id, ARRAY['Owner'::text]) THEN
    RAISE EXCEPTION 'Only the trip owner can grant, change, or remove a member role'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;

-- ── 5 · A departed placeholder is kept (verbatim from 142 plus one condition) ──

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
      )
      -- A placeholder who LEFT a trip is part of its history (migration 205):
      -- their departure record carries the name the crew saw, beside results
      -- and messages that may name their id with no foreign key to stop this
      -- delete. Removing the row would CASCADE the record away and leave that
      -- history pointing at an unknown id. Keep them.
      AND NOT EXISTS (
        SELECT 1 FROM public.trip_departures d WHERE d.user_id = p_user_id
      )
      -- The seat no FK can see. Checked for BOTH sides, and only for
      -- `type = 'user'`: a doubles side names a `play_group`, whose own id is
      -- never a users id, so comparing it here would be comparing two id
      -- spaces that cannot collide.
      AND NOT EXISTS (
        SELECT 1 FROM public.game_matches gm
         WHERE (gm.side_a ->> 'type' = 'user' AND gm.side_a ->> 'id' = p_user_id)
            OR (gm.side_b ->> 'type' = 'user' AND gm.side_b ->> 'id' = p_user_id)
      );
EXCEPTION
  WHEN foreign_key_violation THEN
    -- They still hold history a foreign key CAN see: an expense they paid for,
    -- a split they are part of (both ON DELETE RESTRICT, migration 131), or a
    -- score they submitted. Keep the users row — the placeholder survives with
    -- its history intact, which is the same outcome account deletion produces
    -- (migration 130). The trip removal the owner performed still stands.
    --
    -- NOT a catch-all: only foreign_key_violation is swallowed, so any other
    -- failure still surfaces. The seat check above is a WHERE clause rather
    -- than another exception arm precisely because it raises nothing to catch.
    NULL;
END;
$function$;

-- ── 6 · The guest merge re-keys departures (verbatim from 204 plus two statements) ──
-- CLAUDE.md: a person-referencing table joins the merge in the SAME migration,
-- with collision handling where its key holds user_id.

CREATE OR REPLACE FUNCTION public.merge_guest_to_real_user(p_ghost_id text, p_real_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  -- PK (entrant_id, user_id) — NEW (migration 112): bracket entrant membership.
  -- Collision-safe in the same shape as game_delegates above: if the guest and
  -- the real account are BOTH in the same entrant (an owner pairs a placeholder
  -- with the person it stands for, then that person signs up), a plain UPDATE
  -- raises 23505 INSIDE the signup trigger and signup fails for that user. The
  -- real account is the surviving identity, so the guest's losing row goes first.
  --
  -- Without this the row CASCADES away with the guest and the entrant silently
  -- loses a partner — a 2v2 pairing quietly becomes a 1-player entrant, and the
  -- bracket keeps running with it.
  DELETE FROM public.bracket_entrant_members g
   WHERE g.user_id = p_ghost_id
     AND EXISTS (SELECT 1 FROM public.bracket_entrant_members r
                  WHERE r.entrant_id = g.entrant_id AND r.user_id = p_real_id);
  UPDATE public.bracket_entrant_members SET user_id = p_real_id WHERE user_id = p_ghost_id;

  -- Polymorphic (type,id) pairs — user-typed rows ONLY; team / play_group rows
  -- are a different identity space and must not be touched.
  UPDATE public.score_entries       SET participant_id = p_real_id WHERE participant_id = p_ghost_id AND participant_type = 'user';
  UPDATE public.score_entries       SET submitted_by   = p_real_id WHERE submitted_by   = p_ghost_id;
  -- UNIQUE (game_id, entity_type, entity_id) — 194. The placeholder and the
  -- real account can both have a result in one game (both were added to it;
  -- game_participants above handles the same case). The real account's row
  -- wins, as it does for every other collision here — without this the UPDATE
  -- raises 23505 INSIDE the signup trigger and signup fails.
  DELETE FROM public.game_results g
   WHERE g.entity_type = 'user' AND g.entity_id = p_ghost_id
     AND EXISTS (SELECT 1 FROM public.game_results r
                  WHERE r.game_id = g.game_id AND r.entity_type = 'user' AND r.entity_id = p_real_id);
  UPDATE public.game_results        SET entity_id      = p_real_id WHERE entity_id      = p_ghost_id AND entity_type      = 'user';
  UPDATE public.match_hole_outcomes SET submitted_by   = p_real_id WHERE submitted_by   = p_ghost_id;

  -- Skins hole winners — NEW (migration 184). `winner_user_id` CASCADEs, so
  -- without this a placeholder's won holes are DELETED at signup, and the
  -- carryover downstream of them then recomputes to a different answer. No
  -- collision handling, and that is checked rather than assumed: the only
  -- UNIQUE key on the table is (grouping_id, hole_number), which carries no
  -- user id, so the guest and the real account cannot both hold one.
  UPDATE public.skins_hole_outcomes SET winner_user_id = p_real_id WHERE winner_user_id = p_ghost_id;
  UPDATE public.skins_hole_outcomes SET submitted_by   = p_real_id WHERE submitted_by   = p_ghost_id;

  -- JSONB match sides — NEW. Unreachable by `SET col = value`; the id lives
  -- inside the document. Guarded on type='user' so play_group sides are left
  -- intact (their members moved via game_participants above).
  UPDATE public.game_matches
     SET side_a = jsonb_set(side_a, '{id}', to_jsonb(p_real_id))
   WHERE side_a ->> 'type' = 'user' AND side_a ->> 'id' = p_ghost_id;
  UPDATE public.game_matches
     SET side_b = jsonb_set(side_b, '{id}', to_jsonb(p_real_id))
   WHERE side_b ->> 'type' = 'user' AND side_b ->> 'id' = p_ghost_id;

  -- Credited rosters — NEW (migration 203). The person is a KEY of
  -- `games.credited_roster`, unreachable by `SET col = value` just like the
  -- match sides above. If the guest and the real account are BOTH keys (both
  -- were on the cup roster when the game finalized), the real account's entry
  -- wins, as it does for every other collision here; otherwise the guest's
  -- team moves to the real account. Without this a placeholder's finished
  -- games would credit the real person as teamless on their next re-finalize.
  UPDATE public.games
     SET credited_roster = CASE
           WHEN credited_roster ? p_real_id THEN credited_roster - p_ghost_id
           ELSE (credited_roster - p_ghost_id)
                || jsonb_build_object(p_real_id, credited_roster -> p_ghost_id)
         END
   WHERE credited_roster ? p_ghost_id;

  -- Re-credits — NEW (migration 204). Both person columns: the person whose
  -- credit moved, and the Owner who moved it. No collision handling, checked
  -- rather than assumed: the table's only UNIQUE key is its `id`.
  UPDATE public.game_recredits SET user_id       = p_real_id WHERE user_id       = p_ghost_id;
  UPDATE public.game_recredits SET recredited_by = p_real_id WHERE recredited_by = p_ghost_id;

  -- Trip departures — NEW (migration 205). PK (trip_id, user_id): when both
  -- the guest and the real account have left the same trip, the real
  -- account's record wins, as every other collision here; otherwise the
  -- guest's departure moves to the real account. Without this the guest's
  -- deletion below CASCADEs the record away and their history loses its name.
  DELETE FROM public.trip_departures g
   WHERE g.user_id = p_ghost_id
     AND EXISTS (SELECT 1 FROM public.trip_departures r
                  WHERE r.trip_id = g.trip_id AND r.user_id = p_real_id);
  UPDATE public.trip_departures SET user_id = p_real_id WHERE user_id = p_ghost_id;

  -- Pick'em sheets — NEW (migration 146). Delegated so the sheet-level
  -- collision rule (whole sheets, not rows: pickem_picks carries TWO unique
  -- keys, and a row-wise merge can satisfy one while breaking the other) keeps
  -- its explanation next to the code that implements it.
  PERFORM public.merge_guest_pickem_picks(p_ghost_id, p_real_id);

  -- ── Retire the now-empty ghost ─────────────────────────────────────────────
  DELETE FROM public.users WHERE id = p_ghost_id AND is_guest = true;
END;
$function$;

REVOKE ALL ON FUNCTION public.merge_guest_to_real_user(text, text) FROM PUBLIC, anon, authenticated;
