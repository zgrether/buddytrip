-- 213 — Drop trip_members.status (#1568, step 2)
--
-- An RSVP-era column ('draft','in','likely','maybe','out','invited') that no
-- membership check ever read: is_trip_member and has_trip_role test only that a
-- row exists. Production, 2026-10-12: all 97 rows read 'in'.
--
-- ── The removal ordering (CLAUDE.md, migration step 3b) ──────────────────────
-- Step 1 (#1606, merged as cf500564, in production 2026-10-12T20:17Z) stopped
-- the app reading and writing it. This is step 2: the column goes, and with it
-- the one database writer left, claim_placeholder_by_invite, which ran
-- `SET status = 'in'` after a claim. A dropped column referenced by a plpgsql
-- body fails only when that line RUNS, so leaving the function alone would have
-- made every invite claim fail at runtime; it is redefined first, here, from
-- migration 197's text with that one statement removed. Its grants (141) carry
-- over: CREATE OR REPLACE keeps them.
--
-- The CHECK constraint trip_members_status_check goes with the column. Nothing
-- else in the database depends on it (checked: indexes, constraints, triggers,
-- views, functions, policies).
--
-- #1603 (database refusals that say "competition"): none of its messages live in
-- this function, so nothing rides along here.

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
  -- (Migration 213: this used to set the row's RSVP `status` to 'in'. The
  -- column is dropped below, so there is nothing to state.)

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

ALTER TABLE public.trip_members DROP COLUMN IF EXISTS status;
