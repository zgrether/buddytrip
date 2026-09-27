-- ════════════════════════════════════════════════════════════════════════════
-- 194 · game_results: one row per unit per game — enforced, and serialized
--
-- ── The race ────────────────────────────────────────────────────────────────
--
-- `_write_game_results` (100/191) replaces a game's rows as DELETE-then-INSERT
-- with nothing serializing two calls for the same game. Under READ COMMITTED a
-- second call's DELETE waits on the first's row locks, then re-checks only the
-- rows it had already found — it cannot see the rows the first call INSERTED.
-- Both inserts survive. On a double-tapped Finish (or two devices finalizing at
-- once) every team row is written twice, and the board sums them: the cup is
-- paid double. Irreversible in the sense that matters — nothing reports it.
--
-- Latent on `main` and measured, not argued: `games.relockIdempotence`'s
-- concurrent double-finish passed 20 of 20 on main, but #1470 (every read before
-- the first write) packs the two finishes' writes closer together and it failed
-- 11 of 30 there, each time with duplicated team rows. The same branch with the
-- lock below applied locally passed 30 of 30. The race is main's; #1470 only
-- widened the window.
--
-- ── Two checks, doing different jobs ────────────────────────────────────────
--
-- 1. A UNIQUE constraint on (game_id, entity_type, entity_id). This is the
--    guarantee: a duplicate cannot exist, whichever writer tries. The lock alone
--    would not be enough, because it only serializes callers of THIS function —
--    `writeManualResults` (games.ts: every bracket and manual placement) still
--    deletes and inserts over PostgREST outside it, until #1398 converts it. The
--    constraint covers it, and every writer after it. CLAUDE.md: only a rule
--    enforced in the database keeps every writer honest.
--
-- 2. A per-game advisory lock in the RPC. With the constraint alone, the second
--    of two concurrent writes would be REFUSED (23505) — the right outcome
--    stored, but a double-tap surfacing as an error. The lock makes the second
--    call wait, then replace the first's rows cleanly. `writeManualResults` gets
--    the constraint without the lock: a concurrent double finalize of a bracket
--    stores one correct set and returns an error to the redundant call, which is
--    acceptable until #1398.
--
-- ── Why this is an invariant, checked rather than assumed ───────────────────
--
-- Every writer, by the unit it keys on:
--   · match play — one row per SIDE per match (user or play_group). A player is
--     in exactly one match per game: `save_game_config` refuses
--     DUPLICATE_PARTICIPANT (#708) and `matches.assignPlayer` MOVES rather than
--     copies. (`matches.setPairings` has no such refusal, but no screen calls
--     it; through a direct API call a doubled side now makes the finalize
--     refuse instead of writing two rows for one person, which would have
--     double-counted them.)
--   · match play / Matches team rows — one per team (`teamsInGame`).
--   · stroke, scramble, skins — one per participant (game_participants is
--     UNIQUE (game_id, user_id); play_groups are keyed by id) plus one per team.
--   · rack, pick'em — one per team.
--   · bracket / manual — one per entrant / placed team.
-- No format legitimately writes two rows for one unit in one game.
--
-- Production, checked before this was written (2026-09-27, read-only):
-- 267 game_results rows, 0 duplicate (game_id, entity_type, entity_id) groups,
-- and 0 games where one side id appears in two matches. The ADD CONSTRAINT
-- would fail loudly on a duplicate rather than silently keep one, so a replay
-- or a push against a database that had drifted stops here instead of
-- guessing which row was right.
--
-- ── What the constraint obliges elsewhere ───────────────────────────────────
--
-- `merge_guest_to_real_user` repoints a placeholder's `user` rows onto the real
-- account. If both have a row in one game, that UPDATE would raise 23505 INSIDE
-- the signup trigger and signup would fail — the failure CLAUDE.md's merge
-- section warns about for every UNIQUE containing a user id. So the merge gains
-- the same delete-the-loser line it already carries for nine other tables; the
-- real account's row wins, as it does everywhere else in that function.
--
-- The unique index leads with game_id, so it also serves every
-- `WHERE game_id = …` read `idx_game_results_game_id` (033) serves. That index
-- is left alone: dropping it is a separate, optional tidy-up.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1 · The invariant, enforced ─────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'game_results_one_row_per_unit'
       AND conrelid = 'public.game_results'::regclass
  ) THEN
    ALTER TABLE public.game_results
      ADD CONSTRAINT game_results_one_row_per_unit UNIQUE (game_id, entity_type, entity_id);
  END IF;
END $$;

