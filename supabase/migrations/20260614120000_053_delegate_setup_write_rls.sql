-- 053 · Stage 4 (§10) — extend the per-game delegate path to the SETUP-write
-- tables so a game's delegate can actually run it.
--
-- Migration 045 landed the delegate rule (is_game_organizer / requireGameEdit)
-- on `games` (update) and `game_results` (all). But the match/rack SETUP
-- mutations write three more tables — game_participants, play_groups,
-- game_matches — whose write policies still require Owner/Organizer only. So
-- once Stage 4 swapped the matches/playGroups routers to requireGameEdit(), a
-- delegate cleared the server gate but then hit RLS on these tables. This
-- finishes the delegate path (the CLAUDE.md "no twelve-call-site retrofit"
-- lesson — land the rule on EVERY table the action writes).
--
-- These policies are PERMISSIVE, so they OR with the existing Owner/Organizer
-- write policies (game_participants_write / play_groups_write /
-- game_matches_write) — they ADD the delegate path, remove nothing. Idempotent.
-- is_game_organizer(game) is defined in migration 045 (SECURITY DEFINER).

-- game_participants: a delegate may add/clear the roster + handicaps for THEIR
-- game (setPairings/assignPlayer/setFoursomes/setHandicap all write here).
DROP POLICY IF EXISTS game_participants_delegate ON public.game_participants;
CREATE POLICY game_participants_delegate ON public.game_participants
  FOR ALL
  USING (public.is_game_organizer(game_id))
  WITH CHECK (public.is_game_organizer(game_id));

-- play_groups: a delegate may rebuild the foursomes for THEIR game (setFoursomes).
DROP POLICY IF EXISTS play_groups_delegate ON public.play_groups;
CREATE POLICY play_groups_delegate ON public.play_groups
  FOR ALL
  USING (public.is_game_organizer(game_id))
  WITH CHECK (public.is_game_organizer(game_id));

-- game_matches: a delegate may set/reorder/activate the matchups for THEIR game
-- (setPairings/assignPlayer/reorder/activate).
DROP POLICY IF EXISTS game_matches_delegate ON public.game_matches;
CREATE POLICY game_matches_delegate ON public.game_matches
  FOR ALL
  USING (public.is_game_organizer(game_id))
  WITH CHECK (public.is_game_organizer(game_id));
