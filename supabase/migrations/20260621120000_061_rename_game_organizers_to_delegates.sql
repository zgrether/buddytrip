-- 061 · R4 Rename 3 — game_organizers → game_delegates (table + helper + policies)
--
-- The per-game delegation table was named `game_organizers`, which collides with
-- the TRIP role "Organizer": a row here grants a GAME-scope delegate, NOT a
-- trip-wide Organizer. R4 ratifies one game-scope term — `delegate` — so this
-- renames the table, its two own-table RLS policies, and the
-- is_game_organizer() helper → is_game_delegate(), keeping every dependent
-- policy in lockstep (the helper is called by 5 PERMISSIVE delegate policies
-- across games / game_results [045] and game_participants / play_groups /
-- game_matches [053]).
--
-- DB-VALUE layer: tsc cannot catch a missed RLS reference, so every dependent
-- policy is rebuilt explicitly here rather than relying on OID-deparse. The
-- data and the access rules are byte-for-byte identical — behavior-preserving.
-- Idempotent.

-- 1. Rename the table. PK + the two outbound FKs (games, users) + ON DELETE
--    CASCADE follow by OID; no data moves.
ALTER TABLE IF EXISTS public.game_organizers RENAME TO game_delegates;

-- 2. Its two own-table policies — drop under either name, recreate under the new
--    one (the bodies are unchanged except the table-qualified column name).
DROP POLICY IF EXISTS game_organizers_select ON public.game_delegates;
DROP POLICY IF EXISTS game_delegates_select ON public.game_delegates;
CREATE POLICY game_delegates_select ON public.game_delegates
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.games g
    WHERE g.id = game_delegates.game_id AND is_trip_member(g.trip_id)
  ));

DROP POLICY IF EXISTS game_organizers_write ON public.game_delegates;
DROP POLICY IF EXISTS game_delegates_write ON public.game_delegates;
CREATE POLICY game_delegates_write ON public.game_delegates
  FOR ALL USING (EXISTS (
    SELECT 1 FROM public.games g
    WHERE g.id = game_delegates.game_id
      AND has_trip_role(g.trip_id, ARRAY['Owner'::text, 'Organizer'::text])
  )) WITH CHECK (EXISTS (
    SELECT 1 FROM public.games g
    WHERE g.id = game_delegates.game_id
      AND has_trip_role(g.trip_id, ARRAY['Owner'::text, 'Organizer'::text])
  ));

-- 3. New helper reading the renamed table. SECURITY DEFINER + pinned search_path
--    so RLS can call it without recursing into game_delegates' own policies
--    (identical contract to the old is_game_organizer). The old helper is
--    dropped in step 5 once no policy depends on it.
CREATE OR REPLACE FUNCTION public.is_game_delegate(p_game_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.game_delegates gd
    WHERE gd.game_id = p_game_id
      AND gd.user_id = (auth.uid())::text
  );
$$;

-- 4. Repoint the five dependent delegate policies to the new helper. These are
--    the SILENT-BREAK sites — each is recreated verbatim except the helper name.
DROP POLICY IF EXISTS games_update_delegate ON public.games;
CREATE POLICY games_update_delegate ON public.games
  FOR UPDATE
  USING (public.is_game_delegate(id))
  WITH CHECK (public.is_game_delegate(id));

DROP POLICY IF EXISTS game_results_delegate ON public.game_results;
CREATE POLICY game_results_delegate ON public.game_results
  FOR ALL
  USING (public.is_game_delegate(game_id))
  WITH CHECK (public.is_game_delegate(game_id));

DROP POLICY IF EXISTS game_participants_delegate ON public.game_participants;
CREATE POLICY game_participants_delegate ON public.game_participants
  FOR ALL
  USING (public.is_game_delegate(game_id))
  WITH CHECK (public.is_game_delegate(game_id));

DROP POLICY IF EXISTS play_groups_delegate ON public.play_groups;
CREATE POLICY play_groups_delegate ON public.play_groups
  FOR ALL
  USING (public.is_game_delegate(game_id))
  WITH CHECK (public.is_game_delegate(game_id));

DROP POLICY IF EXISTS game_matches_delegate ON public.game_matches;
CREATE POLICY game_matches_delegate ON public.game_matches
  FOR ALL
  USING (public.is_game_delegate(game_id))
  WITH CHECK (public.is_game_delegate(game_id));

-- 5. Drop the old helper now that all five policies point at the new one. If any
--    reference were missed this DROP fails loudly (dependency error) rather than
--    leaving two names live — the intended safety net.
DROP FUNCTION IF EXISTS public.is_game_organizer(text);
