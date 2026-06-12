-- 045 · Slice D1 (§8) — per-game organizer resolution at the DB layer.
--
-- The rule: can-edit-a-game = trip Owner/Organizer (canEdit) OR a delegated
-- organizer of THAT game. Game-isolated. We land the rule + RLS now so the moment
-- per-game organizers exist every game/game_results write already honors them
-- (no twelve-call-site retrofit later — same lesson as effectiveStrokes).
--
-- These policies are PERMISSIVE, so they OR with the existing trip-role policies
-- (games_write / game_results_write) — they ADD the delegate path, remove nothing.
-- Idempotent.

-- is_game_organizer(game) — is the current auth user a delegated organizer of it?
-- users.id is text = auth uid as text (app-wide text-id convention), so compare
-- against auth.uid()::text. SECURITY DEFINER + pinned search_path so RLS can call
-- it without recursing into game_organizers' own policies.
CREATE OR REPLACE FUNCTION public.is_game_organizer(p_game_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.game_organizers go
    WHERE go.game_id = p_game_id
      AND go.user_id = (auth.uid())::text
  );
$$;

-- A delegated organizer may UPDATE (configure) their game — NOT insert (you can't
-- be delegated to a game that doesn't exist yet) and NOT hard-delete (dropping is
-- a status UPDATE). Trip staff keep full ALL via games_write.
DROP POLICY IF EXISTS games_update_delegate ON public.games;
CREATE POLICY games_update_delegate ON public.games
  FOR UPDATE
  USING (public.is_game_organizer(id))
  WITH CHECK (public.is_game_organizer(id));

-- A delegated organizer may enter/clear results for their game (the manual
-- adapter writes game_results; engine computes also land here). Trip staff keep
-- full ALL via game_results_write.
DROP POLICY IF EXISTS game_results_delegate ON public.game_results;
CREATE POLICY game_results_delegate ON public.game_results
  FOR ALL
  USING (public.is_game_organizer(game_id))
  WITH CHECK (public.is_game_organizer(game_id));
