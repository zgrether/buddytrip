-- ============================================================
-- 028: Avatar, invites, guest merge, and expense_splits FK fix
--
-- This migration covers:
--   1. avatar_url column on users
--   2. avatars storage bucket + RLS policies
--   3. invites table + indexes + RLS
--   4. Fix expense_splits FK from CASCADE to RESTRICT
--   5. merge_guest_to_real_user() function (complete FK coverage)
--   6. Upgraded handle_new_user() trigger (replaces 020's version)
-- ============================================================

-- ── 1. Avatar URL column ────────────────────────────────────────────────

ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url text;

-- ── 2. Avatars storage bucket ───────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "avatars are publicly readable"
ON storage.objects FOR SELECT
USING (bucket_id = 'avatars');

CREATE POLICY "users can upload their own avatar"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'avatars'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "users can update their own avatar"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'avatars'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- ── 3. Invites table ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id text NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'Member' CHECK (role IN ('Planner', 'Member')),
  token text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  created_by text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days'
);

CREATE INDEX IF NOT EXISTS invites_token_idx ON invites(token);
CREATE INDEX IF NOT EXISTS invites_email_idx ON invites(email);

-- RLS
ALTER TABLE invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "trip members can view invites for their trip"
ON invites FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM trip_members
    WHERE trip_id = invites.trip_id
    AND user_id = auth.uid()::text
  )
);

CREATE POLICY "planners and owners can create invites"
ON invites FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM trip_members
    WHERE trip_id = invites.trip_id
    AND user_id = auth.uid()::text
    AND role IN ('Owner', 'Planner')
  )
);

CREATE POLICY "system can update invites"
ON invites FOR UPDATE
USING (true);

-- ── 4. Fix expense_splits FK (CASCADE → RESTRICT) ──────────────────────

ALTER TABLE expense_splits
  DROP CONSTRAINT IF EXISTS expense_splits_user_id_fkey,
  ADD CONSTRAINT expense_splits_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;

-- ── 5. merge_guest_to_real_user() function ──────────────────────────────
-- Covers ALL foreign key references to users(id) across the schema.
-- Called by handle_new_user() trigger when a signup matches a ghost email.

CREATE OR REPLACE FUNCTION public.merge_guest_to_real_user(
  p_ghost_id text,
  p_real_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  -- CASCADE FK references (ownership/membership — meaningless without user)
  UPDATE public.trip_members       SET user_id         = p_real_id WHERE user_id         = p_ghost_id;
  UPDATE public.team_assignments   SET user_id         = p_real_id WHERE user_id         = p_ghost_id;
  UPDATE public.players            SET user_id         = p_real_id WHERE user_id         = p_ghost_id;
  UPDATE public.player_hole_scores SET player_id       = p_real_id WHERE player_id       = p_ghost_id;
  UPDATE public.idea_votes         SET user_id         = p_real_id WHERE user_id         = p_ghost_id;
  UPDATE public.idea_comments      SET user_id         = p_real_id WHERE user_id         = p_ghost_id;
  UPDATE public.date_poll_votes    SET user_id         = p_real_id WHERE user_id         = p_ghost_id;
  UPDATE public.expense_splits     SET user_id         = p_real_id WHERE user_id         = p_ghost_id;
  UPDATE public.notification_reads SET user_id         = p_real_id WHERE user_id         = p_ghost_id;

  -- SET NULL FK references (audit/attribution preserved with cleared author)
  UPDATE public.messages           SET user_id         = p_real_id WHERE user_id         = p_ghost_id;
  UPDATE public.expenses           SET paid_by_user_id = p_real_id WHERE paid_by_user_id = p_ghost_id;
  UPDATE public.rounds             SET closed_by       = p_real_id WHERE closed_by       = p_ghost_id;
  UPDATE public.notification_events SET actor_id       = p_real_id WHERE actor_id        = p_ghost_id;
  UPDATE public.scoreboard_shares  SET created_by      = p_real_id WHERE created_by      = p_ghost_id;
  UPDATE public.quick_info_tiles   SET created_by      = p_real_id WHERE created_by      = p_ghost_id;
  UPDATE public.group_results      SET submitted_by    = p_real_id WHERE submitted_by    = p_ghost_id;

  -- NO ACTION FK reference
  UPDATE public.series             SET owner_id        = p_real_id WHERE owner_id        = p_ghost_id;
  UPDATE public.trips              SET owner_id        = p_real_id WHERE owner_id        = p_ghost_id;

  -- Self-referential FK (other ghosts created by this ghost)
  UPDATE public.users              SET created_by      = p_real_id WHERE created_by      = p_ghost_id;

  -- New table: invites
  UPDATE public.invites            SET created_by      = p_real_id WHERE created_by      = p_ghost_id;

  -- Delete the ghost users row (all references now point to real user)
  DELETE FROM public.users WHERE id = p_ghost_id AND is_guest = true;
END;
$$;

-- ── 6. Upgraded handle_new_user() trigger ───────────────────────────────
-- Replaces the version from migration 020. Now uses merge_guest_to_real_user()
-- for complete FK coverage, and marks matching invites as accepted.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  _ghost_id text;
BEGIN
  -- Check if a ghost user already exists with this email
  SELECT id INTO _ghost_id
  FROM public.users
  WHERE email = NEW.email
    AND is_guest = true;

  IF _ghost_id IS NOT NULL THEN
    -- 1. Clear the ghost's email so UNIQUE constraint won't block insert
    UPDATE public.users SET email = NULL WHERE id = _ghost_id;

    -- 2. Insert the real user row
    INSERT INTO public.users (id, name, nickname, email)
    VALUES (
      NEW.id::text,
      COALESCE(NEW.raw_user_meta_data ->> 'name', ''),
      COALESCE(NULLIF(NEW.raw_user_meta_data ->> 'nickname', ''), ''),
      NEW.email
    );

    -- 3. Migrate ALL FK references from ghost → real user
    PERFORM public.merge_guest_to_real_user(_ghost_id, NEW.id::text);
  ELSE
    -- Normal signup — no ghost conflict
    INSERT INTO public.users (id, name, nickname, email)
    VALUES (
      NEW.id::text,
      COALESCE(NEW.raw_user_meta_data ->> 'name', ''),
      COALESCE(NULLIF(NEW.raw_user_meta_data ->> 'nickname', ''), ''),
      NEW.email
    );
  END IF;

  -- Mark any pending invites for this email as accepted
  UPDATE public.invites
  SET accepted_at = now()
  WHERE email = NEW.email
    AND accepted_at IS NULL;

  RETURN NEW;
END;
$$;