-- ── 2 · The RPC takes a per-game lock (verbatim from 191 plus section 0) ────
CREATE OR REPLACE FUNCTION public._write_game_results(
  p_game_id        text,
  p_rows           jsonb DEFAULT '[]'::jsonb,
  p_scope          text  DEFAULT 'all',
  p_entity_ids     text[] DEFAULT NULL,
  p_entity_type    text  DEFAULT NULL,
  p_match_updates  jsonb DEFAULT '[]'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  IF p_game_id IS NULL THEN
    RAISE EXCEPTION 'GAME_ID_REQUIRED' USING ERRCODE = 'null_value_not_allowed';
  END IF;

  IF p_scope NOT IN ('all', 'entity_ids', 'entity_type') THEN
    RAISE EXCEPTION 'UNKNOWN_SCOPE:%', p_scope USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- ── 0 · One writer per game at a time (194) ────────────────────────────────
  -- Held to COMMIT. A second call for the same game waits here, and its DELETE
  -- below then runs on a snapshot that includes the first call's rows, so it
  -- replaces them instead of inserting beside them. Without this, the second
  -- DELETE waits on the first's row locks and then cannot see what the first
  -- inserted, both inserts survive, and a double-tapped Finish pays the cup
  -- twice. The unique constraint makes that outcome impossible; this makes the
  -- double-tap succeed rather than fail on it.
  PERFORM pg_advisory_xact_lock(hashtext('game_results:' || p_game_id));

  -- ── 1 · Per-match result columns (match play only) ─────────────────────────
  IF p_match_updates IS NOT NULL AND jsonb_array_length(p_match_updates) > 0 THEN
    UPDATE public.game_matches gm
       SET result = u.result,
           margin = u.margin,
           status = u.status
      FROM jsonb_to_recordset(p_match_updates)
             AS u(id text, result text, margin text, status text)
     WHERE gm.id = u.id
       AND gm.game_id = p_game_id;   -- scope guard: never touch another game's rows
  END IF;

  -- ── 2 · Replace the results in the selected scope ──────────────────────────
  IF p_scope = 'all' THEN
    DELETE FROM public.game_results WHERE game_id = p_game_id;
  ELSIF p_scope = 'entity_ids' THEN
    IF p_entity_ids IS NOT NULL AND array_length(p_entity_ids, 1) > 0 THEN
      DELETE FROM public.game_results
       WHERE game_id = p_game_id AND entity_id = ANY(p_entity_ids);
    END IF;
  ELSE  -- 'entity_type'
    IF p_entity_type IS NULL THEN
      RAISE EXCEPTION 'ENTITY_TYPE_REQUIRED' USING ERRCODE = 'null_value_not_allowed';
    END IF;
    DELETE FROM public.game_results
     WHERE game_id = p_game_id AND entity_type = p_entity_type;
  END IF;

  IF p_rows IS NOT NULL AND jsonb_array_length(p_rows) > 0 THEN
    INSERT INTO public.game_results
      (id, game_id, entity_id, entity_type, raw_score, position, points,
       competition_points_earned, value_kind, credited_team_id)
    SELECT
      r.id,
      p_game_id,                      -- always the RPC's game, never the payload's
      r.entity_id,
      r.entity_type,
      r.raw_score,
      r.position,
      r.points,
      r.competition_points_earned,
      r.value_kind,
      r.credited_team_id
    -- raw_score is NUMERIC, not integer. Migration 048 widened it precisely so a
    -- halved match can award a half point; typing it `integer` here would
    -- silently truncate 2.5 to 2 and quietly corrupt every match-play team
    -- tally. Types here must track the table, not the original 033 shape.
    FROM jsonb_to_recordset(p_rows) AS r(
      id                        text,
      entity_id                 text,
      entity_type               text,
      raw_score                 numeric,
      position                  integer,
      points                    numeric,
      competition_points_earned numeric,
      value_kind                text,
      credited_team_id          text
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public._write_game_results(text, jsonb, text, text[], text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._write_game_results(text, jsonb, text, text[], text, jsonb) FROM authenticated;

-- ── 3 · The guest merge learns the collision (verbatim from 184 plus one DELETE) ─
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
  -- UNIQUE (game_id, entity_type, entity_id) — 194. The placeholder and the
  -- real account can both have a result in one game (both were added to it;
  -- game_participants above handles the same case). The real account's row
  -- wins, as it does for every other collision here — without this the UPDATE
  -- raises 23505 INSIDE the signup trigger and signup fails.
  DELETE FROM public.game_results g
   WHERE g.entity_type = 'user' AND g.entity_id = p_ghost_id
     AND EXISTS (SELECT 1 FROM public.game_results r
                  WHERE r.game_id = g.game_id AND r.entity_type = 'user' AND r.entity_id = p_real_id);
  UPDATE public.game_results        SET entity_id      = p_real_id WHERE entity_id      = p_ghost_id AND entity_type      = 'user';
  UPDATE public.match_hole_outcomes SET submitted_by   = p_real_id WHERE submitted_by   = p_ghost_id;

  -- Skins hole winners — NEW (migration 184). `winner_user_id` CASCADEs, so
  -- without this a placeholder's won holes are DELETED at signup, and the
  -- carryover downstream of them then recomputes to a different answer. No
  -- collision handling, and that is checked rather than assumed: the only
  -- UNIQUE key on the table is (grouping_id, hole_number), which carries no
  -- user id, so the guest and the real account cannot both hold one.
  UPDATE public.skins_hole_outcomes SET winner_user_id = p_real_id WHERE winner_user_id = p_ghost_id;
  UPDATE public.skins_hole_outcomes SET submitted_by   = p_real_id WHERE submitted_by   = p_ghost_id;

  -- JSONB match sides — NEW. Unreachable by `SET col = value`; the id lives
  -- inside the document. Guarded on type='user' so play_group sides are left
  -- intact (their members moved via game_participants above).
  UPDATE public.game_matches
     SET side_a = jsonb_set(side_a, '{id}', to_jsonb(p_real_id))
   WHERE side_a ->> 'type' = 'user' AND side_a ->> 'id' = p_ghost_id;
  UPDATE public.game_matches
     SET side_b = jsonb_set(side_b, '{id}', to_jsonb(p_real_id))
   WHERE side_b ->> 'type' = 'user' AND side_b ->> 'id' = p_ghost_id;

  -- Pick'em sheets — NEW (migration 146). Delegated so the sheet-level
  -- collision rule (whole sheets, not rows: pickem_picks carries TWO unique
  -- keys, and a row-wise merge can satisfy one while breaking the other) keeps
  -- its explanation next to the code that implements it.
  PERFORM public.merge_guest_pickem_picks(p_ghost_id, p_real_id);

  -- ── Retire the now-empty ghost ─────────────────────────────────────────────
  DELETE FROM public.users WHERE id = p_ghost_id AND is_guest = true;
END;
$$;
