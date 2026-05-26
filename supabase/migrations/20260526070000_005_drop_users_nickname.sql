-- Migration 005 — drop users.nickname
-- The trip-scoped trip_members.nickname column (added in 004) is now the
-- single source of truth for display-name overrides. All code reads/writes
-- of users.nickname have been removed; this migration drops the column and
-- updates the auth-signup trigger to stop populating it.

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
    AND is_guest = true;

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

ALTER TABLE public.users DROP COLUMN IF EXISTS nickname;
