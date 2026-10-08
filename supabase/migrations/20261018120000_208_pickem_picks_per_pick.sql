-- 208 · A pick'em pick is history once its game has a result
--
-- Zach, 2026-10-08, settling the conflict between ruling 6 (a leaver's sheet in
-- an unfinished pick'em is cleared — a sheet is participation) and ruling 7 (a
-- decided unit is history): "go one level finer than the sheet: per pick."
--
--   - a pick whose slate game HAS A RESULT is history: it stays, and it is
--     credited through the departure's team (8a's roster reader falls back to
--     it, PR 8d-2) — the exact analogue of a decided match;
--   - a pick whose game has NOT been played is cleared — someone who left is
--     no longer playing, so their remaining picks must not go on earning.
--   A sheet with nothing resolved therefore ends up empty, which is ruling 6's
--   behaviour. The two rulings are the same rule at a finer grain.
--
-- "Has a result" is `pickem_slate_games.result IS NOT NULL` — home, away, push
-- or cancelled. A cancelled or pushed game paid nobody, but its pick was still
-- decided, so it is kept with the others rather than special-cased.
--
-- ── Also: a second departure keeps the team the first one recorded ───────
-- The database half of Zach's rejoin ruling (same day): "the departure team
-- applies to any game that was unfinished when they left, whether or not
-- they've rejoined." Someone wins a match (team A, recorded on their
-- departure), rejoins — 8b will not reassign them while that game is
-- unfinished, so they are teamless — and leaves AGAIN before it finalizes. 207
-- recorded the second departure's team (none) over the first, erasing A, and
-- the win paid nobody. A departure now replaces the recorded team only with a
-- team; when they leave on no team, the earlier one stands.
--
-- The residual edge, stated rather than hidden: the second departure moves
-- `left_at` forward, so a game created between the two departures — one they
-- played teamless after rejoining — would also credit A at finalize. That
-- needs a team-independent format (a team-dependent one refuses an
-- unrostered player) and a game finalized after the second departure.
-- Unconfirmed whether that should credit A or nobody; left as A, the team they
-- were last on.

-- ── 1 · The archive (verbatim from 207, with the two edits marked 208) ──

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

    -- Bracket entries are NOT touched here. Ruled to start from the same
    -- answer as seats, but a bracket needs design a seat does not — a
    -- vacated entrant probably forfeits and the opponent advances — so it is
    -- 8d-2's verify-first. Until then their entry stands and counts as
    -- history below. Nothing calls this function before 8d-2 anyway.
  END IF;

  -- The departure, only if something left in the trip still names them.
  IF public._trip_history_names(p_trip_id, p_user_id) THEN
    INSERT INTO public.trip_departures (trip_id, user_id, display_name, left_at, team_id)
    VALUES (p_trip_id, p_user_id, coalesce(v_name, 'Someone'), now(), v_team)
    ON CONFLICT (trip_id, user_id)
    -- A team replaces the recorded one; leaving on NO team keeps the earlier
    -- one (migration 208): a winner who rejoined teamless — 8b will not
    -- reassign them while the game is unfinished — and leaves again must not
    -- erase the team their decided match pays.
    DO UPDATE SET display_name = EXCLUDED.display_name, left_at = EXCLUDED.left_at,
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
