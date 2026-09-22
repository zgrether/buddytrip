-- ════════════════════════════════════════════════════════════════════════════
-- 191 · game_results declares what it carries and who it pays (#826)
--
-- Two additive columns on `game_results`, plus the backfill, plus the one
-- writer that is an RPC. No behaviour changes here: the READS move in the same
-- PR's TypeScript, and only for the bracket.
--
-- ── WHY: a finished result has two facts nothing records ────────────────────
--
-- 1 · WHAT THE VALUE IS. A row carries either a RANK (`position`, low wins) or
--     POINTS already decided (`raw_score`, high wins), and the table says which
--     only by which column is null — an inference (`rowConvention`) that the
--     board re-derives on every read. Worse, `writeManualResults` MIRRORS
--     `position` into `raw_score`, so most rows have both populated and the
--     inference survives only because it keys on `position` alone.
--     `gameFinishNotify` makes the same guess a second, different way
--     (`position != null AND raw_score = position ? null : raw_score`) — one
--     question, two derivations, which is how #1245 and #1381 each shipped.
--
-- 2 · WHO THE VALUE PAYS. For every format but one, the row IS the credit: its
--     `entity_id` is the cup team. A BRACKET's rows name an ENTRANT, and the
--     entrant→team map lives in `bracket_entrants.team_id`, read at BOARD time.
--     Measured on production 2026-09-22: all three bracket games carry entrant
--     rows and ZERO team rows, so the bracket is the one format that does not
--     record its credited unit at finalize.
--
--     That column is not currently movable after a finalize — `save_game_config`
--     is its only writer and `v_bracket_dirty` includes `team_id`, so HAS_PICKS
--     refuses the change once any winner exists. But that guard exists to
--     protect the DRAW; freezing the credit is a side effect of it, not a
--     decision. This records the credit where the result is, so the board stops
--     depending on a guard that is about something else.
--
-- ── WHY A SNAPSHOT, IN A CODEBASE THAT DERIVES ─────────────────────────────
--
-- This is the deliberate exception to derive-don't-snapshot, and the reason is
-- that the two questions are not the same question. "Which team is Alice on?"
-- is a fact about NOW and must derive. "Which team did this game pay?" is a
-- fact about THEN, and re-deriving it from today's roster answers a different
-- question with the same words. A finished game's credit cannot be re-derived
-- because the inputs no longer exist in the state they had.
--
-- ── value_kind IS NOT NULL, AND THAT INVERTS THE DEPLOY ORDER ──────────────
--
-- Added nullable, backfilled, then SET NOT NULL — all three in this migration,
-- so the column can never be silently skipped by a writer.
--
-- The reason it is worth the cost: THIS TABLE HAS TWO WRITERS AND EACH ONE'S
-- DOC COMMENT CALLS ITSELF THE ONLY ONE. `writeGameResults` says "the ONE write
-- path for `game_results` (#776)"; `writeManualResults` says "the ONE write path
-- for placements". Neither is wrong about its own half and neither knows about
-- the other — and `entrant` is not even in `GameResultRow`'s TypeScript union,
-- so the type system cannot see the second writer at all. A third writer, or a
-- forgotten branch inside one of these two, is a live risk rather than a
-- hypothetical. **A NOT NULL column cannot go inert the way a test can**: there
-- is no build in which it is present and not checked.
--
-- No DEFAULT, for the same reason there is no default anywhere near this
-- column: a default would INVENT a convention for a row whose writer never
-- stated one, which is precisely the failure the column exists to end. An
-- omission has to fail loudly at the INSERT, naming the writer that forgot.
--
-- ── THE ORDERING CONSEQUENCE, STATED BECAUSE IT REVERSES THE STANDING RULE ──
--
-- Migration Workflow step 3 says a migration lands and is pushed to prod BEFORE
-- the code that depends on it. NOT NULL flips the dependency: it is the SCHEMA
-- that depends on the CODE here, because only the new build supplies a value.
-- Push 191 to prod ahead of the deploy and every finalize fails until the
-- deploy lands — the same shape step 3b describes for a `DROP COLUMN`, arriving
-- for the same reason.
--
-- **So 191 is pushed at deploy time, not before it.** `credited_team_id` stays
-- nullable and therefore has no such constraint; it is only `value_kind` that
-- couples the two.
--
-- ── NO FOREIGN KEY ON credited_team_id, ON PURPOSE ─────────────────────────
--
-- `teams.delete` is reachable after a manual (non-golf) game has been finalized
-- — the roster lock it runs behind keys on `score_entries`, which those formats
-- never write (`teams.ts:196` says so in its own comment). An FK with ON DELETE
-- SET NULL would then erase the record of who was paid; RESTRICT would turn a
-- permitted product action into an error. A dangling id is the honest record of
-- a team that was paid and later deleted. `entity_id` has never had an FK
-- either — it is polymorphic — so this is consistent rather than novel.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1 · The columns ─────────────────────────────────────────────────────────

ALTER TABLE public.game_results
  ADD COLUMN IF NOT EXISTS value_kind text;

ALTER TABLE public.game_results
  ADD COLUMN IF NOT EXISTS credited_team_id text;

COMMENT ON COLUMN public.game_results.value_kind IS
  'What this row''s value IS: ''rank'' (read `position`, low wins) or ''points'' '
  '(read `raw_score`, high wins). Declared by the writer at finalize, NOT NULL, '
  'no default. Replaces inferring it from which column is null — see #826 and '
  'migration 191''s header.';

COMMENT ON COLUMN public.game_results.credited_team_id IS
  'The cup team this row''s value is credited to, AS AT FINALIZE. For an '
  '`entity_type = ''team''` row this equals `entity_id` — deliberately '
  'redundant, so "who gets these points" is one column for every format. For an '
  '`entrant` row it is the snapshot of `bracket_entrants.team_id`, and NULL '
  'legitimately means an entrant on no cup team. For `user` / `play_group` rows '
  'it is always NULL: those are side-level records, not cup credits.';

-- ── 2 · Backfill ────────────────────────────────────────────────────────────
--
-- Derivable and safe, and that was CHECKED rather than assumed. Queried against
-- production 2026-09-22: of the 46 games carrying team rows, 29 are uniformly
-- positions and 17 uniformly points. NOT ONE is mixed, so no game's rows
-- disagree with each other about what they carry.
--
-- Per ROW, not per game, because that is what the column means. A game whose
-- rows genuinely disagree records that disagreement instead of being averaged
-- into a single wrong answer — and the reconciler in `competitionLeaderboard`
-- is what reports it.
--
-- `position IS NOT NULL` is exactly `rowConvention`'s test, unchanged. It reads
-- `position` alone on purpose: most rows carry BOTH columns because
-- `writeManualResults` mirrors the rank into `raw_score`, so a test involving
-- `raw_score` would classify every manual placement as points.

UPDATE public.game_results
   SET value_kind = CASE WHEN position IS NOT NULL THEN 'rank' ELSE 'points' END
 WHERE value_kind IS NULL;

-- A team row's credit is itself.
UPDATE public.game_results
   SET credited_team_id = entity_id
 WHERE entity_type = 'team'
   AND credited_team_id IS NULL;

-- An entrant row's credit is the entrant's team, taken from the same column the
-- board reads today — so this backfill is provably a no-op on what the board
-- currently shows. An entrant with no team stays NULL, which is the state
-- `teamPointsFromEntrants` already skips.
UPDATE public.game_results r
   SET credited_team_id = e.team_id
  FROM public.bracket_entrants e
 WHERE e.id = r.entity_id
   AND r.entity_type = 'entrant'
   AND r.credited_team_id IS NULL;

-- `user` and `play_group` rows are deliberately left NULL. They are one side's
-- own record, not a cup credit, and inventing a team for them would make the
-- column mean two different things.

-- ── 2b · Now it can be required ─────────────────────────────────────────────
--
-- Order matters and is the whole point: nullable ADD, backfill, then the
-- constraint. Reversed, the ADD fails on any non-empty table. On a fresh replay
-- the table is empty and the backfill is a no-op, which is why this replays
-- from zero unchanged.

ALTER TABLE public.game_results
  ALTER COLUMN value_kind SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'game_results_value_kind_check'
       AND conrelid = 'public.game_results'::regclass
  ) THEN
    ALTER TABLE public.game_results
      ADD CONSTRAINT game_results_value_kind_check
      CHECK (value_kind IN ('rank', 'points'));
  END IF;
END $$;

-- ── 3 · The RPC writer learns the two columns ───────────────────────────────
--
-- `_write_game_results` (migration 100) names its columns explicitly in a
-- `jsonb_to_recordset`, so a new column is invisible to it until it is listed.
-- Replaced verbatim from 100 with the two columns added in both places.
--
-- The OTHER writer is `writeManualResults` in `games.ts` — a plain
-- delete-and-insert, not this RPC, and the path every bracket and manual
-- placement takes. Both files call themselves the one write path for this
-- table; reconciling them is not this migration's job, but a column added to
-- one and not the other would be silently absent from exactly the format this
-- work is about.

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
