-- ════════════════════════════════════════════════════════════════════════════
-- 112 · Bracket — schema only. No reader ships in this PR.
--
-- Landed AHEAD of the code that reads it, per CLAUDE.md's Migration Workflow
-- step 3: additive and idempotent, so an early landing is safe, and prod must
-- have the schema before any deploy that queries it.
--
-- ── Why NEW TABLES and not columns on `game_matches` ───────────────────────
-- `game_matches` is read by four formats. Round, slot and advancement are
-- concepts none of them have, and nullable columns on a shared table is how the
-- next divergence starts — every consumer that assumes two fixed sides would
-- have to learn about rounds, byes and advancement, and `matches.listByGame` is
-- already read by callers written against a shape that never had them.
--
-- The deciding detail: `game_matches.result` is `a_win`/`b_win`, which is a
-- positional answer. A bracket's "who won" has to survive byes and an odd draw,
-- where a side may not exist at all. Encoding that as a/b means teaching every
-- existing reader a third case.
--
-- Worth recording for later, NOT acted on here: match play IS a bracket — a
-- single-round, two-side one whose placement comes from aggregate rather than
-- advancement. That convergence is real and is a someday refactor, not this.
--
-- ── Why `games.bracket_config` IS a column on a shared table ───────────────
-- The objection above is about rows that existing code ITERATES. A new column
-- on `games` is simply not selected by anyone who doesn't want it, and per-format
-- config already lives there (`modifiers`, `scorecard_schema`, `course_id`,
-- `competition_format`). Defaults to `{}`, so it is inert for every other format.
--
-- ── The advancement model, so the schema reads correctly ───────────────────
-- Later rounds are DERIVED, never materialised. Round 1 carries entrants;
-- every match carries at most a winner; who is IN a later match is computed from
-- the winners below it. That is CLAUDE.md #11's rule (derived, never snapshotted)
-- applied here, and it is what makes an undo one column wide instead of a
-- cascade — picking the wrong winner is a certainty, and the fix routes through
-- the existing correction flow rather than a second mechanism.
--
-- A BYE is a null opponent, not a match: `entrant_b_id IS NULL` in round 1. It
-- stores no winner and no result, because nobody played — an auto-advanced match
-- would invent a record of a game that did not happen and could be mis-picked.
-- The advance is computed.
-- ════════════════════════════════════════════════════════════════════════════

-- ── games.bracket_config ────────────────────────────────────────────────────
-- { elimination: 'single'|'double', entrants: 'singles'|'partners',
--   seeding: 'manual'|'random_avoid_teammates'|'random', consolation: boolean }
-- Shape is validated by zod at the RPC boundary, which is where this codebase
-- validates; the column is deliberately not a check-constrained tangle.
ALTER TABLE public.games
  ADD COLUMN IF NOT EXISTS bracket_config jsonb NOT NULL DEFAULT '{}'::jsonb;

