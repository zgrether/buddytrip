-- 206 · A team captain's rights require trip membership
--
-- The same change migration 205 made to `is_game_delegate`, for the other
-- relationship row that confers rights: a captaincy (`team_assignments
-- .is_captain`). A right granted through a relationship row ends with the
-- membership that made it meaningful (Zach, 2026-10-08), not with whatever
-- clean-up runs when someone leaves.
--
-- Was (migration 094): the assignment row alone. Still keyed to the caller,
-- so it says nothing about anyone else however widely it is granted
-- (CLAUDE.md #28); signature, volatility and ACL unchanged (CREATE OR REPLACE
-- keeps the grants). The trip is the team's competition's trip — a team cannot
-- move between competitions, nor a competition between trips.

CREATE OR REPLACE FUNCTION public.is_team_captain(p_team_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.team_assignments ta
      JOIN public.teams t ON t.id = ta.team_id
      JOIN public.competitions c ON c.id = t.competition_id
     WHERE ta.team_id = p_team_id
       AND ta.user_id = (auth.uid())::text
       AND ta.is_captain
       AND public.is_trip_member(c.trip_id)
  );
$function$;
