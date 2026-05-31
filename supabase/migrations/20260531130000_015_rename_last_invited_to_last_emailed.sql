-- 015: Rename trip_members.last_invited_at → last_emailed_at
--
-- The column originally stamped only the first invite send. Since the
-- Email-the-crew dashboard now sends both invites AND follow-ups (and stamps
-- this column on every send), "last_invited_at" is a misnomer: it actually
-- records "when this member was last emailed", regardless of whether that
-- email was the initial invite or a later follow-up.
--
-- The invite-vs-follow-up distinction is carried by email_count (added in 014):
--   email_count = 0  → never emailed       → next send is an INVITE
--   email_count > 0  → emailed before      → next send is a FOLLOW-UP
-- ...so last_emailed_at is purely "when", and email_count is "how many times".
--
-- Guarded so the rename is idempotent (safe to re-run): only fires while the
-- old column still exists.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'trip_members'
      AND column_name = 'last_invited_at'
  ) THEN
    ALTER TABLE public.trip_members
      RENAME COLUMN last_invited_at TO last_emailed_at;
  END IF;
END $$;
