-- 209 · A bracket entrant withdraws when its last member leaves
--
-- Ruling 8 (Zach, 2026-10-08): bracket entries follow the seat rule — leaving
-- vacates participation in brackets still being played — through a WITHDRAWN
-- mark that both resolvers treat like a bye:
--   - a match with nobody left on one side is a WALKOVER: the other side
--     advances, with no pick, at every match not already decided;
--   - a match with nobody left on EITHER side produces an empty slot that the
--     next round treats as a bye — so any chain of withdrawals resolves without
--     the resolver needing to know why a side is empty;
--   - the withdrawn entrant is eliminated outright (in double elimination a
--     walkover loss never drops it to the lower bracket) and placed in the
--     round it withdrew; a result recorded BEFORE the withdrawal stands;
--   - nothing recorded is deleted: entrant rows and member rows stay.
-- Partnerships: the partner plays on; the entrant withdraws only when its LAST
-- member still on the trip leaves.
--
-- The mark is stored, not derived from membership, on purpose: derived, a
-- rejoin would un-withdraw the entrant and silently reverse every walkover the
-- bracket has already resolved through.
--
-- The resolver half is client-safe code (`bracketAdvance.ts`,
-- `bracketDoubleAdvance.ts`), read through `readBracketDraw`.

-- ── 1 · The mark ───────────────────────────────────────────────────────────

ALTER TABLE public.bracket_entrants
  ADD COLUMN IF NOT EXISTS withdrawn_at timestamptz;

COMMENT ON COLUMN public.bracket_entrants.withdrawn_at IS
  'When the entrant withdrew: set by archive_trip_member as its last member still on the trip leaves a bracket being played (migration 209). Read by both bracket resolvers: a walkover for the opponent at every match not already decided. NULL: still in it.';

