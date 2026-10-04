-- 204 · Re-credit: the owner's fix for a finished game credited to the wrong team
--
-- PR 8c of the composable-competitions plan (ruling 18, settled 2026-10-04).
--
-- ── What a re-credit is, and what it is not ───────────────────────────────
--
-- A finished game is credited through the roster it FIRST finalized with
-- (`games.credited_roster`, 203), so a trade after the round leaves the round
-- with the team it was played for — the Bengals rule (ruling 15). That is right
-- for a deliberate trade and wrong for a MISTAKE: a player put on the wrong team
-- by a setup error has every round until the fix credited to the wrong side,
-- and nothing could move it.
--
-- A re-credit moves ONE person's credit in ONE finished game to the team they
-- are on now (or to no team, if they are on none), chosen game by game by the
-- trip Owner. Per game, not all at once (Zach, 2026-10-04): a player put on the
-- wrong team for Day 1 and then legitimately traded on Day 3 has Day 1 fixed and
-- Day 2 left where it was earned.
--
-- It is named RE-CREDIT and never "correction": a correction already means
-- reopening a finished game to edit scores (`corrections_open`, the In review
-- badge), and the two would sit on the same board row meaning different things.
--
-- ── Only where the result did not depend on the teams ─────────────────────
--
-- Ruling 18: head-to-head and team-format results stand as played. The formats
-- whose result is the same whoever was on which team are declared in code
-- (`teamDependent: false` in `src/lib/gameTypes.ts`) — stroke play and skins.
-- The database holds its own list (`_recredit_eligible_format`) because the
-- refusal has to live where the write does; `recredit.guard.test.ts` fails the
-- day the two lists disagree (#1332's lesson, applied before the drift starts).
--
-- ── One transaction, or a record that tells people something false ───────
--
-- The new team rows are computed in the app (the same pure function the
-- writers use), and `recredit_games` does everything else in one transaction:
-- checks, the stored roster, the team rows, and the record. The alternative —
-- move the roster, then re-run finalize — can leave a recorded re-credit whose
-- results never moved, which would tell the crew something false.
--
-- The stored roster MUST move with the rows: a re-finalize (a score correction)
-- re-credits through `credited_roster`, so rows changed without it would be put
-- back by the next correction.
--
-- ── Stale previews ────────────────────────────────────────────────────────
--
-- The preview carries a fingerprint of each game's results and stored roster
-- (`_game_credit_fingerprint`), and the person's team as the preview saw it.
-- Confirm refuses if either moved — "review again" — so a preview is never
-- confirmed against a game or roster that has since changed.

-- ── 1 · The record ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.game_recredits (
  id             text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  -- One confirm can re-credit several games; they share a batch.
  batch_id       text NOT NULL,
  game_id        text NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  competition_id text NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
  -- The person whose credit moved.
  user_id        text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  -- NULL = no team. Names are kept as they were: the record is history, and a
  -- team renamed later should not rewrite what the crew was told.
  from_team_id   text,
  from_team_name text,
  to_team_id     text,
  to_team_name   text,
  recredited_by  text REFERENCES public.users(id) ON DELETE SET NULL,
  recredited_at  timestamptz NOT NULL DEFAULT now(),
  -- Per team: place and points in this game, before and after, as the board's
  -- own computation produced them. For anyone investigating; the board shows
  -- only who and when.
  before         jsonb NOT NULL,
  after          jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS game_recredits_game_id_idx ON public.game_recredits (game_id);
CREATE INDEX IF NOT EXISTS game_recredits_competition_id_idx ON public.game_recredits (competition_id);

COMMENT ON TABLE public.game_recredits IS
  'One row per finished game whose credit for one person was moved by the trip Owner (migration 204, PR 8c). Written only by recredit_games. Read by the board for its "Re-credited by" note.';

-- #1440's rule: a table ships its grants in the migration that creates it,
-- rather than leaning on the platform's default ACL. Narrower than that default
-- on purpose: every write goes through `recredit_games` (definer), so a member
-- needs SELECT and nothing else, and `anon` needs nothing. The REVOKE comes
-- first because the default ACL has already granted ALL at CREATE TABLE.
REVOKE ALL ON TABLE public.game_recredits FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.game_recredits TO authenticated;
GRANT ALL ON TABLE public.game_recredits TO service_role;

ALTER TABLE public.game_recredits ENABLE ROW LEVEL SECURITY;

-- Every member of the game's trip: the note on the board is public, and a
-- re-credit is only trustworthy if the crew can see it happened.
DROP POLICY IF EXISTS game_recredits_select ON public.game_recredits;
CREATE POLICY game_recredits_select ON public.game_recredits
  FOR SELECT TO authenticated
  USING (public.is_trip_member((SELECT g.trip_id FROM public.games g WHERE g.id = game_id)));

-- ── 2 · Which formats can be re-credited ──────────────────────────────────

CREATE OR REPLACE FUNCTION public._recredit_eligible_format(p_game_type_id text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO ''
AS $$
  -- Mirrors `teamDependent: false` in src/lib/gameTypes.ts — pinned by
  -- recredit.guard.test.ts. A format missing here is refused (the safe
  -- direction: a team-dependent result is never re-attributed).
  SELECT p_game_type_id IN ('gtt_stroke_play', 'gtt_skins');
$$;

REVOKE ALL ON FUNCTION public._recredit_eligible_format(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._recredit_eligible_format(text) TO service_role;

-- ── 3 · The fingerprint a preview is built on ─────────────────────────────

CREATE OR REPLACE FUNCTION public._game_credit_fingerprint(p_game_id text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  -- Every result row (a score correction moves person rows, a re-credit moves
  -- team rows) plus the stored roster. Ordered by the row's identity, so two
  -- reads of an unchanged game agree; ids are left out because a re-finalize
  -- re-mints them without changing anything.
  SELECT md5(
    coalesce((
      SELECT string_agg(
               r.entity_type || ':' || r.entity_id || ':' ||
               coalesce(r.position::text, '-') || ':' || coalesce(r.raw_score::text, '-'),
               '|' ORDER BY r.entity_type, r.entity_id)
        FROM public.game_results r
       WHERE r.game_id = p_game_id), '')
    || '#' || coalesce((SELECT g.credited_roster::text FROM public.games g WHERE g.id = p_game_id), 'null')
  );
$$;

REVOKE ALL ON FUNCTION public._game_credit_fingerprint(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._game_credit_fingerprint(text) TO service_role;

-- The preview's read of it. Owner-gated INSIDE the body (CLAUDE.md #28): the
-- answer is a fact about a game, so without the gate anyone who could name a
-- game could watch its results move.
CREATE OR REPLACE FUNCTION public.recredit_fingerprints(p_competition_id text)
RETURNS TABLE (game_id text, fingerprint text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_trip_id text;
BEGIN
  SELECT c.trip_id INTO v_trip_id FROM public.competitions c WHERE c.id = p_competition_id;
  IF v_trip_id IS NULL OR NOT public.has_trip_role(v_trip_id, ARRAY['Owner'::text]) THEN
    RAISE EXCEPTION 'RECREDIT_OWNER_ONLY' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
    SELECT g.id, public._game_credit_fingerprint(g.id)
      FROM public.games g
     WHERE g.competition_id = p_competition_id
       AND g.status = 'complete'
       AND public._recredit_eligible_format(g.game_type_id);
END;
$$;

REVOKE ALL ON FUNCTION public.recredit_fingerprints(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recredit_fingerprints(text) TO authenticated, service_role;

-- ── 4 · The re-credit itself ──────────────────────────────────────────────
--
-- p_items: [{ game_id, fingerprint, team_rows, before, after }, ...]
--   team_rows — the game's complete set of TEAM result rows after the move,
--               computed in the app by `computeStrokeTeamStandings`;
--   before / after — what the board's computation said, recorded verbatim.
-- p_expected_team_id — the person's team as the preview saw it (NULL = none).
-- It is also the destination: a re-credit moves credit to the team the person
-- is on NOW, and nowhere else.
--
-- All or nothing: one refused game refuses the batch, and nothing is written.

CREATE OR REPLACE FUNCTION public.recredit_games(
  p_competition_id   text,
  p_user_id          text,
  p_expected_team_id text,
  p_items            jsonb
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_trip_id     text;
  v_team_now    text;
  v_to_name     text;
  v_batch       text := gen_random_uuid()::text;
  v_item        jsonb;
  v_game        record;
  v_from        text;
  v_from_name   text;
  v_row         jsonb;
BEGIN
  SELECT c.trip_id INTO v_trip_id FROM public.competitions c WHERE c.id = p_competition_id;
  IF v_trip_id IS NULL OR NOT public.has_trip_role(v_trip_id, ARRAY['Owner'::text]) THEN
    RAISE EXCEPTION 'RECREDIT_OWNER_ONLY' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'RECREDIT_NO_GAMES' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- The destination is the person's team NOW, and the preview must have seen
  -- the same one. Locked so a roster change cannot land between this check and
  -- the commit.
  --
  -- The two "changed since the preview" refusals use 55000, NOT 40001
  -- (`serialization_failure`), though the latter reads like the right word.
  -- PostgREST treats 40001 as a transient conflict and RETRIES the call, so a
  -- refusal that is deterministic replays until the gateway gives up: the first
  -- local run produced three 504s at 60 seconds instead of one refusal.
  SELECT ta.team_id INTO v_team_now
    FROM public.team_assignments ta
   WHERE ta.competition_id = p_competition_id AND ta.user_id = p_user_id
     FOR UPDATE;
  IF v_team_now IS DISTINCT FROM p_expected_team_id THEN
    RAISE EXCEPTION 'RECREDIT_ROSTER_CHANGED' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF v_team_now IS NOT NULL THEN
    SELECT t.name INTO v_to_name FROM public.teams t WHERE t.id = v_team_now;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT g.id, g.competition_id, g.status, g.corrections_open, g.game_type_id, g.credited_roster
      INTO v_game
      FROM public.games g
     WHERE g.id = v_item ->> 'game_id'
       FOR UPDATE;

    IF NOT FOUND OR v_game.competition_id IS DISTINCT FROM p_competition_id THEN
      RAISE EXCEPTION 'RECREDIT_GAME_NOT_IN_CUP' USING ERRCODE = 'invalid_parameter_value';
    END IF;
    -- Ruling 18: only a result that did not depend on who was on which team.
    IF NOT public._recredit_eligible_format(v_game.game_type_id) THEN
      RAISE EXCEPTION 'RECREDIT_TEAM_DEPENDENT' USING ERRCODE = 'check_violation';
    END IF;
    IF v_game.status <> 'complete' OR v_game.credited_roster IS NULL THEN
      RAISE EXCEPTION 'RECREDIT_NOT_FINISHED' USING ERRCODE = 'check_violation';
    END IF;
    -- A game open for score edits finalizes again soon, and would re-credit
    -- under the owner's feet. Finish the correction first.
    IF v_game.corrections_open THEN
      RAISE EXCEPTION 'RECREDIT_IN_REVIEW' USING ERRCODE = 'check_violation';
    END IF;
    IF public._game_credit_fingerprint(v_game.id) IS DISTINCT FROM (v_item ->> 'fingerprint') THEN
      RAISE EXCEPTION 'RECREDIT_RESULTS_CHANGED' USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;
    -- They have to have a result here: someone who never finished the round
    -- contributed nothing to any team, and a record saying their credit moved
    -- would describe a change that did not happen.
    IF NOT EXISTS (SELECT 1 FROM public.game_results r
                    WHERE r.game_id = v_game.id AND r.entity_type = 'user' AND r.entity_id = p_user_id) THEN
      RAISE EXCEPTION 'RECREDIT_NO_RESULT' USING ERRCODE = 'check_violation';
    END IF;

    v_from := v_game.credited_roster ->> p_user_id;
    IF v_from IS NOT DISTINCT FROM v_team_now THEN
      RAISE EXCEPTION 'RECREDIT_ALREADY_THERE' USING ERRCODE = 'check_violation';
    END IF;

    -- The team rows must be TEAM rows of THIS cup, each crediting itself. The
    -- Owner can already write arbitrary results through write_game_results, so
    -- this is a shape check, not a privilege boundary.
    FOR v_row IN SELECT * FROM jsonb_array_elements(coalesce(v_item -> 'team_rows', '[]'::jsonb)) LOOP
      IF v_row ->> 'entity_type' <> 'team'
         OR v_row ->> 'credited_team_id' IS DISTINCT FROM v_row ->> 'entity_id'
         OR NOT EXISTS (SELECT 1 FROM public.teams t
                         WHERE t.id = v_row ->> 'entity_id' AND t.competition_id = p_competition_id) THEN
        RAISE EXCEPTION 'RECREDIT_BAD_TEAM_ROW' USING ERRCODE = 'invalid_parameter_value';
      END IF;
    END LOOP;

    SELECT t.name INTO v_from_name FROM public.teams t WHERE t.id = v_from;

    -- The stored roster first: it is what every later re-finalize credits
    -- through, so it is the half that makes the re-credit stick.
    UPDATE public.games
       SET credited_roster = CASE
             WHEN v_team_now IS NULL THEN credited_roster - p_user_id
             ELSE credited_roster || jsonb_build_object(p_user_id, v_team_now)
           END
     WHERE id = v_game.id;

    -- Then the team rows, replaced as a set (person rows are untouched — a
    -- person's own finish does not depend on their team).
    PERFORM public._write_game_results(
      v_game.id, coalesce(v_item -> 'team_rows', '[]'::jsonb), 'entity_type', NULL, 'team', '[]'::jsonb
    );

    INSERT INTO public.game_recredits
      (batch_id, game_id, competition_id, user_id, from_team_id, from_team_name,
       to_team_id, to_team_name, recredited_by, before, after)
    VALUES
      (v_batch, v_game.id, p_competition_id, p_user_id, v_from, v_from_name,
       v_team_now, v_to_name, auth.uid()::text,
       coalesce(v_item -> 'before', '{}'::jsonb), coalesce(v_item -> 'after', '{}'::jsonb));
  END LOOP;

  RETURN v_batch;
END;
$$;

REVOKE ALL ON FUNCTION public.recredit_games(text, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recredit_games(text, text, text, jsonb) TO authenticated, service_role;

-- ── 5 · A reset clears its re-credits (verbatim from 203 plus one DELETE) ───

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

  -- 204: a reset game is replayed and credited afresh at its next finalize,
  -- so a re-credit of the old result no longer describes anything on the
  -- board. Its "Re-credited by" note would be a false statement.
  DELETE FROM public.game_recredits      WHERE game_id = p_game_id;

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

-- ── 6 · The guest merge re-keys them (verbatim from 203 plus two UPDATEs) ───
-- CLAUDE.md: a person-referencing table is added to the merge in the SAME
-- migration, or the merge cascade-deletes the guest's rows.

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

  -- Re-credits — NEW (migration 204). Both person columns: the person whose
  -- credit moved, and the Owner who moved it. No collision handling, checked
  -- rather than assumed: the table's only UNIQUE key is its `id`.
  UPDATE public.game_recredits SET user_id       = p_real_id WHERE user_id       = p_ghost_id;
  UPDATE public.game_recredits SET recredited_by = p_real_id WHERE recredited_by = p_ghost_id;

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