-- ── bracket_entrants — one row per COMPETITOR in the draw ───────────────────
-- `team_id` is the constraint that makes everything downstream unambiguous: an
-- entrant belongs to exactly one cup team, so its points land on one team. In
-- 2v2 that is what "a partner must be on the same cup team" MEANS structurally
-- — the pair has one team_id, so it cannot span two.
--
-- `seed` is the draw position and is UNIQUE within the game: `configHash` folds
-- list reads in and needs a total order, or two rows can swap and the hash miss
-- it (CLAUDE.md #16).
CREATE TABLE IF NOT EXISTS public.bracket_entrants (
  id text PRIMARY KEY,
  game_id text NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  team_id text NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  seed integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (game_id, seed)
);
CREATE INDEX IF NOT EXISTS idx_bracket_entrants_game_id ON public.bracket_entrants (game_id);

-- ── bracket_entrant_members — who is in an entrant ──────────────────────────
-- One row for singles, two for partners. A JOIN TABLE rather than a jsonb array
-- on the entrant, deliberately: a jsonb person reference is invisible to every
-- `UPDATE ... SET user_id` and needs `jsonb_set` in the guest merge — the exact
-- landmine CLAUDE.md records for `game_matches.side_a/side_b`. A real column is
-- reachable by the merge's ordinary UPDATE.
CREATE TABLE IF NOT EXISTS public.bracket_entrant_members (
  entrant_id text NOT NULL REFERENCES public.bracket_entrants(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  PRIMARY KEY (entrant_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_bracket_entrant_members_user_id
  ON public.bracket_entrant_members (user_id);

-- ── bracket_matches — the tree ──────────────────────────────────────────────
-- `entrant_a_id`/`entrant_b_id` are populated for ROUND 1 ONLY (the seeded
-- draw). Later rounds leave them null and derive their participants from the
-- winners below — see the advancement note in the header.
--
-- `bracket` separates the main draw from the consolation match, so 3rd/4th are
-- STRUCTURALLY ABSENT when the toggle is off rather than hidden: no row exists.
--
-- UNIQUE (game_id, bracket, round, slot) is the total order `configHash` needs.
CREATE TABLE IF NOT EXISTS public.bracket_matches (
  id text PRIMARY KEY,
  game_id text NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  bracket text NOT NULL DEFAULT 'main' CHECK (bracket IN ('main', 'consolation')),
  round integer NOT NULL,
  slot integer NOT NULL,
  entrant_a_id text REFERENCES public.bracket_entrants(id) ON DELETE CASCADE,
  entrant_b_id text REFERENCES public.bracket_entrants(id) ON DELETE CASCADE,
  winner_entrant_id text REFERENCES public.bracket_entrants(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (game_id, bracket, round, slot)
);
CREATE INDEX IF NOT EXISTS idx_bracket_matches_game_id ON public.bracket_matches (game_id);

-- ── RLS — the SAME shape as game_matches/play_groups ───────────────────────
-- Members read, Owner/Organizer write, scoped through the game's trip. Copied
-- rather than invented so a bracket cannot be more or less visible than the
-- match play beside it.
ALTER TABLE public.bracket_entrants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bracket_entrant_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bracket_matches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bracket_entrants_select ON public.bracket_entrants;
CREATE POLICY bracket_entrants_select ON public.bracket_entrants FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.games g
                 WHERE g.id = bracket_entrants.game_id AND is_trip_member(g.trip_id)));
DROP POLICY IF EXISTS bracket_entrants_write ON public.bracket_entrants;
CREATE POLICY bracket_entrants_write ON public.bracket_entrants FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.games g
                 WHERE g.id = bracket_entrants.game_id
                   AND has_trip_role(g.trip_id, ARRAY['Owner'::text, 'Organizer'::text])))
  WITH CHECK (EXISTS (SELECT 1 FROM public.games g
                 WHERE g.id = bracket_entrants.game_id
                   AND has_trip_role(g.trip_id, ARRAY['Owner'::text, 'Organizer'::text])));

DROP POLICY IF EXISTS bracket_entrant_members_select ON public.bracket_entrant_members;
CREATE POLICY bracket_entrant_members_select ON public.bracket_entrant_members FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.bracket_entrants e JOIN public.games g ON g.id = e.game_id
                 WHERE e.id = bracket_entrant_members.entrant_id AND is_trip_member(g.trip_id)));
DROP POLICY IF EXISTS bracket_entrant_members_write ON public.bracket_entrant_members;
CREATE POLICY bracket_entrant_members_write ON public.bracket_entrant_members FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.bracket_entrants e JOIN public.games g ON g.id = e.game_id
                 WHERE e.id = bracket_entrant_members.entrant_id
                   AND has_trip_role(g.trip_id, ARRAY['Owner'::text, 'Organizer'::text])))
  WITH CHECK (EXISTS (SELECT 1 FROM public.bracket_entrants e JOIN public.games g ON g.id = e.game_id
                 WHERE e.id = bracket_entrant_members.entrant_id
                   AND has_trip_role(g.trip_id, ARRAY['Owner'::text, 'Organizer'::text])));

DROP POLICY IF EXISTS bracket_matches_select ON public.bracket_matches;
CREATE POLICY bracket_matches_select ON public.bracket_matches FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.games g
                 WHERE g.id = bracket_matches.game_id AND is_trip_member(g.trip_id)));
DROP POLICY IF EXISTS bracket_matches_write ON public.bracket_matches;
CREATE POLICY bracket_matches_write ON public.bracket_matches FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.games g
                 WHERE g.id = bracket_matches.game_id
                   AND has_trip_role(g.trip_id, ARRAY['Owner'::text, 'Organizer'::text])))
  WITH CHECK (EXISTS (SELECT 1 FROM public.games g
                 WHERE g.id = bracket_matches.game_id
                   AND has_trip_role(g.trip_id, ARRAY['Owner'::text, 'Organizer'::text])));

-- ── merge_guest_to_real_user — extended IN THIS MIGRATION, not later ────────
-- CLAUDE.md's add-rule: a new table with a person reference goes into the merge
-- in the SAME migration that creates it. This direction fails SILENTLY — the
-- merge ends by DELETEing the guest, so an uncovered `user_id` is cascade-deleted
-- and nothing errors. Replaced verbatim from migration 095 with one block added.

