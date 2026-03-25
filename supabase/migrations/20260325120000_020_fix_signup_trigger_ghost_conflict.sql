-- ============================================================
-- 020: Fix signup trigger to handle ghost user email conflicts
--
-- When a user signs up with an email that already belongs to a
-- ghost member, the UNIQUE constraint on users.email causes the
-- trigger INSERT to fail ("database error saving new user").
--
-- Fix: if a ghost row exists with the same email, convert it
-- into a real user (update id, name, nickname, is_guest) instead
-- of inserting a new row.
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
    -- Convert the ghost into a real user: update the row to use
    -- the new auth ID so all existing trip_members / scores / etc.
    -- remain linked via the users FK.
    UPDATE public.users
    SET
      id       = NEW.id::text,
      name     = COALESCE(NEW.raw_user_meta_data ->> 'name', name),
      nickname = COALESCE(NULLIF(NEW.raw_user_meta_data ->> 'nickname', ''), nickname),
      is_guest = false
    WHERE id = _ghost_id;

    -- Update all foreign keys that reference the old ghost ID
    UPDATE public.trip_members
    SET user_id = NEW.id::text
    WHERE user_id = _ghost_id;

    UPDATE public.team_assignments
    SET user_id = NEW.id::text
    WHERE user_id = _ghost_id;
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
