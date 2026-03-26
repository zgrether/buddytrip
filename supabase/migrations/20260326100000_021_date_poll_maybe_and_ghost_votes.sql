-- ============================================================
-- 021: Date poll — add 'maybe' answer, DELETE RLS, ghost vote migration
--
-- 1. Expand date_poll_votes.answer to accept 'maybe'
-- 2. Add DELETE RLS policy so members can remove their own votes (toggle-off)
-- 3. Add DELETE policy for planners to remove votes on behalf of ghosts
-- 4. Update handle_new_user trigger to migrate date_poll_votes
-- ============================================================

-- 1. Expand answer check constraint to include 'maybe'
ALTER TABLE date_poll_votes
  DROP CONSTRAINT IF EXISTS date_poll_votes_answer_check;
ALTER TABLE date_poll_votes
  ADD CONSTRAINT date_poll_votes_answer_check
  CHECK (answer IN ('yes', 'no', 'maybe'));

-- 2. DELETE RLS — members can delete their own votes
CREATE POLICY date_poll_votes_delete ON date_poll_votes FOR DELETE TO authenticated
  USING (user_id = auth.uid()::text);

-- 3. Update handle_new_user trigger to also migrate date_poll_votes
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  _ghost_id text;
BEGIN
  SELECT id INTO _ghost_id
  FROM public.users
  WHERE email = NEW.email
    AND is_guest = true;

  IF _ghost_id IS NOT NULL THEN
    UPDATE public.users SET email = NULL WHERE id = _ghost_id;

    INSERT INTO public.users (id, name, nickname, email)
    VALUES (
      NEW.id::text,
      COALESCE(NEW.raw_user_meta_data ->> 'name', ''),
      COALESCE(NULLIF(NEW.raw_user_meta_data ->> 'nickname', ''), ''),
      NEW.email
    );

    -- Migrate FK references from ghost ID → new auth ID
    UPDATE public.trip_members       SET user_id         = NEW.id::text WHERE user_id         = _ghost_id;
    UPDATE public.team_assignments   SET user_id         = NEW.id::text WHERE user_id         = _ghost_id;
    UPDATE public.players            SET user_id         = NEW.id::text WHERE user_id         = _ghost_id;
    UPDATE public.expense_splits     SET user_id         = NEW.id::text WHERE user_id         = _ghost_id;
    UPDATE public.expenses           SET paid_by_user_id = NEW.id::text WHERE paid_by_user_id = _ghost_id;
    UPDATE public.idea_votes         SET user_id         = NEW.id::text WHERE user_id         = _ghost_id;
    UPDATE public.scoreboard_shares  SET created_by      = NEW.id::text WHERE created_by      = _ghost_id;
    UPDATE public.series             SET owner_id        = NEW.id::text WHERE owner_id        = _ghost_id;
    UPDATE public.users              SET created_by      = NEW.id::text WHERE created_by      = _ghost_id;
    -- date_poll_votes: migrate ghost votes to the real user
    UPDATE public.date_poll_votes    SET user_id         = NEW.id::text WHERE user_id         = _ghost_id;

    DELETE FROM public.users WHERE id = _ghost_id;
  ELSE
    INSERT INTO public.users (id, name, nickname, email)
    VALUES (
      NEW.id::text,
      COALESCE(NEW.raw_user_meta_data ->> 'name', ''),
      COALESCE(NULLIF(NEW.raw_user_meta_data ->> 'nickname', ''), ''),
      NEW.email
    );
  END IF;

  RETURN NEW;
END;
$$;
