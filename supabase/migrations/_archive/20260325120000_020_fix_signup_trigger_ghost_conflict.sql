-- ============================================================
-- 020: Fix signup trigger to handle ghost user email conflicts
--
-- When a user signs up with an email that already belongs to a
-- ghost member, the UNIQUE constraint on users.email causes the
-- trigger INSERT to fail ("database error saving new user").
--
-- Fix: if a ghost row exists with the same email, temporarily
-- clear the ghost's email (to avoid UNIQUE conflict), insert the
-- real user row, migrate all FK references, then delete the ghost.
--
-- Only references tables that exist in the current schema.
-- Future tables with user FKs should be added here.
-- ============================================================

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
    -- 1. Clear the ghost's email so the UNIQUE constraint won't block the insert
    UPDATE public.users SET email = NULL WHERE id = _ghost_id;

    -- 2. Insert the real user row
    INSERT INTO public.users (id, name, nickname, email)
    VALUES (
      NEW.id::text,
      COALESCE(NEW.raw_user_meta_data ->> 'name', ''),
      COALESCE(NULLIF(NEW.raw_user_meta_data ->> 'nickname', ''), ''),
      NEW.email
    );

    -- 3. Migrate FK references from ghost ID → new auth ID
    UPDATE public.trip_members       SET user_id         = NEW.id::text WHERE user_id         = _ghost_id;
    UPDATE public.team_assignments   SET user_id         = NEW.id::text WHERE user_id         = _ghost_id;
    UPDATE public.players            SET user_id         = NEW.id::text WHERE user_id         = _ghost_id;
    UPDATE public.expense_splits     SET user_id         = NEW.id::text WHERE user_id         = _ghost_id;
    UPDATE public.expenses           SET paid_by_user_id = NEW.id::text WHERE paid_by_user_id = _ghost_id;
    UPDATE public.idea_votes         SET user_id         = NEW.id::text WHERE user_id         = _ghost_id;
    UPDATE public.scoreboard_shares  SET created_by      = NEW.id::text WHERE created_by      = _ghost_id;
    UPDATE public.series             SET owner_id        = NEW.id::text WHERE owner_id        = _ghost_id;
    -- created_by on users itself (other ghosts created by this ghost)
    UPDATE public.users              SET created_by      = NEW.id::text WHERE created_by      = _ghost_id;

    -- 4. Delete the ghost row (nothing references it anymore)
    DELETE FROM public.users WHERE id = _ghost_id;
  ELSE
    INSERT INTO public.users (id, name, nickname, email)
    VALUES (
      NEW.id::text,
      COALESCE(NEW.raw_user_meta_data ->> 'name', ''),
      COALESCE(NEW.raw_user_meta_data ->> 'nickname', ''),
      NEW.email
    );
  END IF;

  RETURN NEW;
END;
$$;
