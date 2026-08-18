-- 126 — A score reset moves the go-live triple TOGETHER (#895, CLAUDE.md #25).
--
-- Builds on 125, which defined reset by target state. 125 deliberately left this alone
-- and said so; this is the follow-up it named.
--
-- ── The bug ─────────────────────────────────────────────────────────────────
-- `_reset_game_scoring` set `status = 'pending'` while leaving `scoring_enabled` and
-- `pairings_published_at` untouched. Those three columns are one fact in three places
-- (CLAUDE.md #25) and nothing in the type system says so. Going live sets all three in
-- ONE update — `{scoring_enabled: true, status: 'active', pairings_published_at: now}`
-- (games.ts / matches.ts) — and coming out of live clears all three.
--
-- So a scores reset on a live or completed game left `status='pending'` beside
-- `scoring_enabled=true`, and the two readers a few lines apart in
-- `matches.listByGame` disagree about what that means: the ACCESS GATE keys on
-- `status === 'pending'` and hides the matches, while the `published` flag keys on
-- `pairings_published_at` and says they are announced. Members got an empty match list
-- on a game that still looked live to staff. Nobody got an error.
--
-- ── Which way to reconcile, argued from 125's model rather than from taste ───
-- Level 1 returns a game to READY: fully configured, nothing played. A ready game is
-- one that has been switched on — enabled, pairings announced. So `scoring_enabled` and
-- `pairings_published_at` are correct to survive, and `status` was the outlier. That is
-- issue #895's third option, and 125's target-state definition is what settles it: the
-- question "does a game that is ready-and-unplayed have this value?" answers yes, yes,
-- and 'active'.
--
-- `status` therefore FOLLOWS the other two rather than being forced flat:
--   scoring_enabled → 'active'   (switched on, nothing played = exactly Ready)
--   not enabled     → 'pending'  (never switched on)
-- which is the same pairing go-live writes, so the triple cannot come apart here.
--
-- ── Level 2 must now say it itself ──────────────────────────────────────────
-- `_reset_game_to_skeleton` relied on level 1 forcing 'pending'. With level 1 no longer
-- doing that, level 2 sets all three in its own single UPDATE — which is what #25 asks
-- for anyway, and removes an invisible dependency on a sibling function's side effect.
-- Without this, a skeleton reset would leave `status='active'` beside
-- `scoring_enabled=false`: the same bug, pointing the other way. (125's equivalence test
-- catches exactly that — a newly added game is 'pending' — which is the check working.)
--
-- ── Scope ───────────────────────────────────────────────────────────────────
-- `reset_competition_scoring` needs no change: its deployed body is `assert_competition
-- _owner` then a loop of `PERFORM _reset_game_scoring`, with no status handling of its
-- own — verified against `pg_get_functiondef`, not assumed. Fixing the inner function
-- fixes the competition-wide path too, which matters more than the per-game one: one
-- Owner action put EVERY game in the competition into the split state at once.
--
-- No production game is currently split (all 23 sit in three internally-coherent
-- groups), so this ships with nothing to repair — and nothing live to verify against
-- either, which is why the accompanying test manufactures the state rather than
-- looking for one.

CREATE OR REPLACE FUNCTION public._reset_game_scoring(p_game_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  -- Everything PLAYED, in every shape it is stored in (125).
  DELETE FROM public.game_results        WHERE game_id = p_game_id;
  DELETE FROM public.score_entries       WHERE game_id = p_game_id;
  DELETE FROM public.match_hole_outcomes WHERE game_id = p_game_id;

  UPDATE public.game_matches
     SET result = NULL, margin = NULL, status = 'pending'
   WHERE game_id = p_game_id;

  UPDATE public.bracket_matches
     SET winner_entrant_id = NULL
   WHERE game_id = p_game_id;

  -- The go-live triple, kept consistent (#895 / #25). `status` follows the switch
  -- rather than being forced to 'pending' beside an enabled game.
  UPDATE public.games
     SET corrections_open = false,
         status = CASE WHEN scoring_enabled THEN 'active' ELSE 'pending' END
   WHERE id = p_game_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public._reset_game_to_skeleton(p_game_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  PERFORM public._reset_game_scoring(p_game_id);

  DELETE FROM public.game_matches      WHERE game_id = p_game_id;
  DELETE FROM public.game_participants WHERE game_id = p_game_id;
  DELETE FROM public.play_groups       WHERE game_id = p_game_id;
  DELETE FROM public.game_delegates    WHERE game_id = p_game_id;
  DELETE FROM public.bracket_matches   WHERE game_id = p_game_id;
  DELETE FROM public.bracket_entrants  WHERE game_id = p_game_id;

  UPDATE public.games
     SET course_id             = NULL,
         back_course_id        = NULL,
         scorecard_schema      = NULL,
         config                = '{}'::jsonb,
         modifiers             = '{}'::jsonb,
         bracket_config        = '{}'::jsonb,
         rules_for_today       = NULL,
         competition_format    = NULL,
         tee_time              = NULL,
         points_total          = COALESCE(
           points_total,
           CASE WHEN points_distribution->>'type' = 'per_match'
                THEN (points_distribution->>'value')::numeric END
         ),
         points_distribution   = NULL,
         -- The go-live triple, all three in ONE statement (#25). `status` is set HERE
         -- now rather than inherited from level 1, which no longer forces 'pending'.
         status                = 'pending',
         scoring_enabled       = false,
         pairings_published_at = NULL,
         entry_mode            = 'score'
   WHERE id = p_game_id;
END;
$function$;
