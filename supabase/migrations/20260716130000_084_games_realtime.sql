-- 084: game-config realtime — push settings changes to every client (mirrors 077).
--
-- A game's CONFIG (name/status/course/modifiers/points/entry_mode/scoring_enabled +
-- matchups + participants/handicaps + play_groups + delegates) is cached client-side
-- as STRUCTURE and only refetched on explicit invalidation — which is LOCAL to the
-- device that made the change (same root as 077 for the trip lists). So the ACTING
-- browser updates instantly, but another browser served cached config until it
-- happened to poll (useConfigSync's ~20s hash poll, which is ALSO paused on a hidden
-- tab and only mounted on the game surface) or reload — the "doesn't show until
-- refresh" symptom, hit live on the settings page.
--
-- None of these five tables were in the supabase_realtime publication (unlike
-- trip_members / competitions / the 077 trip-list tables). Adding them lets a new
-- `useRealtimeGame` hook invalidate the game read (getById / matches.listByGame /
-- configHash / listOrganizers) the moment any config row changes, so settings
-- re-resolve live for every viewer. The ~20s hash poll stays as the reconnect
-- backstop (mirrors how useRealtimeMembers kept the staleTime backstop).
--
-- These are EXACTLY the tables readGameConfigHash fans out over — so realtime fires
-- on precisely the rows the config fingerprint is built from, nothing more. Score
-- tables (score_entries / match_hole_outcomes) are DELIBERATELY excluded: scores have
-- their own poll + outbox path (#15/#16) and are high-frequency; this is config only.
--
-- REPLICA IDENTITY FULL — only where the client's realtime FILTER column is NOT in the
-- table's primary key, so a DELETE still carries it and net-removal events match:
--   • game_matches / game_participants / play_groups — PK is (id), filtered by
--     game_id → need FULL, or a clean-replace's DELETEs (and a removed last
--     match / dropped handicap) never reach subscribers.
--   • games — filtered by id (the PK) → default replica identity already emits it.
--   • game_delegates — PK is (game_id, user_id), filtered by game_id → game_id is IN
--     the PK, so the default DELETE payload carries it. No FULL needed (and it avoids
--     the extra WAL). This is the one place a removed delegate propagates on default.

ALTER TABLE public.game_matches      REPLICA IDENTITY FULL;
ALTER TABLE public.game_participants REPLICA IDENTITY FULL;
ALTER TABLE public.play_groups       REPLICA IDENTITY FULL;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['games', 'game_matches', 'game_participants', 'play_groups', 'game_delegates']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
