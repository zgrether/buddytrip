-- 147 — the pick'em lifecycle predicates answer only for a trip you are on.
--
-- Follow-up to migration 146, closing a gap found by running the Supabase
-- security advisor against production immediately after 146 was pushed, and
-- then PROVING the finding rather than reasoning about it.
--
-- ══ What was reachable ══════════════════════════════════════════════════════
--
-- `pickem_picks_open` and `pickem_picks_revealed` are SECURITY DEFINER, because
-- a policy on `pickem_picks` must not depend on the caller being able to read
-- `pickem_games` under its own policy. That part is right and is unchanged.
--
-- What was wrong is that neither established WHO was asking. Both are in the
-- exposed API schema, so `authenticated` can call them directly:
--
--   POST /rest/v1/rpc/pickem_picks_open  {"p_game_id": "<some game>"}  → true
--
-- Measured against a local stack with a real JWT, as a signed-in user who is
-- NOT a member of the game's trip:
--
--   pickem_picks_open(game)      → true
--   pickem_picks_revealed(game)  → false
--   SELECT … FROM pickem_games   → []      ← the same account, same row
--
-- The last line is the point. The table policy already refused this person;
-- the function in front of it did not. That is the RLS audit's recurring shape
-- — a definer helper wider than the policy it serves — and it is worth fixing
-- here even though what leaks is small.
--
-- ══ Why this is a category difference, not "consistent with the others" ═════
--
-- The tempting defence is that `is_trip_member`, `has_trip_role` and
-- `is_game_delegate` are all `authenticated`-executable SECURITY DEFINER
-- functions too, and the advisor flags all of them. But every one of those
-- answers a question ABOUT THE CALLER: "am I a member", "do I have this role",
-- "am I a delegate". Calling them with someone else's container id tells you
-- something about YOURSELF, so there is nothing to leak.
--
-- 146's two predicates answer a question about A GAME — "are this game's picks
-- open" — and the answer does not depend on who is asking. That is the first
-- pair of that kind in this schema, so the existing helpers are not a precedent
-- for leaving them open; they are a precedent for the opposite.
--
-- ══ What actually leaks, stated honestly ════════════════════════════════════
--
-- A lifecycle boolean about a game whose id the caller already knows. It is NOT
-- a path to reading a sheet: `pickem_picks_select` is unchanged and still has no
-- staff branch, and knowing that picks are open does not make anyone's picks
-- readable. Game ids are `text` and not enumerable through the API, but they do
-- appear in URLs, so "you would have to know the id" is a cost, not a wall.
--
-- Low severity, cheap fix, and the phase this belongs to is the one where this
-- class of thing is supposed to be right.
--
-- ══ Why this changes no behaviour through the policies ══════════════════════
--
-- Both call sites already AND with trip membership:
--
--   pickem_picks_select  … is_trip_member(g.trip_id) AND (own row OR revealed(…))
--   pickem_picks_write   … own row AND open(…) AND is_trip_member(g.trip_id)
--
-- so the new condition is redundant THERE and cannot alter a policy decision.
-- It only changes the answer on the direct-RPC path, which is exactly the path
-- that was too wide. Pinned by tests on both sides: the non-member now gets
-- `false`, and every existing policy case in `pickemPicksPolicy.rls.test.ts`
-- still passes unchanged.
--
-- `is_trip_member` reads `auth.uid()`, which is a request GUC and not affected
-- by SECURITY DEFINER's role switch — a definer function calling another
-- definer function still sees the ORIGINAL caller's JWT claims. That is already
-- how every policy in this schema composes these helpers.
--
-- A caller with no JWT at all (`anon`) never reaches either function: 146
-- revoked EXECUTE from PUBLIC and anon, and that stands.

CREATE OR REPLACE FUNCTION public.pickem_picks_open(p_game_id text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.pickem_games pg
      JOIN public.games g ON g.id = pg.game_id
     WHERE pg.game_id = p_game_id
       AND public.is_trip_member(g.trip_id)
       AND pg.picks_opened_at IS NOT NULL
       AND pg.picks_locked_at IS NULL
       AND (pg.picks_deadline IS NULL OR now() <= pg.picks_deadline)
  );
$function$;

CREATE OR REPLACE FUNCTION public.pickem_picks_revealed(p_game_id text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.pickem_games pg
      JOIN public.games g ON g.id = pg.game_id
     WHERE pg.game_id = p_game_id
       AND public.is_trip_member(g.trip_id)
       AND pg.picks_opened_at IS NOT NULL
       AND (pg.picks_locked_at IS NOT NULL
            OR (pg.picks_deadline IS NOT NULL AND now() > pg.picks_deadline))
  );
$function$;

COMMENT ON FUNCTION public.pickem_picks_open(text) IS
  'Is this pick''em game accepting picks right now, ASKED BY SOMEONE ON ITS TRIP? Opened, not hand-locked, and either no deadline or the deadline has not passed. Membership is checked inside the function, not only in the policies that call it, because the function is directly callable at /rest/v1/rpc and a non-member could otherwise read a game''s lifecycle state the table policy refuses them (migration 147). Evaluated lazily at every write because no scheduler exists to fire the deadline.';
COMMENT ON FUNCTION public.pickem_picks_revealed(text) IS
  'Are this game''s sheets readable by other members yet, ASKED BY SOMEONE ON ITS TRIP? Opened AND (hand-locked OR past its deadline). Not the inverse of pickem_picks_open: before picks open both are false — nothing writable, nothing revealed. Membership is checked inside for the reason given on pickem_picks_open (migration 147).';
