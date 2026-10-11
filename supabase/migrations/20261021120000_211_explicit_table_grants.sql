-- 211 · Every table's Data API grants, stated (#1440)
--
-- From 2026-10-30, Supabase stops granting `anon` / `authenticated` /
-- `service_role` on new tables in `public` automatically — including in a fresh
-- local database, which is what CI builds on every run (`supabase start`
-- replays from zero, #636). Until this migration, the migrations stated table
-- grants for only three relations (`game_started` in 161, `game_recredits` in
-- 204, `trip_departures` in 205); every other table took its privileges from the
-- platform's default ACL. The first CI run after the change would build tables
-- nobody can touch, and every DB-backed suite would go red at once.
--
-- So this states, per relation, exactly what production holds today — read
-- from production on 2026-10-11 (read-only catalogue query, `aclexplode` over
-- `pg_class` in `public`), latest applied migration 210:
--
--   - 49 tables and the `game_started` view: `anon`, `authenticated` and
--     `service_role` each hold ALL (SELECT, INSERT, UPDATE, DELETE, TRUNCATE,
--     REFERENCES, TRIGGER, MAINTAIN), none grantable, owner `postgres`.
--   - `game_recredits` and `trip_departures`: deliberately NARROWER —
--     `authenticated` SELECT, `service_role` ALL, `anon` nothing — stated in
--     their own migrations (204, 205). Not touched here: granting ALL to them
--     would undo the narrowing.
--
-- REPRODUCES PRODUCTION, not the notice's example (which gives `anon` only
-- SELECT and the other two four privileges): anything reaching a table as one
-- of these roles today would otherwise start failing on privilege before RLS
-- runs. RLS is still what decides rows; these grants only let a role reach the
-- table for RLS to be asked.
--
-- `game_started` is ALL, not the SELECT 161 stated: the default ACL made the
-- effective grant wider than the stated one, and production holds ALL. Stating
-- SELECT here would narrow it on the next fresh replay and nowhere else.
--
-- Named one by one, never `ALL TABLES IN SCHEMA`: the point is that the file
-- says what each relation has, and a schema-wide grant would silently cover a
-- future table that was meant to be narrower (as 204 and 205 are).
--
-- Idempotent — GRANT is — so against production, where every one of these is
-- already held, it changes nothing. Functions' EXECUTE grants are not touched
-- (#1048's territory, going the other way). There are no sequences in
-- `public` (ids are `text`).
--
-- From here on, every `CREATE TABLE` states its grants in the same migration
-- (CLAUDE.md, "ADD a table → state its grants"); `migrationGrants.guard.test.ts`
-- fails a replay whose final tables include one with no grant stated.

GRANT ALL ON TABLE public.api_usage_daily TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.archived_ideas TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.bracket_entrant_members TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.bracket_entrants TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.bracket_matches TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.catalog_ideas TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.chat_reads TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.circle_courses TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.circle_events TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.circle_members TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.circles TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.competitions TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.courses TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.date_poll_votes TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.date_polls TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.date_windows TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.expense_splits TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.expenses TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.game_delegates TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.game_matches TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.game_participants TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.game_results TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.game_started TO anon, authenticated, service_role;  -- a view; migration 161 stated SELECT, prod holds ALL
GRANT ALL ON TABLE public.game_type_templates TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.games TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.golf_courses TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.idea_lodging_options TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.idea_votes TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.ideas TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.invites TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.logistics_items TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.match_hole_outcomes TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.messages TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.news_posts TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.news_reads TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.pickem_games TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.pickem_picks TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.pickem_slate_games TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.play_groups TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.push_send_log TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.push_subscriptions TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.quick_info_tiles TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.schedule_items TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.score_entries TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.skins_hole_outcomes TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.team_assignments TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.teams TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.trip_members TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.trips TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.users TO anon, authenticated, service_role;
