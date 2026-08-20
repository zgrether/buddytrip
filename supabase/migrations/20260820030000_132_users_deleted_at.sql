-- ────────────────────────────────────────────────────────────────────────
-- Migration 132 — a deleted account cannot be resurrected by its address
-- ────────────────────────────────────────────────────────────────────────
--
-- Migration 130 made account deletion convert the `users` row to a placeholder
-- so that shared records keep resolving. That left one hole, which this closes:
-- signing up with the deleted person's old address, or an owner typing it back
-- onto the placeholder, would MERGE the deleted account's whole history into
-- whoever now holds that address.
--
-- Nulling the email at deletion (130) closed the SIGNUP route only while the
-- email stayed null — and an owner can put one back via `ghostCrew.update`,
-- because a deleted account is, structurally, an ordinary placeholder. There is
-- no way to tell "placeholder that was never an account" from "placeholder that
-- was one" without recording it. That is the entire reason this column exists.
--
-- ── This is a provenance flag, NOT a parallel deleted state ────────────────
--
-- Nothing renders it. No surface branches on it. The roster, the scorecard, the
-- ledger and the crew list all keep treating these rows as the placeholders
-- they now are — which is the point of 130, and re-introducing a second
-- "deleted" concept for the UI to learn would undo it. `deleted_at` is read by
-- the link paths and nowhere else.
--
-- ── Why the address must NOT restore the history ──────────────────────────
--
-- Deleting your account is a request to stop being findable. If signing up
-- again with the same address silently handed you back the same rows, deletion
-- would mean "hidden until you come back", which is not what it says. The
-- sanctioned way to reconnect a person to their history is the claim feature —
-- an owner deliberately attributing a placeholder to an account — which is
-- exactly why AUTOMATIC re-linking by address stays wrong permanently rather
-- than until something better exists.

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

COMMENT ON COLUMN public.users.deleted_at IS
  'When this row stopped being an account and became a placeholder (migration 130). Provenance ONLY: nothing renders it and no surface branches on it. Read by the two link paths — handle_new_user and link_guest_to_account — to refuse re-attaching a deleted person''s history to whoever now holds their old address (migration 132).';

-- Deliberately NOT indexed. Both readers look a row up by id or by email (both
-- already indexed) and then check this column; nothing scans by it. An index
-- here would be a cost with no query behind it.

-- ── 1. Record it at deletion ──────────────────────────────────────────────
-- Same body as migration 130, plus the stamp. Restated in full because that is
-- what CREATE OR REPLACE requires; the only change is `deleted_at`.
CREATE OR REPLACE FUNCTION public.handle_user_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  UPDATE public.users
     SET name       = 'Deleted User',
         email      = NULL,
         avatar_url = NULL,
         is_guest   = true,
         deleted_at = now()
   WHERE id = OLD.id::text;

  DELETE FROM public.push_subscriptions WHERE user_id = OLD.id::text;
  DELETE FROM public.chat_reads         WHERE user_id = OLD.id::text;
  DELETE FROM public.news_reads         WHERE user_id = OLD.id::text;

  UPDATE public.trip_members SET nickname = NULL WHERE user_id = OLD.id::text;

  RETURN OLD;
END;
$function$;

-- ── 2. Signup: a deleted placeholder is not a match ───────────────────────
--
-- GRACEFUL, not an error. Someone signing up with an address that used to be a
-- deleted account gets a NEW, empty account — which is the correct outcome and
-- indistinguishable to them from signing up with any other address. Raising
-- here would fail signup for a person who has done nothing wrong.
--
-- This also keeps the merge unreachable from the signup trigger for a deleted
-- ghost, which matters: a RAISE inside `merge_guest_to_real_user` would break
-- account creation, and this codebase has already lost signup twice that way
-- (migrations 023 and 024).
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  _ghost_id text;
BEGIN
  SELECT id INTO _ghost_id
  FROM public.users
  WHERE email = NEW.email
    AND is_guest = true
    AND deleted_at IS NULL;

  IF _ghost_id IS NOT NULL THEN
    UPDATE public.users SET email = NULL WHERE id = _ghost_id;
    INSERT INTO public.users (id, name, email)
    VALUES (
      NEW.id::text,
      COALESCE(NEW.raw_user_meta_data ->> 'name', ''),
      NEW.email
    );
    PERFORM public.merge_guest_to_real_user(_ghost_id, NEW.id::text);
  ELSE
    INSERT INTO public.users (id, name, email)
    VALUES (
      NEW.id::text,
      COALESCE(NEW.raw_user_meta_data ->> 'name', ''),
      NEW.email
    );
  END IF;

  UPDATE public.invites
  SET accepted_at = now()
  WHERE email = NEW.email
    AND accepted_at IS NULL;

  RETURN NEW;
END;
$function$;

-- ── 3. Owner link: refuse, loudly ─────────────────────────────────────────
--
-- The opposite treatment from signup, deliberately. This path is an owner
-- deliberately attaching an account to a placeholder, so silently doing nothing
-- would leave them believing it worked. It joins the guards already here rather
-- than becoming a new mechanism.
CREATE OR REPLACE FUNCTION public.link_guest_to_account(p_trip_id text, p_ghost_id text, p_real_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
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

  PERFORM public.merge_guest_to_real_user(p_ghost_id, p_real_id);
END;
$function$;

-- ── 4. State the precondition on the merge, without rewriting it ──────────
--
-- The merge itself is deliberately NOT changed. It is ~300 lines spanning every
-- era of this schema, and CLAUDE.md's standing warning is that a mistake in it
-- breaks signup for everyone — so re-emitting the whole body to add five lines
-- is a poor trade against a guard the two callers already apply. A COMMENT
-- needs no body, so the precondition is recorded where the next person adding
-- a third caller will read it.
COMMENT ON FUNCTION public.merge_guest_to_real_user(text, text) IS
  'Reassigns every person reference from a placeholder to a real account, then deletes the placeholder. PRECONDITION: the caller must refuse when the ghost has users.deleted_at set — a deleted account''s history must never be reattached to whoever now holds their old address (migration 132). Both existing callers do: handle_new_user filters it out of its lookup, link_guest_to_account raises. A third caller must too.';
