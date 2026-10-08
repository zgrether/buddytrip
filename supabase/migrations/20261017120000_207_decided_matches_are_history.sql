-- 207 · A decided match is history — it keeps its seats and its team
--
-- Zach, 2026-10-08, on 8d-2's open question: "a decided match is history ...
-- A match that's been won was won; the winner's team earned those points,
-- and a departure later in the day shouldn't quietly erase them." The rule
-- that settles finished games (205 keeps them exactly as they are) applied at
-- the smallest unit that can be decided.
--
-- 205 vacated every seat in an unfinished game. For a match already won or
-- halved that erased a real result: an emptied side counts as unpaired
-- (`tallyMatchAwardsDetailed`, src/lib/matchAwards.ts), so the match paid
-- nobody, and the standings changed with nothing on screen to say why. Even a
-- kept seat would not have paid: a game that has never finalized credits
-- through TODAY's roster, and the archive deletes the leaver's assignment.
--
-- So two things change, and only for decided matches:
--   - in an unfinished game, a DECIDED match keeps both seats, and the
--     leaver keeps their participant row in that game (it is what resolves a
--     doubles side to its players). UNDECIDED matches are unchanged: the seat
--     empties, because someone leaving mid-round really has left.
--   - the departure records the leaver's cup team (`trip_departures.team_id`).
--     8a's roster reader (`readCreditRoster`) falls back to it for a departed
--     person, so the decided match pays the team they were on when it was won.
--
-- Deliberately NOT done: writing a partial `games.credited_roster` into an
-- unfinished game. 8a's rule is that a stored roster, once it exists, is
-- authoritative — a map holding only the leaver would tell finalize everyone
-- else was on no team, and credit the whole game to nobody (empty is not
-- unknown). The team rides on the departure instead, and the roster is still
-- recorded only at the first finalize, whole.

