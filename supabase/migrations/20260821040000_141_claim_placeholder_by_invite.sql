-- 141 — claim_placeholder_by_invite: the invite token authorizes attaching a
-- placeholder to whichever account the holder actually signed in with.
--
-- ══ The state this closes ═════════════════════════════════════════════════
--
-- An invite goes to `someone+work@gmail.com`. They open it signed in as
-- `someone@gmail.com` — or tap Continue with Google, which supplies whatever
-- address that account uses. `resolveAccessRoute` correctly returns
-- `identity-choice` (#988), and the landing page offers two honest actions.
--
-- But which two depends on a fact the page computes and nothing else reads:
-- `viewerCanSee`, a `trip_members` lookup on the VIEWER's own id. The
-- placeholder row carries the GHOST's id, not theirs. So in the case this
-- migration is written for, `viewerCanSee` is FALSE and the page offers exactly
-- one action — "Sign out and use someone+work@gmail.com". There is no way to
-- proceed as the account they actually use. That is a dead end on the front
-- door, and it is the common shape: invited at a work address, signs in with
-- the Google account they carry on their phone.
--
-- ══ Why a token is the right authorization ═══════════════════════════════
--
-- The token proves this person was invited to that address. That is exactly
-- the question an email match exists to answer, so no email match is required
-- — it fires on "the holder of a valid invite token chose to continue as this
-- account" instead of on `handle_new_user`'s address comparison.
--
-- It is the SAME operation either way, so it calls the SAME function. There is
-- no second merge here and there must never be one: `ghostCrew.update`'s
-- auto-link branch once hand-rolled a subset of it (repoint `trip_members`,
-- return) and orphaned 123 competition rows across 2 trips in production,
-- including 93 real per-hole scores.
--
-- ══ What this DOES widen, stated plainly ═════════════════════════════════
--
-- `src/server/lib/inviteToken.ts` — written when #999 widened token links to
-- every invite-blast recipient — leans explicitly on the token NOT being able
-- to join: "someone forwarded the email learns the trip TITLE and the
-- inviter's NAME, and gets a signup prompt — they cannot join the trip". This
-- migration makes a forwarded token a join-plus-inherit-history capability.
-- That is a real change to what the capability does, and pretending otherwise
-- would leave the next reader trusting a sentence this migration falsified.
--
-- The narrowing chosen is CONSENT AT THE POINT OF USE rather than a shorter
-- expiry. The claim is a second, explicit action after authenticating, and the
-- screen names the placeholder it is about to attach ("this will attach Brad's
-- history to someone@gmail.com"). A forwardee sees a name that is not theirs
-- and stops. Time-boxing was considered and rejected as strictly weaker: a
-- forward almost always happens immediately, so an expiry window catches the
-- honest case and misses the dishonest one.
--
-- ══ Four preconditions the core assumes and does not check ═══════════════
--
-- `merge_guest_to_real_user` is SECURITY DEFINER, takes two arbitrary ids, and
-- validates none of this. Its ACL is postgres + service_role ONLY, deliberately
-- (migration 095: granting it directly "would be an account-takeover
-- primitive"). So this is a guarded wrapper in the shape of
-- `link_guest_to_account` and `set_team_captain` — authorization checked HERE,
-- at the database layer, rather than trusted from the caller.
--
--   1. the ghost really is `is_guest` — the core's closing DELETE is guarded on
--      it, so pointing the merge at a real account moves that person's entire
--      history onto another id and leaves their row standing, with no error
--   2. the ghost has no `deleted_at` — migration 132's comment says it outright:
--      "A third caller must too." This is that third caller
--   3. no collision the core does not itself resolve — see the score_entries
--      guard below
--   4. the caller decides what "already has history" means — the core resolves
--      collisions by DELETING the ghost's side, which is the wrong answer here
--      (see the already-a-member guard below)
--
-- ══ Deliberately NOT trip-scoped ═════════════════════════════════════════
--
-- The merge is global: it moves every reference the ghost holds, on every trip.
-- One guest row is shared across trips (`users.email` is UNIQUE and
-- `ghostCrew.create` reuses an existing ghost rather than minting a second),
-- so a token minted for trip X moves that placeholder's membership on trips Y
-- and Z as well.
--
-- That is accepted rather than overlooked. Writing a trip-scoped partial merge
-- would be a SECOND merge that drifts from the first — the precise failure
-- mode above — and this is the same global operation signup performs on the
-- same identity. Prod at the time of writing: 77 guest rows, ZERO on more than
-- one trip. Structurally reachable, currently unexercised.

-- ── The wrapper ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.claim_placeholder_by_invite(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
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
  -- Pre-existing, and reachable from signup too — this wrapper does not fix it,
  -- it refuses to trip over it. Refusing rather than deleting a side is
  -- deliberate: two identities holding a score for the same hole is genuinely
  -- ambiguous data, and silently dropping one of them is the guess this whole
  -- feature is written to avoid.
  --
  -- Still reachable despite the guard above, because the merge is global: the
  -- claimant may share a DIFFERENT trip with this placeholder.
  IF EXISTS (
    SELECT 1
    FROM public.score_entries g
    JOIN public.score_entries r
      ON r.game_id = g.game_id
     AND r.unit_label = g.unit_label
     AND r.participant_id = _uid
     AND r.participant_type = 'user'
    WHERE g.participant_id = _ghost_id
      AND g.participant_type = 'user'
  ) THEN
    RAISE EXCEPTION 'Both identities already have scores in the same game. Ask the trip owner to sort this out.'
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

COMMENT ON FUNCTION public.claim_placeholder_by_invite(text) IS
  'Token-authorized wrapper around merge_guest_to_real_user: the holder of a valid invite token attaches the placeholder it was addressed to onto their OWN signed-in account, whatever address that account uses. The core stays revoked from authenticated. Refuses a deleted placeholder (migration 132''s third caller), a claimant already on the trip (merging would delete the placeholder row carrying nickname and role), and a score_entries collision the core cannot resolve. Self-consuming: a successful claim deletes the ghost, so a second claim finds nothing.';

REVOKE ALL ON FUNCTION public.claim_placeholder_by_invite(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_placeholder_by_invite(text) TO authenticated;
