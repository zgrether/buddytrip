-- 014: Per-member email_count; drop unused trip-level last_blast_sent_at
--
-- The old trip-wide "invitation blast" (a single send to everyone, used for
-- the planning→going transition) is gone. The Email-the-crew dashboard now
-- targets hand-picked recipients, so trips.last_blast_sent_at — which was
-- write-only (nothing ever read it) — is removed.
--
-- In its place, trip_members.email_count records how many times each member
-- has been emailed. It's the signal the UI actually needs:
--   email_count = 0  → never contacted  → the next send is an INVITE
--   email_count > 0  → already contacted → the next send is a FOLLOW-UP
-- Paired with the existing trip_members.last_invited_at ("when last sent"),
-- this distinguishes invite vs follow-up without a separate email-event log.

ALTER TABLE public.trip_members
  ADD COLUMN IF NOT EXISTS email_count integer NOT NULL DEFAULT 0;

-- Backfill: anyone already stamped with last_invited_at has been emailed at
-- least once, so seed their count to 1. Without this, historical invitees
-- would incorrectly read as "never contacted".
UPDATE public.trip_members
  SET email_count = 1
  WHERE last_invited_at IS NOT NULL AND email_count = 0;

-- Atomic per-recipient increment, called by tripMembers.sendInvitationBlast
-- after each successful send. SECURITY DEFINER mirrors
-- merge_guest_to_real_user; the caller is the Owner-only tRPC handler, which
-- has already verified the recipients belong to the trip.
CREATE OR REPLACE FUNCTION public.increment_member_email_count(
  p_trip_id text,
  p_user_ids text[]
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
  UPDATE public.trip_members
    SET email_count = email_count + 1
    WHERE trip_id = p_trip_id AND user_id = ANY(p_user_ids);
$function$;

GRANT EXECUTE ON FUNCTION public.increment_member_email_count(text, text[]) TO authenticated;

ALTER TABLE public.trips DROP COLUMN IF EXISTS last_blast_sent_at;