-- ── 2 · The archive withdraws an entrant (verbatim from 208, edit marked 209) ──

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
  v_team        text;
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

  -- Delegate grants on ANY of this trip's games, finished or not: a grant is a
  -- right, not history. `is_game_delegate` requires membership too (§2b), so
  -- this is housekeeping — a grant naming someone off the trip says nothing
  -- true, and the delegate list should not show them.
  DELETE FROM public.game_delegates gd
   USING public.games g
   WHERE g.id = gd.game_id AND g.trip_id = p_trip_id AND gd.user_id = p_user_id;

  -- Their cup team, read BEFORE the assignment goes (migration 207). One cup
  -- per trip (competitions_one_per_trip), and one team per person per cup, so
  -- one value covers every unfinished game they keep a decided match in. It
  -- rides on the departure record below, where 8a's roster reader finds it.
  SELECT ta.team_id INTO v_team
    FROM public.team_assignments ta
    JOIN public.competitions c ON c.id = ta.competition_id
   WHERE c.trip_id = p_trip_id AND ta.user_id = p_user_id;

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
         -- UNDECIDED matches only (migration 207, Zach 2026-10-08): a match
         -- that has been won or halved was won or halved, so it keeps both
         -- seats and pays the team the leaver was on (see the departure's
         -- team below). Same definition of decided as the participation
         -- guard: a result, or a completed status.
         AND gm.result IS NULL
         AND gm.status IS DISTINCT FROM 'complete'
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

    -- Their participation goes too — EXCEPT in a game where they hold a
    -- decided match. That row is what resolves a doubles side to its players
    -- (and so to a team) at finalize, and the decided match is history.
    DELETE FROM public.game_participants gp
     WHERE gp.user_id = p_user_id AND gp.game_id = ANY(v_game_ids)
       AND NOT EXISTS (
         SELECT 1 FROM public.game_matches gm
          WHERE gm.game_id = gp.game_id
            AND (gm.result IS NOT NULL OR gm.status = 'complete')
            AND (   (gm.side_a ->> 'type' = 'user' AND gm.side_a ->> 'id' = p_user_id)
                 OR (gm.side_b ->> 'type' = 'user' AND gm.side_b ->> 'id' = p_user_id)
                 OR (gp.play_group_id IS NOT NULL
                     AND (gm.side_a ->> 'id' = gp.play_group_id OR gm.side_b ->> 'id' = gp.play_group_id)))
       );

    -- Their pick'em picks in an unfinished game, PER PICK (migration 208,
    -- Zach 2026-10-08). A pick whose slate game has a result is history and
    -- stays, credited through the departure's team; a pick on a game not yet
    -- played is cleared, because someone who has left is not still playing.
    -- A sheet with nothing resolved ends up empty (ruling 6). Sheets in
    -- FINISHED games are untouched (they are not in v_game_ids). Only their
    -- OWN picks: a sheet they entered for someone else is that person's.
    DELETE FROM public.pickem_picks pp
     WHERE pp.user_id = p_user_id AND pp.game_id = ANY(v_game_ids)
       AND NOT EXISTS (
         SELECT 1 FROM public.pickem_slate_games sg
          WHERE sg.id = pp.slate_game_id AND sg.game_id = pp.game_id
            AND sg.result IS NOT NULL
       );

    -- Bracket entrants (migration 209, ruling 8). An entrant WITHDRAWS when its
    -- last member still on the trip leaves — a partner who is still here plays
    -- on, as a doubles seat does in golf. Withdrawal is a MARK, not a delete:
    -- the entrant row and its member rows stay (deleting an entrant cascades
    -- away its round-1 matches and clears any win it was picked for), and both
    -- bracket resolvers read the mark — the opponent advances by walkover at
    -- every match not already decided, the withdrawn entrant is eliminated
    -- outright and placed in the round it withdrew, and a result recorded
    -- before the withdrawal stands. Only brackets still being played: a
    -- finished one is history (and one reopened for corrections stays
    -- `complete`, so it is not in v_game_ids).
    UPDATE public.bracket_entrants be
       SET withdrawn_at = now()
     WHERE be.game_id = ANY(v_game_ids)
       AND be.withdrawn_at IS NULL
       AND EXISTS (
         SELECT 1 FROM public.bracket_entrant_members m
          WHERE m.entrant_id = be.id AND m.user_id = p_user_id
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.bracket_entrant_members m
           JOIN public.trip_members tm ON tm.trip_id = p_trip_id AND tm.user_id = m.user_id
          WHERE m.entrant_id = be.id AND m.user_id <> p_user_id
       );
  END IF;

  -- The departure, only if something left in the trip still names them.
  IF public._trip_history_names(p_trip_id, p_user_id) THEN
    INSERT INTO public.trip_departures (trip_id, user_id, display_name, left_at, team_id)
    VALUES (p_trip_id, p_user_id, coalesce(v_name, 'Someone'), now(), v_team)
    ON CONFLICT (trip_id, user_id)
    -- A team replaces the recorded one; leaving on NO team keeps the earlier
    -- one AND the moment it was recorded (migration 208): a winner who rejoined
    -- teamless — 8b will not reassign them while the game is unfinished — and
    -- leaves again must not erase the team their decided match pays. The team
    -- and its time are one fact ("on A as of when they first left"), so a game
    -- created between the two departures is newer than it and takes nothing.
    DO UPDATE SET display_name = EXCLUDED.display_name,
                  left_at = CASE WHEN EXCLUDED.team_id IS NULL AND trip_departures.team_id IS NOT NULL
                                 THEN trip_departures.left_at ELSE EXCLUDED.left_at END,
                  team_id = coalesce(EXCLUDED.team_id, trip_departures.team_id);
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

-- ── 3 · The guest merge, its comment corrected to ruling 8 (verbatim from 205) ──

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
  -- Without this the row CASCADES away with the guest and the entrant loses a
  -- member by ACCIDENT: a signup is not a departure. (A partner who LEAVES is a
  -- different case, and there the remaining partner plays on — ruling 8,
  -- migration 209 — so a one-member entrant is not itself the fault. This
  -- comment used to call it one, which the ruling reversed.)
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