-- ── Also: a system line is not history ──────────────────────────────────
-- 205's `_trip_history_names` counted ANY message naming the person. Adding a
-- placeholder posts a "joined" system line whose `messages.user_id` is the
-- placeholder (it is what lets one row read as a welcome to them and a notice
-- to everyone else — `postSystemMessage`'s `subjectUserId`). So every
-- placeholder added through the app had "history", a departure was always
-- written, and `delete_orphan_guest_user` always kept them: ruling 5 ("no
-- history, delete as before") could never apply. Found by the 8d-2 wiring's
-- own test of removing a placeholder. A line the app wrote ABOUT someone is
-- not something they did, so only non-system messages count. Nothing calls the
-- archive in production yet, so no departure was ever written on this basis.

-- ── 1 · The departure records the leaver's cup team ──────────────────────

ALTER TABLE public.trip_departures
  ADD COLUMN IF NOT EXISTS team_id text REFERENCES public.teams(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.trip_departures.team_id IS
  'The cup team the person was on when they left (migration 207). Read by readCreditRoster as a fallback for a departed person, so a match they had already decided still pays that team at finalize. NULL: on no team, or the team was deleted since.';

-- ── 2 · Only what a person WROTE is history, not a line written about them ──
-- (verbatim from 205 with the messages arm narrowed to non-system rows)

CREATE OR REPLACE FUNCTION public._trip_history_names(p_trip_id text, p_user_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO ''
AS $$
  SELECT
       EXISTS (SELECT 1 FROM public.messages x WHERE x.trip_id = p_trip_id AND x.user_id = p_user_id
                 AND x.message_type <> 'system')
    OR EXISTS (SELECT 1 FROM public.expenses x WHERE x.trip_id = p_trip_id AND (x.paid_by_user_id = p_user_id OR x.created_by = p_user_id))
    OR EXISTS (SELECT 1 FROM public.expense_splits x JOIN public.expenses e ON e.id = x.expense_id WHERE e.trip_id = p_trip_id AND x.user_id = p_user_id)
    OR EXISTS (SELECT 1 FROM public.news_posts x WHERE x.trip_id = p_trip_id AND x.author_id = p_user_id)
    OR EXISTS (SELECT 1 FROM public.schedule_items x WHERE x.trip_id = p_trip_id AND (x.created_by = p_user_id OR x.confirmed_by = p_user_id))
    OR EXISTS (SELECT 1 FROM public.logistics_items x WHERE x.trip_id = p_trip_id AND x.created_by = p_user_id)
    OR EXISTS (SELECT 1 FROM public.quick_info_tiles x WHERE x.trip_id = p_trip_id AND x.created_by = p_user_id)
    OR EXISTS (SELECT 1 FROM public.idea_lodging_options x WHERE x.trip_id = p_trip_id AND x.created_by = p_user_id)
    OR EXISTS (SELECT 1 FROM public.idea_votes x WHERE x.trip_id = p_trip_id AND x.user_id = p_user_id)
    OR EXISTS (SELECT 1 FROM public.date_poll_votes x JOIN public.date_windows w ON w.id = x.window_id WHERE w.trip_id = p_trip_id AND x.user_id = p_user_id)
    OR EXISTS (SELECT 1 FROM public.invites x WHERE x.trip_id = p_trip_id AND x.created_by = p_user_id)
    OR EXISTS (
      SELECT 1 FROM public.games g
       WHERE g.trip_id = p_trip_id
         AND (
              EXISTS (SELECT 1 FROM public.game_participants x WHERE x.game_id = g.id AND x.user_id = p_user_id)
           OR EXISTS (SELECT 1 FROM public.game_results x WHERE x.game_id = g.id AND x.entity_type = 'user' AND x.entity_id = p_user_id)
           OR EXISTS (SELECT 1 FROM public.score_entries x WHERE x.game_id = g.id AND ((x.participant_type = 'user' AND x.participant_id = p_user_id) OR x.submitted_by = p_user_id))
           OR EXISTS (SELECT 1 FROM public.match_hole_outcomes x WHERE x.game_id = g.id AND x.submitted_by = p_user_id)
           OR EXISTS (SELECT 1 FROM public.skins_hole_outcomes x WHERE x.game_id = g.id AND (x.submitted_by = p_user_id OR x.winner_user_id = p_user_id))
           OR EXISTS (SELECT 1 FROM public.game_matches x WHERE x.game_id = g.id
                        AND ((x.side_a ->> 'type' = 'user' AND x.side_a ->> 'id' = p_user_id)
                          OR (x.side_b ->> 'type' = 'user' AND x.side_b ->> 'id' = p_user_id)))
           OR EXISTS (SELECT 1 FROM public.pickem_picks x WHERE x.game_id = g.id AND (x.user_id = p_user_id OR x.entered_by = p_user_id))
           OR EXISTS (SELECT 1 FROM public.bracket_entrant_members x JOIN public.bracket_entrants be ON be.id = x.entrant_id WHERE be.game_id = g.id AND x.user_id = p_user_id)
           OR EXISTS (SELECT 1 FROM public.game_recredits x WHERE x.game_id = g.id AND (x.user_id = p_user_id OR x.recredited_by = p_user_id))
           OR EXISTS (SELECT 1 FROM public.game_delegates x WHERE x.game_id = g.id AND x.granted_by = p_user_id)
         )
    );
$$;

REVOKE ALL ON FUNCTION public._trip_history_names(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._trip_history_names(text, text) TO service_role;

-- ── 3 · The archive (verbatim from 205, with the edits marked 207) ──

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

    -- Their pick'em sheet in an unfinished game. A sheet is participation,
    -- the same as a seat (Zach, 2026-10-08): someone who has left has left
    -- the contest too. Sheets in FINISHED games are history and stay. Only
    -- their OWN sheet: one they entered for someone else is that person's.
    DELETE FROM public.pickem_picks
     WHERE user_id = p_user_id AND game_id = ANY(v_game_ids);

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
    DO UPDATE SET display_name = EXCLUDED.display_name, left_at = EXCLUDED.left_at,
                  team_id = EXCLUDED.team_id;
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
