-- Phase 2B.1: per-game "scoring enabled" — the single authoritative flag for
-- whether a game is open for scoring, for EVERY format. It replaces Phase 3's
-- derived `iconArmed` stub (`lifecycle !== "setting-up"`) with a real state.
--
-- Distinct concepts (do NOT conflate):
--   * competition reveal  = competitions.status (member visibility of the cup)
--   * scoring enabled      = THIS flag (per-game, all formats)
--   * Live                 = games.status='active', set on the FIRST score (#396)
--
-- Match play previously coupled "publish pairings" with status='active' in
-- matches.activate, so "enabled but not yet Live" couldn't exist. 2B.1 splits
-- that: Enable sets THIS flag (+ keeps publishing pairings) but NOT status; the
-- first score still owns the flip to Live. So enabled-ness lives in this one
-- boolean for every format — never in pairings_published_at for match while the
-- boolean covers stroke/rack (the overloaded-field trap, cf. per_match).

ALTER TABLE public.games
  ADD COLUMN IF NOT EXISTS scoring_enabled boolean NOT NULL DEFAULT false;

-- Backfill so existing live games don't regress to Setting-up / `—`: a game that
-- has been run (active or complete), has any score, or (match play) published its
-- pairings is already enabled. Idempotent — only ever sets true, derived from
-- immutable columns, guarded on the current value, so CI re-applying this file is
-- a no-op.
UPDATE public.games g
SET scoring_enabled = true
WHERE g.scoring_enabled = false
  AND (
    g.status IN ('active', 'complete')
    OR g.pairings_published_at IS NOT NULL
    OR EXISTS (SELECT 1 FROM public.score_entries s WHERE s.game_id = g.id)
  );
