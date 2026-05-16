-- Add competitions to the Supabase Realtime publication so non-owner
-- clients receive UPDATE events when the owner changes scoreboard_style,
-- status (Go Live / Back to Setup), name, tagline, etc. Without this,
-- the non-owner's cached competition row stays stale up to staleTime
-- (60s) before refetching — they'd see the old scoreboard style until
-- they refocus the tab or navigate away and back.

ALTER PUBLICATION supabase_realtime ADD TABLE public.competitions;
