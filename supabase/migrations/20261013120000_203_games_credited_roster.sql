-- ════════════════════════════════════════════════════════════════════════════
-- 203 · A finished game remembers the roster it was credited through (PR 8a)
-- ════════════════════════════════════════════════════════════════════════════
--
-- ── THE GAP ────────────────────────────────────────────────────────────────
--
-- Ruling 15: standings stay with the unit credited at the time. The BOARD
-- already obeys it — banked team points are read from the stored team rows,
-- never from today's roster (PR 2, migration 191).
--
-- The WRITERS do not. Five finalize writers (stroke/scramble, skins, match
-- play's awards, rack, pick'em) rebuild their team rows from the CURRENT
-- `team_assignments` every time they run, and a correction re-runs them. So a
-- player traded after a stroke round, followed by a one-hole correction, moves
-- that whole round to their new team: rulings 15, 16 and 17 broken through the
-- write path rather than the read path.
--
-- Nothing reaches that today, because the roster lock (`assertRosterUnlocked`,
-- `_competition_roster_locked`) refuses every move once any game has a score.
-- Ruling 16 says trades are allowed after results, so PR 8 lifts that lock —
-- and the lock is the only thing standing between a trade and this. It never
-- said so. This migration lands FIRST, so that lifting the lock exposes nothing.
--
-- ── WHY A COLUMN, NOT THE RESULT ROWS ──────────────────────────────────────
--
-- The obvious question is whether `game_results` already IS this snapshot —
-- PR 2 added `credited_team_id` to every row. It is not, for three reasons:
--
--   1. Rack and pick'em write TEAM rows only. There is no per-person row on
--      which a person's team at finalize could live.
--   2. A re-finalize needs PERSON -> team to recompute the team aggregates.
--      Team rows say who was paid, not who was on which team; scramble's group
--      rows and 2v2 match sides resolve to a team only through their members.
--   3. Migration 191 deliberately keeps `credited_team_id` NULL on person rows:
--      "inventing a team for them would make the column mean two different
--      things". Writing a team there now would reverse that ruling.
--
-- So one map per game, user_id -> team_id, taken from the whole cup roster at
-- the FIRST finalize. jsonb on `games` rather than a table, because it has to
-- express three states and only a nullable document does that without a
-- second marker:
--
--   NULL  — never credited. Writers read the live roster.
--   {}    — credited, and nobody was on a team (a teamless race).
--   {...} — credited. A person ABSENT from the map was on no team at the time,
--           and stays creditless on every re-finalize (ruling 17): absence
--           here is a recorded fact, not a reason to fall back to the roster.
--
-- ── FIRST FINALIZE WINS, IN THE DATABASE ───────────────────────────────────
--
-- The wrapper only ever writes the column while it is NULL, so a re-finalize
-- cannot replace the roster a game was credited through even if a writer
-- passes today's. Replacing it on purpose is ruling 18's owner correction, a
-- separate and recorded path (PR 8c). `_reset_game_scoring` clears it: a reset
-- game is replayed, and its next finalize is a first finalize again.
--
-- It is written in the SAME call as the results, so the two commit together.
-- Only the finalize path passes it (`writeGameResults` forwards it in "throw"
-- mode only); a live recompute during play must not anchor the credit early —
-- under ruling 15 a game's points are not earned until it finalizes.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1 · The column ─────────────────────────────────────────────────────────

ALTER TABLE public.games
  ADD COLUMN IF NOT EXISTS credited_roster jsonb;

COMMENT ON COLUMN public.games.credited_roster IS
  'user_id -> team_id: the cup roster this game''s results were credited through, '
  'as at its FIRST finalize (migration 203). NULL = never credited (writers read '
  'the live roster). A user absent from a non-null map was on no team then. '
  'Written only while NULL, by write_game_results; cleared by _reset_game_scoring.';

-- ── 2 · The wrapper takes the roster, in the same transaction ───────────────
--
-- A new parameter changes the signature, and CREATE OR REPLACE with a new
-- signature makes an OVERLOAD, which PostgREST cannot disambiguate. So the old
-- signature is dropped first. The core `_write_game_results` is untouched.

DROP FUNCTION IF EXISTS public.write_game_results(text, jsonb, text, text[], text, jsonb);

