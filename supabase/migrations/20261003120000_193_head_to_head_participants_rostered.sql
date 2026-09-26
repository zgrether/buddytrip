-- 193 — a Ryder cup's game participants are rostered (ruling 3, PR 4)
--
-- ── The rule ───────────────────────────────────────────────────────────────
--
-- A head-to-head competition (`competitions.scoring_model = 'match_play'`)
-- is two teams, and every participant in one of its games is rostered on
-- one of them (build plan ruling 3). Until now nothing on the server said
-- so; the match and rack builders only OFFER rostered players, which is
-- policy in a picker, not a refusal. Ruling 11: structural rules are
-- refused by the server.
--
-- Measured on production 2026-09-26 before writing this: 253 participants
-- across the three match_play competitions (BBMI 2023, BBMI 2026, BBMI Test
-- Cup), 253 rostered, 0 not. The count query was checked against the
-- rostered side too (it saw all 253), so the zero is a real zero rather than
-- a query that could not see anything. So this trigger refuses nothing that
-- exists; it closes the door for what comes next.
--
-- ── Why one trigger, not a check in each writer ────────────────────────────
--
-- Participants are written through six paths: `save_game_config` (SQL, which
-- deletes and re-inserts the whole set on a pairing change), the pick'em
-- pairing RPC (SQL), `matches.*`, `playGroups.*`, `games.*` and
-- `scrambleTeamGroups` (TypeScript). A guard in each would be six copies of
-- one rule, and a seventh writer would be born without it. This is the one
-- place all of them pass through.
--
-- ── INSERT only, and why that is enough ────────────────────────────────────
--
-- Every writer that CREATES participation inserts. The clean-replace in
-- `save_game_config` is DELETE + INSERT, so it re-validates the whole set on
-- every pairing save — in a Ryder cup, a pick'em pairing change re-checks
-- every sheet-holder it re-inserts (the #1442 finding). Correct, and named
-- here so the refusal surfacing on a pairing save is not a surprise.
--
-- UPDATE is deliberately NOT covered. The guest→account merge
-- (`merge_guest_to_real_user`, latest in migration 184) repoints
-- `game_participants.user_id` with an UPDATE; an UPDATE trigger would run
-- that inside the SIGNUP trigger, where a refusal fails the signup itself
-- (CLAUDE.md, "Guest → real-user conversion"). The merge moves
-- `team_assignments` in the same breath, so a merged guest stays rostered;
-- nothing else updates `user_id` or `game_id`.
--
-- Not covered, on purpose: REMOVING someone from a team while they are in a
-- game. That is a roster change, which is PR 8's (ruling 20's
-- before-and-after preview), not a participant write.
--
-- ── SECURITY DEFINER, and why that is safe here ────────────────────────────
--
-- A refusal must not depend on what the CALLER can see. As INVOKER, a caller
-- whose RLS hid a `team_assignments` row would be told a rostered player is
-- unrostered — a wrong refusal that names a fix which is already done.
-- CLAUDE.md #28's concern is a definer helper callable as an RPC; a function
-- returning `trigger` cannot be called that way, and EXECUTE is revoked from
-- PUBLIC, anon and authenticated regardless (Postgres checks it only when the
-- trigger is CREATED, not when it fires).
--
-- ── The message ────────────────────────────────────────────────────────────
--
-- `UNROSTERED:` is a prefix the tRPC layer maps, like `HAS_SCORES:`. The text
-- after it names the person and the action, because the only reader who can
-- reach it is someone whose picker disagreed with the server — and "not
-- allowed" alone leaves them nowhere (CLAUDE.md, "A refusal must name an
-- action the reader can take"). Rosters is where the fix lives.

CREATE OR REPLACE FUNCTION public.enforce_head_to_head_participant_rostered()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_competition_id text;
  v_scoring_model  text;
  v_name           text;
BEGIN
  SELECT g.competition_id, c.scoring_model
    INTO v_competition_id, v_scoring_model
    FROM public.games g
    JOIN public.competitions c ON c.id = g.competition_id
   WHERE g.id = NEW.game_id;

  -- A standalone game, or a points competition: nothing to check.
  RETURN NEW; -- MUTANT M1: never refuse

  IF EXISTS (
    SELECT 1 FROM public.team_assignments ta
     WHERE ta.competition_id = v_competition_id
       AND ta.user_id = NEW.user_id
  ) THEN
    RETURN NEW;
  END IF;

  SELECT u.name INTO v_name FROM public.users u WHERE u.id = NEW.user_id;
  RAISE EXCEPTION 'UNROSTERED: % isn''t on either team in this cup. Add them to a team in Rosters first.',
    COALESCE(NULLIF(btrim(v_name), ''), 'This player');
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_head_to_head_participant_rostered() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS game_participants_head_to_head_rostered ON public.game_participants;
CREATE TRIGGER game_participants_head_to_head_rostered
  BEFORE INSERT ON public.game_participants
  FOR EACH ROW EXECUTE FUNCTION public.enforce_head_to_head_participant_rostered();
