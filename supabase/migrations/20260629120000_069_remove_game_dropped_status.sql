-- 069 — Remove the game `dropped` (abandon) status at the source (#512 §6a).
--
-- BACKGROUND: the `dropped` status backed an "Abandon game" capability that was
-- never requested — Claude Code introduced it on its own and it self-perpetuated:
-- the writable status value kept re-justifying a danger-zone button, so removing
-- the button alone never stuck. This migration kills the CONCEPT in the data model
-- so it cannot regenerate. Do NOT re-add a drop/abandon/archive-game status.
--
-- The app-layer removal (the Abandon/Restore UI, the `dropped` value in the
-- games.setStatus Zod enum, and the leaderboard read-filters / `dropped` payload
-- field) ships in the same change. This file is the DB half:
--
--   1. Delete any existing `dropped` games. (Zach confirmed there is no
--      "abandoned-but-kept" state to preserve — see the spec.) Two such games
--      existed in BBMI 2026 at authoring time; they are removed here, their child
--      rows cascading via ON DELETE CASCADE. Idempotent: a no-op if none remain.
--   2. Tighten games_status_check to the three live lifecycle states. This is why
--      step 1 must run first — the constraint cannot be added while a `dropped`
--      row exists.
--   3. Recreate the two per-game reset CORES (migration 066) WITHOUT their
--      now-dead `status <> 'dropped'` guard. With `dropped` unrepresentable, the
--      guard is provably moot; dropping it removes the last in-DB reference to the
--      concept. Behavior-preserving (no row can satisfy `status = 'dropped'`).

-- ── 1. Remove existing dropped games (children cascade) ──────────────────────
DELETE FROM public.games WHERE status = 'dropped';

-- ── 2. Tighten the status CHECK constraint ───────────────────────────────────
ALTER TABLE public.games DROP CONSTRAINT IF EXISTS games_status_check;
ALTER TABLE public.games ADD CONSTRAINT games_status_check
  CHECK (status = ANY (ARRAY['pending'::text, 'active'::text, 'complete'::text]));

-- ── 3. Reset cores without the dead `<> 'dropped'` guard ─────────────────────
-- Bodies are migration 066's verbatim, minus `AND status <> 'dropped'` on the
-- games-row UPDATEs. The DELETEs were already unconditional by game_id; the §E-1
-- per-match point-value CASE is unchanged.
CREATE OR REPLACE FUNCTION public._reset_game_scoring(p_game_id text)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
AS $$
BEGIN
  -- Results + raw scores (all game types that score).
  DELETE FROM public.game_results WHERE game_id = p_game_id;
  DELETE FROM public.score_entries WHERE game_id = p_game_id;

  -- Match-play RESULT columns only — keep the pairings (side_a/side_b). No-op for
  -- non-match types (no game_matches rows).
  UPDATE public.game_matches
    SET result = NULL, margin = NULL, status = 'pending'
    WHERE game_id = p_game_id;

  -- Unscored lifecycle: active/complete → pending, corrections closed.
  -- scoring_enabled KEPT (re-scoreable).
  UPDATE public.games
    SET status = 'pending', corrections_open = false
    WHERE id = p_game_id;
END;
$$;

CREATE OR REPLACE FUNCTION public._reset_game_to_skeleton(p_game_id text)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
AS $$
BEGIN
  -- Built ON the scoring core — NOT reimplemented (results can't outlive config).
  PERFORM public._reset_game_scoring(p_game_id);

  -- Config rows: pairings, roster, foursomes/pairs. (game_matches results were
  -- already nulled above; here the rows go entirely.) Unconditional by game_id.
  DELETE FROM public.game_matches WHERE game_id = p_game_id;
  DELETE FROM public.game_participants WHERE game_id = p_game_id;
  DELETE FROM public.play_groups WHERE game_id = p_game_id;

  -- Per-game config columns. Point VALUE survives (identity): for placement games
  -- clear only the SPLIT (points_distribution → NULL, keep points_total); a
  -- per-match distribution holds the value itself, so it is kept untouched.
  UPDATE public.games
    SET course_id = NULL,
        scorecard_schema = NULL,
        modifiers = '{}'::jsonb,
        rules_for_today = NULL,
        competition_format = NULL,
        pairings_published_at = NULL,
        scoring_enabled = false,
        points_distribution = CASE
          WHEN points_distribution->>'type' = 'placement' THEN NULL
          ELSE points_distribution
        END
    WHERE id = p_game_id;
END;
$$;