CREATE OR REPLACE FUNCTION public.write_game_results(
  p_game_id         text,
  p_rows            jsonb  DEFAULT '[]'::jsonb,
  p_scope           text   DEFAULT 'all',
  p_entity_ids      text[] DEFAULT NULL,
  p_entity_type     text   DEFAULT NULL,
  p_match_updates   jsonb  DEFAULT '[]'::jsonb,
  p_credited_roster jsonb  DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  PERFORM public.assert_game_edit(p_game_id);
  PERFORM public._write_game_results(
    p_game_id, p_rows, p_scope, p_entity_ids, p_entity_type, p_match_updates
  );

  -- First finalize wins. `jsonb_typeof` refuses anything but an object, so a
  -- caller cannot record an array or a scalar as a roster.
  IF p_credited_roster IS NOT NULL THEN
    IF jsonb_typeof(p_credited_roster) <> 'object' THEN
      RAISE EXCEPTION 'CREDITED_ROSTER_NOT_OBJECT' USING ERRCODE = 'invalid_parameter_value';
    END IF;
    UPDATE public.games
       SET credited_roster = p_credited_roster
     WHERE id = p_game_id
       AND credited_roster IS NULL;
  END IF;
END;
$$;

-- Guarded by `assert_game_edit`, as before. DROP + CREATE resets the ACL to the
-- defaults, so the grant is restated rather than inherited. `anon` is not
-- re-granted: it held EXECUTE before only by default, and `assert_game_edit`
-- refused it anyway.
REVOKE ALL ON FUNCTION public.write_game_results(text, jsonb, text, text[], text, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.write_game_results(text, jsonb, text, text[], text, jsonb, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.write_game_results(text, jsonb, text, text[], text, jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.write_game_results(text, jsonb, text, text[], text, jsonb, jsonb) TO service_role;

-- ── 3 · A reset clears it (verbatim from 184 plus one column) ───────────────

CREATE OR REPLACE FUNCTION public._reset_game_scoring(p_game_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  -- Everything PLAYED, in every shape it is stored in (125, 162).
  DELETE FROM public.game_results        WHERE game_id = p_game_id;
  DELETE FROM public.score_entries       WHERE game_id = p_game_id;
  DELETE FROM public.match_hole_outcomes WHERE game_id = p_game_id;
  -- The whole of a SKINS game's score (184). Same case as the line above:
  -- these rows ARE the score for this format, and they cascade only via
  -- `play_groups`, which level 1 does not delete.
  DELETE FROM public.skins_hole_outcomes WHERE game_id = p_game_id;

  -- The sixth shape (159). A pick'em game stores its outcomes HERE and nowhere
  -- above — no score_entries, no match_hole_outcomes — so omitting it made this
  -- sweep a no-op on the entire format.
  UPDATE public.pickem_slate_games
     SET result = NULL
   WHERE game_id = p_game_id;

  UPDATE public.game_matches
     SET result = NULL, margin = NULL, status = 'pending'
   WHERE game_id = p_game_id;

  UPDATE public.bracket_matches
     SET winner_entrant_id = NULL
   WHERE game_id = p_game_id;

  -- The go-live triple, kept consistent (#895 / #25). `status` follows the
  -- switch rather than being forced to 'pending' beside an enabled game.
  UPDATE public.games
     SET corrections_open = false,
         -- 203: a reset game is replayed, so its next finalize is a first
         -- finalize again and takes the roster as it stands then.
         credited_roster = NULL,
         status = CASE WHEN scoring_enabled THEN 'active' ELSE 'pending' END
   WHERE id = p_game_id;
END;
$function$;

REVOKE ALL ON FUNCTION public._reset_game_scoring(text) FROM PUBLIC, anon, authenticated;

-- ── 4 · The guest merge re-keys it (verbatim from 194 plus one UPDATE) ──────
-- CLAUDE.md: a person-referencing column is added to the merge in the SAME
-- migration, or the merge silently loses it.

CREATE OR REPLACE FUNCTION public.merge_guest_to_real_user(p_ghost_id text, p_real_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  -- Credited rosters — NEW (migration 203). The person is a KEY of
  -- `games.credited_roster`, unreachable by `SET col = value` just like the
  -- match sides above. If the guest and the real account are BOTH keys (both
  -- were on the cup roster when the game finalized), the real account's entry
  -- wins, as it does for every other collision here; otherwise the guest's
  -- team moves to the real account. Without this a placeholder's finished
  -- games would credit the real person as teamless on their next re-finalize.
  UPDATE public.games
     SET credited_roster = CASE
           WHEN credited_roster ? p_real_id THEN credited_roster - p_ghost_id
           ELSE (credited_roster - p_ghost_id)
                || jsonb_build_object(p_real_id, credited_roster -> p_ghost_id)
         END
   WHERE credited_roster ? p_ghost_id;

  -- Pick'em sheets — NEW (migration 146). Delegated so the sheet-level
  -- collision rule (whole sheets, not rows: pickem_picks carries TWO unique
  -- keys, and a row-wise merge can satisfy one while breaking the other) keeps
  -- its explanation next to the code that implements it.
  PERFORM public.merge_guest_pickem_picks(p_ghost_id, p_real_id);

  -- ── Retire the now-empty ghost ─────────────────────────────────────────────
  DELETE FROM public.users WHERE id = p_ghost_id AND is_guest = true;
END;
$function$;

REVOKE ALL ON FUNCTION public.merge_guest_to_real_user(text, text) FROM PUBLIC, anon, authenticated;
