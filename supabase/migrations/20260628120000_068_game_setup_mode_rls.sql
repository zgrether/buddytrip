-- A2-core: Setup/Scoring mode — scoring-enabled-aware RLS on a game's child rows.
--
-- The mode toggle makes a SETUP-mode game members-walled: a plain trip member must
-- not be able to read its scores / matches / pairings / foursomes / results / roster,
-- even via raw PostgREST or Realtime. The tRPC layer already gates these reads
-- (A2-core 3); this closes the raw-DB surface — the point of the keystone.
--
-- DB-VALUE layer (CLAUDE.md): these policies branch on an RLS-relevant column tsc
-- cannot guard — so every touched policy is rebuilt explicitly here, idempotently
-- (DROP IF EXISTS + CREATE).
--
-- SIGNAL = `games.scoring_enabled`, not `status`. A game is "open to the crew"
-- exactly when scoring_enabled is true; setup mode is scoring_enabled = false. The
-- A2-core toggle couples scoring_enabled ⟺ status:'active' (enable sets both; disable
-- clears both), so this is equivalent to the status-based model — but keying RLS on
-- scoring_enabled is **backward-compatible**: pre-A2-core code left an enabled game at
-- scoring_enabled=true (status pending until the first score), so a status='pending'
-- gate would have walled those legitimately-enabled games (and blocked the next score)
-- during the window before the A2-core code ships. scoring_enabled has no such window
-- and needs no data heal.
--
-- Decision A (confirmed): the games ROW stays membership-readable — it carries the
-- existence shell (name/type/status) the "still being set up" placeholder needs, and
-- it is NOT the scores/matches/pairings/foursomes the threat model targets. Only the
-- 5 CHILD tables are tightened. (Row-level RLS can't column-subset a row anyway.)
--
-- Editors keep full access on a setup-mode game (they're setting it up): owner/
-- organizer via the existing `_write` (FOR ALL, has_trip_role) policies and this
-- game's delegate via the existing `_delegate` (FOR ALL, mig 061) policies — both
-- PERMISSIVE, so OR'd with `_select`. score_entries is the exception: its `_write` is
-- `is_trip_member` FOR ALL (engine decision #7 — any member scores), which would
-- itself grant members SELECT, so score_entries' `_write` is tightened too (and the
-- editor branch is spelled out in its policies, as it has no separate editor policy).
--
-- Shared member predicate: a member sees a child row only when the parent game is
-- scoring-enabled, OR they are an editor (owner/organizer/this game's delegate).

-- ── game_participants (roster) ───────────────────────────────────────────────
DROP POLICY IF EXISTS game_participants_select ON public.game_participants;
CREATE POLICY game_participants_select ON public.game_participants FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.games g
                 WHERE g.id = game_participants.game_id
                   AND is_trip_member(g.trip_id)
                   AND (g.scoring_enabled = true
                        OR has_trip_role(g.trip_id, ARRAY['Owner'::text, 'Organizer'::text])
                        OR is_game_delegate(g.id))));

-- ── game_results ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS game_results_select ON public.game_results;
CREATE POLICY game_results_select ON public.game_results FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.games g
                 WHERE g.id = game_results.game_id
                   AND is_trip_member(g.trip_id)
                   AND (g.scoring_enabled = true
                        OR has_trip_role(g.trip_id, ARRAY['Owner'::text, 'Organizer'::text])
                        OR is_game_delegate(g.id))));

-- ── play_groups (foursomes / 2v2 sides) ──────────────────────────────────────
DROP POLICY IF EXISTS play_groups_select ON public.play_groups;
CREATE POLICY play_groups_select ON public.play_groups FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.games g
                 WHERE g.id = play_groups.game_id
                   AND is_trip_member(g.trip_id)
                   AND (g.scoring_enabled = true
                        OR has_trip_role(g.trip_id, ARRAY['Owner'::text, 'Organizer'::text])
                        OR is_game_delegate(g.id))));

-- ── game_matches (pairings) ──────────────────────────────────────────────────
DROP POLICY IF EXISTS game_matches_select ON public.game_matches;
CREATE POLICY game_matches_select ON public.game_matches FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.games g
                 WHERE g.id = game_matches.game_id
                   AND is_trip_member(g.trip_id)
                   AND (g.scoring_enabled = true
                        OR has_trip_role(g.trip_id, ARRAY['Owner'::text, 'Organizer'::text])
                        OR is_game_delegate(g.id))));

-- ── score_entries (the exception — _write is is_trip_member FOR ALL, so it grants
--    SELECT too; tighten BOTH, and spell out the editor branch since there is no
--    separate editor policy for this table) ─────────────────────────────────────
DROP POLICY IF EXISTS score_entries_select ON public.score_entries;
CREATE POLICY score_entries_select ON public.score_entries FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.games g
                 WHERE g.id = score_entries.game_id
                   AND is_trip_member(g.trip_id)
                   AND (g.scoring_enabled = true
                        OR has_trip_role(g.trip_id, ARRAY['Owner'::text, 'Organizer'::text])
                        OR is_game_delegate(g.id))));
DROP POLICY IF EXISTS score_entries_write ON public.score_entries;
CREATE POLICY score_entries_write ON public.score_entries FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.games g
                 WHERE g.id = score_entries.game_id
                   AND is_trip_member(g.trip_id)
                   AND (g.scoring_enabled = true
                        OR has_trip_role(g.trip_id, ARRAY['Owner'::text, 'Organizer'::text])
                        OR is_game_delegate(g.id))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.games g
                 WHERE g.id = score_entries.game_id
                   AND is_trip_member(g.trip_id)
                   AND (g.scoring_enabled = true
                        OR has_trip_role(g.trip_id, ARRAY['Owner'::text, 'Organizer'::text])
                        OR is_game_delegate(g.id))));
