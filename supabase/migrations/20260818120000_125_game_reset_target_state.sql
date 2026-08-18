-- 125 — Game reset, defined by TARGET STATE rather than by column classification.
--
-- Revises 066 (`_reset_game_scoring` / `_reset_game_to_skeleton`). 066 classified each
-- column as "config" or "scoring" and cleared accordingly. That model is why five
-- columns drifted out of scope without anyone noticing: `config`, `tee_time`,
-- `back_course_id`, `entry_mode` and `bracket_config` are all in `GAME_CONFIG_COLS`
-- (the config hash's own, CI-guarded definition of a game's configuration) and none of
-- them were cleared. Classification requires remembering to re-classify; nobody does,
-- and nothing failed when they didn't.
--
-- The replacement question is answerable without judgment, and self-maintains:
--
--     LEVEL 1  (clear scores)    -> the game as it was when READY: fully configured,
--                                  nothing played.
--     LEVEL 2  (clear settings)  -> the game as it was when NEW: exactly what you get
--                                  the moment you add it.
--
-- So the test for any column is "does a freshly added game have a value here?" — which
-- a column added next year answers the same way, without this file being edited.
--
-- Level 2 is still built ON level 1, as 066 had it. That composition is deliberate and
-- worth keeping: one definition of "nothing played", reused, so a result can never
-- outlive the config that produced it.
--
-- WHAT CHANGES, and why each is a change rather than a preference:
--
--  L1  match_hole_outcomes are now DELETED. They were cleared by neither reset — they
--      only cascade via `game_matches`, which level 1 does not delete. This is not
--      cosmetic: for `entry_mode = 'outcome'` these rows ARE the score (see
--      `computeMatchPlayResults` — outcome mode reads them directly, with no gross, no
--      handicaps, no stroke index). Production carries exactly that case today — a
--      completed match with 18 outcomes and 0 score_entries — where "clear scores"
--      removed nothing that constituted the score, and the next compute rebuilt the
--      identical result from the surviving rows.
--
--  L1  bracket_matches.winner_entrant_id is now NULLED. A pick is the bracket's score;
--      the config hash already classifies it that way, alongside game_matches
--      result/margin/status. Nothing played may survive level 1, and every pick did.
--      Safe to null in isolation: a pick writes ONLY this column (advancement is derived
--      at read time, never persisted into entrant_a_id/entrant_b_id), so clearing it
--      cannot strand a half-advanced draw.
--
--  L2  game_delegates are now deleted. A delegate is a grant scoped to a game's setup;
--      the grant outliving the setup is what made it a bug.
--
--  L2  The bracket is now cleared — bracket_entrants (which cascades
--      bracket_entrant_members and bracket_matches) plus an explicit bracket_matches
--      delete. Previously `competition_format` was nulled while the whole pool and draw
--      survived, leaving a formatless game with a full bracket attached. 6 of 23
--      production games carry a non-empty bracket_config.
--
--  L2  points_distribution now clears on EVERY format. 066 cleared it only for
--      `type = 'placement'`, reasoning that a per-match split carries the point VALUE
--      and value is identity. Under the target-state definition that doesn't survive: a
--      freshly added game has no distribution at all. The value itself is preserved
--      where it actually lives, `points_total`.
--
--  L2  The five drifted config columns are cleared: config, tee_time, back_course_id,
--      entry_mode, bracket_config. `back_course_id` is the plainest failure of the old
--      model — a two-course game kept half its course through "clears the setup".
--
-- WHAT SURVIVES LEVEL 2, and why (a bare list invites re-litigation):
--
--   IDENTITY — the fields you supply when adding a game, which is precisely why they
--   survive a reset to "as newly added": name, points_total, game_type_id,
--   display_order, scheduled_at, schedule_item_id. Plus structural id / trip_id /
--   competition_id / created_at.
--
--   AUDIT — push_send_log. Kept as a PREFERENCE, not a constraint, and the distinction
--   is load-bearing: nothing reads it. One plain INSERT with no ON CONFLICT, a primary
--   key on `id` only (no unique key that could dedupe), and no SQL function references
--   it. So clearing it would lose history, NOT cause a duplicate push to 16 people. If a
--   reader is ever added for idempotency, this comment is wrong and keeping the rows
--   becomes mandatory rather than preferred.
--
-- NOT fixed here, deliberately: `_reset_game_scoring` moves `status` without
-- `scoring_enabled` / `pairings_published_at` (CLAUDE.md #25). That is issue #895 and a
-- separate change. Worth noting it is not an oversight in THIS model — a level-1 game is
-- Ready, so scoring_enabled and pairings_published_at SHOULD survive; `status` is the
-- outlier, which is exactly what #895 says.
--
-- The Owner-only wrappers over revoked cores (066/101) are unchanged.

CREATE OR REPLACE FUNCTION public._reset_game_scoring(p_game_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  -- Everything PLAYED, in every shape it is stored in.
  DELETE FROM public.game_results        WHERE game_id = p_game_id;
  DELETE FROM public.score_entries       WHERE game_id = p_game_id;
  -- The score itself in outcome-entry mode, and unreachable by cascade at this level.
  DELETE FROM public.match_hole_outcomes WHERE game_id = p_game_id;

  -- Match-play RESULT columns only — the pairings (side_a/side_b) are config and stay.
  UPDATE public.game_matches
     SET result = NULL, margin = NULL, status = 'pending'
   WHERE game_id = p_game_id;

  -- The bracket's score. The draw itself (rounds, slots, seeding) is config and stays.
  UPDATE public.bracket_matches
     SET winner_entrant_id = NULL
   WHERE game_id = p_game_id;

  -- Unscored lifecycle. scoring_enabled / pairings_published_at KEPT: a level-1 game is
  -- READY, and a ready game is still enabled with its pairings still announced.
  UPDATE public.games
     SET status = 'pending', corrections_open = false
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
  -- Built ON level 1 — one definition of "nothing played", reused.
  PERFORM public._reset_game_scoring(p_game_id);

  -- Config ROWS. bracket_entrants cascades bracket_entrant_members (which has no
  -- game_id of its own and is reachable only this way) and bracket_matches; the latter
  -- is deleted explicitly too, so the intent survives a future FK change.
  DELETE FROM public.game_matches      WHERE game_id = p_game_id;
  DELETE FROM public.game_participants WHERE game_id = p_game_id;
  DELETE FROM public.play_groups       WHERE game_id = p_game_id;
  DELETE FROM public.game_delegates    WHERE game_id = p_game_id;
  DELETE FROM public.bracket_matches   WHERE game_id = p_game_id;
  DELETE FROM public.bracket_entrants  WHERE game_id = p_game_id;

  -- Config COLUMNS -> exactly their newly-added values (the table defaults).
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
         points_distribution   = NULL,
         pairings_published_at = NULL,
         scoring_enabled       = false,
         entry_mode            = 'score'
   WHERE id = p_game_id;
END;
$function$;