CREATE OR REPLACE FUNCTION public.merge_guest_to_real_user(p_ghost_id text, p_real_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  -- ── Trip + planning era ────────────────────────────────────────────────────
  -- UNIQUE (trip_id, user_id): drop the ghost's row when the real user is
  -- already a member of that trip, then move what's left.
  DELETE FROM public.trip_members g
   WHERE g.user_id = p_ghost_id
     AND EXISTS (SELECT 1 FROM public.trip_members r
                  WHERE r.trip_id = g.trip_id AND r.user_id = p_real_id);
  UPDATE public.trip_members SET user_id = p_real_id WHERE user_id = p_ghost_id;

  -- PK (idea_id, user_id) — the real user's existing vote wins.
  DELETE FROM public.idea_votes g
   WHERE g.user_id = p_ghost_id
     AND EXISTS (SELECT 1 FROM public.idea_votes r
                  WHERE r.idea_id = g.idea_id AND r.user_id = p_real_id);
  UPDATE public.idea_votes SET user_id = p_real_id WHERE user_id = p_ghost_id;

  -- PK (window_id, user_id).
  DELETE FROM public.date_poll_votes g
   WHERE g.user_id = p_ghost_id
     AND EXISTS (SELECT 1 FROM public.date_poll_votes r
                  WHERE r.window_id = g.window_id AND r.user_id = p_real_id);
  UPDATE public.date_poll_votes SET user_id = p_real_id WHERE user_id = p_ghost_id;

  -- PK (expense_id, user_id).
  DELETE FROM public.expense_splits g
   WHERE g.user_id = p_ghost_id
     AND EXISTS (SELECT 1 FROM public.expense_splits r
                  WHERE r.expense_id = g.expense_id AND r.user_id = p_real_id);
  UPDATE public.expense_splits SET user_id = p_real_id WHERE user_id = p_ghost_id;

  -- PK (trip_id, user_id, visibility) — read receipts, NEW coverage (CASCADE).
  DELETE FROM public.chat_reads g
   WHERE g.user_id = p_ghost_id
     AND EXISTS (SELECT 1 FROM public.chat_reads r
                  WHERE r.trip_id = g.trip_id AND r.visibility = g.visibility
                    AND r.user_id = p_real_id);
  UPDATE public.chat_reads SET user_id = p_real_id WHERE user_id = p_ghost_id;

  -- PK (trip_id, user_id) — NEW coverage (CASCADE).
  DELETE FROM public.news_reads g
   WHERE g.user_id = p_ghost_id
     AND EXISTS (SELECT 1 FROM public.news_reads r
                  WHERE r.trip_id = g.trip_id AND r.user_id = p_real_id);
  UPDATE public.news_reads SET user_id = p_real_id WHERE user_id = p_ghost_id;

  -- PK (circle_id, user_id) — NEW coverage (CASCADE).
  DELETE FROM public.circle_members g
   WHERE g.user_id = p_ghost_id
     AND EXISTS (SELECT 1 FROM public.circle_members r
                  WHERE r.circle_id = g.circle_id AND r.user_id = p_real_id);
  UPDATE public.circle_members SET user_id = p_real_id WHERE user_id = p_ghost_id;

  -- Unconstrained on user_id — plain moves.
  UPDATE public.messages          SET user_id         = p_real_id WHERE user_id         = p_ghost_id;
  UPDATE public.expenses          SET paid_by_user_id = p_real_id WHERE paid_by_user_id = p_ghost_id;
  UPDATE public.archived_ideas    SET user_id         = p_real_id WHERE user_id         = p_ghost_id; -- NEW (CASCADE)
  UPDATE public.news_posts        SET author_id       = p_real_id WHERE author_id       = p_ghost_id; -- NEW (CASCADE)
  -- push_subscriptions is UNIQUE on `endpoint`, not user_id, so this is safe:
  -- a ghost and a real account cannot share an endpoint.
  UPDATE public.push_subscriptions SET user_id        = p_real_id WHERE user_id         = p_ghost_id; -- NEW (CASCADE)

  -- Authorship / audit columns (SET NULL if the ghost were deleted).
  UPDATE public.quick_info_tiles     SET created_by   = p_real_id WHERE created_by   = p_ghost_id;
  UPDATE public.users                SET created_by   = p_real_id WHERE created_by   = p_ghost_id;
  UPDATE public.invites              SET created_by   = p_real_id WHERE created_by   = p_ghost_id;
  UPDATE public.schedule_items       SET created_by   = p_real_id WHERE created_by   = p_ghost_id; -- NEW
  UPDATE public.schedule_items       SET confirmed_by = p_real_id WHERE confirmed_by = p_ghost_id; -- NEW
  UPDATE public.logistics_items      SET created_by   = p_real_id WHERE created_by   = p_ghost_id; -- NEW
  UPDATE public.idea_lodging_options SET created_by   = p_real_id WHERE created_by   = p_ghost_id; -- NEW
  UPDATE public.circles              SET created_by   = p_real_id WHERE created_by   = p_ghost_id; -- NEW
  UPDATE public.courses              SET created_by   = p_real_id WHERE created_by   = p_ghost_id; -- NEW

  -- ── Competition / scoring era ──────────────────────────────────────────────
  -- PK (competition_id, user_id) — one team per person per competition.
  DELETE FROM public.team_assignments g
   WHERE g.user_id = p_ghost_id
     AND EXISTS (SELECT 1 FROM public.team_assignments r
                  WHERE r.competition_id = g.competition_id AND r.user_id = p_real_id);
  UPDATE public.team_assignments SET user_id = p_real_id WHERE user_id = p_ghost_id;

  -- UNIQUE (game_id, user_id) — rostered participation. Its CASCADE FK would
  -- otherwise delete these rows with the ghost.
  DELETE FROM public.game_participants g
   WHERE g.user_id = p_ghost_id
     AND EXISTS (SELECT 1 FROM public.game_participants r
                  WHERE r.game_id = g.game_id AND r.user_id = p_real_id);
  UPDATE public.game_participants SET user_id = p_real_id WHERE user_id = p_ghost_id;

  -- PK (game_id, user_id) — NEW coverage (CASCADE): delegate grants.
  DELETE FROM public.game_delegates g
   WHERE g.user_id = p_ghost_id
     AND EXISTS (SELECT 1 FROM public.game_delegates r
                  WHERE r.game_id = g.game_id AND r.user_id = p_real_id);
  UPDATE public.game_delegates SET user_id    = p_real_id WHERE user_id    = p_ghost_id; -- NEW
  UPDATE public.game_delegates SET granted_by = p_real_id WHERE granted_by = p_ghost_id; -- NEW

  -- PK (entrant_id, user_id) — NEW (migration 112): bracket entrant membership.
  -- Collision-safe in the same shape as game_delegates above: if the guest and
  -- the real account are BOTH in the same entrant (an owner pairs a placeholder
  -- with the person it stands for, then that person signs up), a plain UPDATE
  -- raises 23505 INSIDE the signup trigger and signup fails for that user. The
  -- real account is the surviving identity, so the guest's losing row goes first.
  --
  -- Without this the row CASCADES away with the guest and the entrant silently
  -- loses a partner — a 2v2 pairing quietly becomes a 1-player entrant, and the
  -- bracket keeps running with it.
  DELETE FROM public.bracket_entrant_members g
   WHERE g.user_id = p_ghost_id
     AND EXISTS (SELECT 1 FROM public.bracket_entrant_members r
                  WHERE r.entrant_id = g.entrant_id AND r.user_id = p_real_id);
  UPDATE public.bracket_entrant_members SET user_id = p_real_id WHERE user_id = p_ghost_id;

  -- Polymorphic (type,id) pairs — user-typed rows ONLY; team / play_group rows
  -- are a different identity space and must not be touched.
  UPDATE public.score_entries       SET participant_id = p_real_id WHERE participant_id = p_ghost_id AND participant_type = 'user';
  UPDATE public.score_entries       SET submitted_by   = p_real_id WHERE submitted_by   = p_ghost_id;
  UPDATE public.game_results        SET entity_id      = p_real_id WHERE entity_id      = p_ghost_id AND entity_type      = 'user';
  UPDATE public.match_hole_outcomes SET submitted_by   = p_real_id WHERE submitted_by   = p_ghost_id;

  -- JSONB match sides — NEW. Unreachable by `SET col = value`; the id lives
  -- inside the document. Guarded on type='user' so play_group sides are left
  -- intact (their members moved via game_participants above).
  UPDATE public.game_matches
     SET side_a = jsonb_set(side_a, '{id}', to_jsonb(p_real_id))
   WHERE side_a ->> 'type' = 'user' AND side_a ->> 'id' = p_ghost_id;
  UPDATE public.game_matches
     SET side_b = jsonb_set(side_b, '{id}', to_jsonb(p_real_id))
   WHERE side_b ->> 'type' = 'user' AND side_b ->> 'id' = p_ghost_id;

  -- ── Retire the now-empty ghost ─────────────────────────────────────────────
  DELETE FROM public.users WHERE id = p_ghost_id AND is_guest = true;
END;
$$;

COMMENT ON FUNCTION public.merge_guest_to_real_user(text, text) IS
  'Reassign every person-reference from a guest row to a real account, then delete the guest. '
  'Runs inside the signup trigger (handle_new_user) AND, via link_guest_to_account, from '
  'ghostCrew.update''s auto-link branch. MUST cover every table with a person reference — a new '
  'such table has to be added here, or the ghost DELETE will cascade its rows away or null them out.';
