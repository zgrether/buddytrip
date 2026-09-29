-- 197 — Account linking refuses when both identities are in the SAME GAME (#1481)
--
-- ── What this reverses, and why (CLAUDE.md migration rule 5) ─────────────────
-- Migrations 190 (`link_guest_to_account`) and 141 (`claim_placeholder_by_invite`)
-- refused a link only when the placeholder and the account both held a score for
-- the SAME HOLE (190) / any `score_entries` pair on one hole (141). #1024 ruled
-- "refuse, and let a person choose" for that case, and both pre-checks implement
-- it faithfully — for `score_entries` alone.
--
-- That was too narrow in two directions:
--  1. Several formats record a person in a game with NO `score_entries` at all:
--     outcome-mode match play, pick'em, skins, non-golf Matches, manual and
--     bracket placements. Two identities that both played one of those passed
--     the pre-check, reached `merge_guest_to_real_user`, and the merge silently
--     resolved the collision — since 194, by DELETING the placeholder's
--     `game_results` row. The opposite of #1024's ruling.
--  2. Two identities on opposite SIDES of one match would be merged into one
--     person playing both sides, with no score collision at all.
--
-- Ruled 2026-09-28 (Zach, PR 8 prerequisite 5): **refuse whenever both identities
-- are participants in the same game at all, and tighten the scoring check to the
-- same game.** A placeholder and a real account in one game is a duplicate person;
-- the organizer removes the duplicate before linking. One predicate now covers
-- both old checks.
--
-- ── What "in a game" means: every place a person is recorded as a PLAYER ────
-- `_games_played_by(user)` is the union of:
--   game_participants.user_id · score_entries (participant_type 'user')
--   game_results (entity_type 'user') · game_matches.side_a/side_b (type 'user')
--   bracket_entrant_members (via bracket_entrants.game_id) · pickem_picks.user_id
--   skins_hole_outcomes.winner_user_id
-- Deliberately NOT: `game_delegates` (running a game is a role, not playing in
-- it, so a delegate and a placeholder who played are not one person twice) and
-- `push_send_log` (a log). **A new table that records a PLAYER in a game joins
-- this union in the same migration** — the same rule `merge_guest_to_real_user`
-- carries for person-referencing tables.
--
-- ── Security (CLAUDE.md #28) ─────────────────────────────────────────────────
-- Both helpers are SECURITY DEFINER and answer about ANY user id, not about the
-- caller — so exposed, they would tell anyone which games a named person played.
-- They are revoked from every client role and called only from the two definer
-- functions below, which run as their owner.
--
-- ── Unchanged ────────────────────────────────────────────────────────────────
-- Both function bodies are the current definitions (190, 141) with ONLY the
-- collision block replaced; everything else is byte-identical. The merge's own
-- delete-the-loser handling stays as the signup-path backstop, which cannot
-- fire there (`handle_new_user` merges into a seconds-old row with no history).

CREATE OR REPLACE FUNCTION public._games_played_by(p_user_id text)
RETURNS TABLE (game_id text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT gp.game_id FROM public.game_participants gp WHERE gp.user_id = p_user_id
  UNION
  SELECT se.game_id FROM public.score_entries se
   WHERE se.participant_type = 'user' AND se.participant_id = p_user_id
  UNION
  SELECT gr.game_id FROM public.game_results gr
   WHERE gr.entity_type = 'user' AND gr.entity_id = p_user_id
  UNION
  SELECT gm.game_id FROM public.game_matches gm
   WHERE (gm.side_a->>'type' = 'user' AND gm.side_a->>'id' = p_user_id)
      OR (gm.side_b->>'type' = 'user' AND gm.side_b->>'id' = p_user_id)
  UNION
  SELECT be.game_id FROM public.bracket_entrant_members bm
    JOIN public.bracket_entrants be ON be.id = bm.entrant_id
   WHERE bm.user_id = p_user_id
  UNION
  SELECT pp.game_id FROM public.pickem_picks pp WHERE pp.user_id = p_user_id
  UNION
  SELECT sh.game_id FROM public.skins_hole_outcomes sh WHERE sh.winner_user_id = p_user_id
$$;

REVOKE ALL ON FUNCTION public._games_played_by(text) FROM PUBLIC, anon, authenticated;

-- The names of the games both identities play in, for the refusal sentence —
-- the reader has to know WHICH game to fix, or the message names no action.
-- NULL when they share none.
CREATE OR REPLACE FUNCTION public._shared_game_names(p_a text, p_b text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT string_agg(g.name, ', ' ORDER BY g.name)
  FROM public.games g
  WHERE g.id IN (
    SELECT a.game_id FROM public._games_played_by(p_a) a
    INTERSECT
    SELECT b.game_id FROM public._games_played_by(p_b) b
  )
$$;

REVOKE ALL ON FUNCTION public._shared_game_names(text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.link_guest_to_account(p_trip_id text, p_ghost_id text, p_real_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  _shared text;
BEGIN
  IF p_ghost_id = p_real_id THEN
    RETURN; -- nothing to merge
  END IF;

  IF NOT public.has_trip_role(p_trip_id, ARRAY['Owner'::text]) THEN
    RAISE EXCEPTION 'Only the trip owner can link a crew member to an account'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.users WHERE id = p_ghost_id AND is_guest = true
  ) THEN
    RAISE EXCEPTION 'Only a placeholder crew member can be linked to an account'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Migration 132. A deleted account is a placeholder in every structural
  -- sense, so the is_guest check above admits it; only `deleted_at` can tell
  -- the two apart.
  IF EXISTS (
    SELECT 1 FROM public.users WHERE id = p_ghost_id AND deleted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'That person deleted their account. Their history cannot be reattached to a new one.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- The guest must belong to THIS trip. Call this BEFORE repointing
  -- trip_members, or the check has nothing left to find.
  IF NOT EXISTS (
    SELECT 1 FROM public.trip_members
     WHERE trip_id = p_trip_id AND user_id = p_ghost_id
  ) THEN
    RAISE EXCEPTION 'That placeholder is not on this trip'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_real_id) THEN
    RAISE EXCEPTION 'Target account not found' USING ERRCODE = 'check_violation';
  END IF;

  -- Migration 197 (#1481): refuse whenever both identities are IN THE SAME
  -- GAME AT ALL — widened from 190's "a score for the same hole". See the
  -- migration header for why, and `_shared_game_names` for what counts.
  _shared := public._shared_game_names(p_ghost_id, p_real_id);
  IF _shared IS NOT NULL THEN
    RAISE EXCEPTION 'This placeholder and that account are both in %. That is one person recorded twice in the same game, so linking them would mean throwing one of those records away. Take one of them out of that game, or keep them as separate crew members.', _shared
      USING ERRCODE = 'unique_violation';
  END IF;

  PERFORM public.merge_guest_to_real_user(p_ghost_id, p_real_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_placeholder_by_invite(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  _shared text;
  _uid       text := (auth.uid())::text;
  _trip_id   text;
  _email     text;
  _ghost_id  text;
  _ghost_del timestamptz;
  _claimant  text;
  _name      text;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to claim an invite'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- The token is the whole input. The caller never names a ghost id, so there
  -- is no id for a client to substitute — the same reason `link_guest_to_account`
  -- re-derives its authorization instead of trusting arguments.
  SELECT i.trip_id, lower(trim(i.email))
    INTO _trip_id, _email
  FROM public.invites i
  WHERE i.token = p_token;

  IF _trip_id IS NULL THEN
    RAISE EXCEPTION 'This invite link isn''t valid.'
      USING ERRCODE = 'no_data_found';
  END IF;

  -- ── The claimant must be a real account ────────────────────────────────
  SELECT u.id INTO _claimant FROM public.users u
   WHERE u.id = _uid AND u.is_guest = false;
  IF _claimant IS NULL THEN
    RAISE EXCEPTION 'Only a signed-in account can claim an invite'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ── Find the placeholder this token was addressed to ───────────────────
  --
  -- This is ALSO the consumption check, and it is structural rather than a
  -- flag: a successful claim ends with the ghost row DELETED, so a second
  -- claim on the same token finds nothing here and refuses on a fact. That is
  -- a stronger check than `accepted_at`, which is stamped by signup for every
  -- invite to an address and cannot distinguish "used" from "used how".
  SELECT u.id, u.deleted_at INTO _ghost_id, _ghost_del
  FROM public.users u
  WHERE lower(u.email) = _email AND u.is_guest = true;

  IF _ghost_id IS NULL THEN
    RAISE EXCEPTION 'This invite has already been used.'
      USING ERRCODE = 'no_data_found';
  END IF;

  IF _ghost_id = _uid THEN
    RAISE EXCEPTION 'This invite has already been used.'
      USING ERRCODE = 'no_data_found';
  END IF;

  -- ── Precondition 2 — migration 132 ─────────────────────────────────────
  IF _ghost_del IS NOT NULL THEN
    RAISE EXCEPTION 'That person deleted their account. Their history can''t be reattached to a new one.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- The placeholder must be on the trip the TOKEN names. Without this, any
  -- valid token would claim any placeholder sharing its address — and the
  -- check has to run before the merge, which moves the row it reads.
  IF NOT EXISTS (
    SELECT 1 FROM public.trip_members
     WHERE trip_id = _trip_id AND user_id = _ghost_id
  ) THEN
    RAISE EXCEPTION 'This invite has already been used.'
      USING ERRCODE = 'no_data_found';
  END IF;

  -- ── Precondition 4 — refuse when the claimant is already on this trip ──
  --
  -- REFUSED, not merged, and the reason is that merging here would destroy the
  -- thing the feature exists to preserve. The core resolves a `trip_members`
  -- collision by DELETING the ghost's row — and that row is the one carrying
  -- the trip `nickname` and the `role`. Same for `team_assignments` and
  -- `game_participants`: the placeholder's side loses.
  --
  -- So this is not a conservative compromise; it is the only behaviour that
  -- does not discard the point. It also matches the one shipped merge caller:
  -- `ghostCrew.update`'s auto-link branch throws CONFLICT rather than merging
  -- when the account is already a member.
  IF EXISTS (
    SELECT 1 FROM public.trip_members
     WHERE trip_id = _trip_id AND user_id = _uid
  ) THEN
    RAISE EXCEPTION 'Your account is already on this trip. Ask the trip owner to merge the duplicate crew member.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- ── Precondition 3 — a collision the core does NOT resolve ─────────────
  --
  -- `score_entries` is UNIQUE (game_id, participant_id, unit_label) and the
  -- merge does a PLAIN `UPDATE ... SET participant_id`, with none of the
  -- delete-the-ghost's-losing-row handling it applies to the nine tables keyed
  -- on `user_id`. It was missed because that sweep keyed on the column NAME,
  -- and this one is `participant_id`.
  --
  -- Pre-existing. This wrapper does not fix it, it refuses to trip over it.
  -- Refusing rather than deleting a side is deliberate: two identities holding
  -- a score for the same hole is genuinely ambiguous data, and silently
  -- dropping one of them is the guess this whole feature is written to avoid.
  --
  -- NOT reachable from signup, despite the shape suggesting it: `handle_new_user`
  -- inserts the real `users` row immediately before merging, so the merge target
  -- is an id that is seconds old and owns no score rows to collide with. The
  -- exposed callers are the ones merging into an account that ALREADY EXISTS —
  -- `link_guest_to_account` and this one.
  --
  -- And it stays reachable here despite the already-a-member guard above,
  -- because the merge is global: the claimant may share a DIFFERENT trip with
  -- this placeholder, which is the case the test seeds.
  -- Migration 197 (#1481): widened to "both in the same game at all", the
  -- same predicate as link_guest_to_account. The paragraph above describes the
  -- score case this used to be limited to; it is now one instance of it.
  _shared := public._shared_game_names(_ghost_id, _uid);
  IF _shared IS NOT NULL THEN
    RAISE EXCEPTION 'Your account and this invite''s crew member are both in %. That is one person recorded twice in the same game. Ask the trip owner to take one of them out of that game, then claim this invite again.', _shared
      USING ERRCODE = 'unique_violation';
  END IF;

  -- Read the name BEFORE the merge deletes the row it lives on.
  SELECT COALESCE(tm.nickname, u.name) INTO _name
  FROM public.trip_members tm
  JOIN public.users u ON u.id = tm.user_id
  WHERE tm.trip_id = _trip_id AND tm.user_id = _ghost_id;

  PERFORM public.merge_guest_to_real_user(_ghost_id, _uid);

  -- The `trip_members` row was REPOINTED, not recreated, so `nickname` and
  -- `role` rode along on it untouched and the crew row now joins the claiming
  -- account's email — the old placeholder address is gone with the ghost.
  -- Only the RSVP is stated here, matching what `ghostCrew.update` writes after
  -- its own merge: someone who just claimed their spot is in.
  UPDATE public.trip_members
     SET status = 'in'
   WHERE trip_id = _trip_id AND user_id = _uid;

  -- Every invite to that address now names a placeholder that no longer
  -- exists, so all of them are spent — not just the one whose token was used.
  -- Same statement `handle_new_user` runs, for the same reason.
  UPDATE public.invites
     SET accepted_at = now()
   WHERE lower(trim(email)) = _email
     AND accepted_at IS NULL;

  RETURN jsonb_build_object('tripId', _trip_id, 'claimedName', _name);
END;
$$;
