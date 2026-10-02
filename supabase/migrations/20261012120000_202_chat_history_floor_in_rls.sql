-- 202 — the chat history floor, enforced by the messages policy.
--
-- ── What was wrong ───────────────────────────────────────────────────────────
-- Three floors decide how far back a person may read chat:
--   trip_members.chat_visible_from      — Crew history, stamped when added
--   trip_members.planning_visible_from  — Organizers history, stamped on promotion
--   team_assignments.team_visible_from  — a team room, stamped when assigned
-- They existed ONLY in `messages.list`, which read the floor and added
-- `created_at >= floor`. `messages_select` (migration 008, unchanged since)
-- checks membership, the team arm and the Organizers channel, and never a
-- floor. So the one layer enforcing it was the one that could fail: the floor
-- read ignored its error, a failed read left the floor NULL, and NULL means
-- "sees all history" — a newly added member served Crew history from before
-- they joined, a newly promoted Organizer served planning from before their
-- promotion. Found by the #1539 census. Any client that reads `messages`
-- directly through PostgREST with its own JWT skipped the floor entirely.
--
-- A disclosure does not roll back, which is why this is enforced where it
-- cannot be skipped: in the row policy, so it holds whatever a procedure does
-- or does not read. (The procedure keeps its own floor too, now read through
-- the rowOrThrow family, so it fails closed as well — but it is no longer the
-- thing the guarantee rests on.)
--
-- ── Semantics: exactly the procedure's, plus one exemption ──────────────────
--   * channel 'trip': visibility 'crew' → chat_visible_from;
--                     visibility 'planning' → planning_visible_from.
--   * channel 'team': team_visible_from from THE assignment the team arm
--     already requires. (Team messages are stamped visibility 'crew'; the trip
--     floors do NOT apply to them — same as the procedure.)
--   * NULL floor = no floor (every existing row before the columns existed).
--   * A person always sees their OWN messages. Required, not a convenience:
--     `messages.send` inserts and reads the row back in one statement
--     (INSERT … RETURNING), which must pass this policy. The floors are stamped
--     with the APP server's clock and `created_at` with the DATABASE's, so an
--     Organizer posting the moment they are promoted could otherwise have their
--     own new message fail the floor by a few milliseconds of skew. Showing
--     someone what they wrote discloses nothing.
--
-- ── The helper answers about the CALLER (CLAUDE.md #28) ─────────────────────
-- `trip_chat_floor_allows(trip, visibility, created_at)` reads the caller's own
-- trip_members row via auth.uid(). Change the caller, keep the arguments, and
-- the answer moves — so granting it to `authenticated` leaks nothing about
-- anyone else. It is SECURITY DEFINER only so the policy does not re-enter
-- trip_members' own RLS per row. Returns FALSE for a non-member.
--
-- ── Carried forward unchanged from 008 / 172 ────────────────────────────────
-- The team arm still has NO staff branch, and still reads team_assignments and
-- competitions directly (see the 172 comment on this policy — that fragility
-- stands; this migration only adds the floor to the same subquery).

CREATE OR REPLACE FUNCTION public.trip_chat_floor_allows(
  p_trip_id text,
  p_visibility text,
  p_created_at timestamptz
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT COALESCE((
    SELECT CASE p_visibility
             WHEN 'planning' THEN tm.planning_visible_from IS NULL OR p_created_at >= tm.planning_visible_from
             ELSE tm.chat_visible_from IS NULL OR p_created_at >= tm.chat_visible_from
           END
    FROM public.trip_members tm
    WHERE tm.trip_id = p_trip_id
      AND tm.user_id = (auth.uid())::text
  ), false);
$function$;

COMMENT ON FUNCTION public.trip_chat_floor_allows(text, text, timestamptz) IS
  'Does the CALLER''s trip chat floor admit a message created at p_created_at in this visibility? Reads only the caller''s own trip_members row (auth.uid()), so it answers about the caller and leaks nothing about anyone else (CLAUDE.md #28). NULL floor = no floor; non-member = false. Used by messages_select (migration 202).';

REVOKE ALL ON FUNCTION public.trip_chat_floor_allows(text, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trip_chat_floor_allows(text, text, timestamptz) TO authenticated;

DROP POLICY IF EXISTS messages_select ON public.messages;
CREATE POLICY messages_select ON public.messages FOR SELECT TO authenticated
  USING (
    is_trip_member(trip_id)
    AND (
      (
        channel = 'trip'::text
        AND (
          user_id = (auth.uid())::text
          OR public.trip_chat_floor_allows(trip_id, visibility, created_at)
        )
      )
      OR (
        channel = 'team'::text
        AND EXISTS (
          SELECT 1 FROM team_assignments ta
          JOIN competitions c ON c.id = ta.competition_id
          WHERE c.trip_id = messages.trip_id
            AND ta.team_id = messages.team_id
            AND ta.user_id = (auth.uid())::text
            AND (
              ta.team_visible_from IS NULL
              OR messages.created_at >= ta.team_visible_from
              OR messages.user_id = (auth.uid())::text
            )
        )
      )
    )
    AND (
      (visibility = 'crew'::text)
      OR ((visibility = 'planning'::text) AND is_trip_planner(trip_id))
    )
  );

COMMENT ON POLICY messages_select ON public.messages IS
  'History FLOOR enforced here since migration 202: trip messages need created_at >= the caller''s chat_visible_from (crew) / planning_visible_from (planning) via trip_chat_floor_allows; team messages need created_at >= the caller''s team_visible_from on the assignment the team arm requires. NULL floor = no floor. A person always sees their OWN messages (INSERT … RETURNING in messages.send must pass this policy, and floors use the app clock while created_at uses the DB clock). '
  'Team arm has NO staff branch, deliberately: Owner, Organizer and delegate read a team chat only when they hold a team_assignments row for THAT team (verified against prod in 172; a staff branch would put refusals at zero, which is the mutation check). '
  'FRAGILITY (from 172, unchanged): the team arm reads team_assignments and competitions DIRECTLY rather than through a SECURITY DEFINER helper. Postgres applies RLS inside policy subqueries, so this works ONLY because team_assignments_select and competitions_select are both member-wide. If either is ever narrowed, team chat goes dark for its own members with no error. Re-check this policy in the same change, or move the subquery behind a definer helper first.';
