-- ONE-TIME, PRODUCTION-ONLY data backfill — applied OUT-OF-BAND on 2026-06-17
-- (via the Supabase SQL path, NOT a migration). Do NOT add to migrations/.
--
-- Why out-of-band, not a migration: this corrects LEGACY production rows only.
-- A fresh DB (CI test DB, a new environment) never needs it — new match-play
-- games get a default match row at creation (the dynamic-match-count flow), and
-- the test suite creates its own rows. Putting it in a migration would make
-- every DB run a data backfill it doesn't need.
--
-- Context: dynamic match count made the competition leaderboard derive a match
-- game's available points from its CONFIGURED match count (its game_matches
-- rows) instead of the team-size estimate. Legacy match-play games created
-- before the "≥1 row from creation" invariant had 0 rows and would silently
-- contribute 0 to "first to XX". This gives each such game a single default
-- (empty) match so it contributes value × 1 instead of 0. Idempotent
-- (NOT EXISTS) — safe to re-run. Scoped to match play ONLY; rack-n-stack and
-- other per_match formats don't use game_matches (they keep team-size sizing).
--
-- Affected on 2026-06-17: 5 pending match-play games (incl. BBMI "Teams").

insert into game_matches (id, game_id, play_group_id, match_number, display_order, side_a, side_b, status)
select gen_random_uuid(), g.id, null, 1, 0, null, null,
       case when g.status = 'active' then 'active' else 'pending' end
from games g
where g.game_type_id in ('gtt_match_play_singles', 'gtt_match_play_doubles')
  and not exists (select 1 from game_matches m where m.game_id = g.id);
