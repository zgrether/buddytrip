-- 175 — removing a contest from a locked pick'em slate is refused, not absorbed.
--
-- ══ What 174 left open (#1208) ═════════════════════════════════════════════
--
-- 174 split the slate's id-set change in two: an ADD keeps every ranking, a
-- REMOVE still clears them. The reasoning holds — after a removal a surviving
-- rank can outrange the new N, which is genuinely invalid (166:130-159).
--
-- But it narrowed the DESTRUCTION without stopping it. The removal itself
-- stayed permitted, so on a locked game dropping one contest still nulled every
-- ranking on every sheet, silently, and nobody could put them back:
-- `pickem_picks_write` gates on `pickem_picks_open` (146:397), the proxy path
-- gates on it too (163:190), and 165:97 refuses a reopen once results exist.
--
-- The case that made this worth its own migration is the ORDINARY one, not an
-- edge: picks locked, nothing judged yet, and the runner deletes the game that
-- got postponed. 174's clear fires on any id leaving the set regardless of
-- results, so that removal wiped everything.
--
-- ══ The rule ═══════════════════════════════════════════════════════════════
--
-- A contest cannot LEAVE the slate when either is true:
--
--   (a) the game uses confidence AND ranks are stored — they cannot be
--       rebuilt, because picks are closed by the time this code runs
--   (b) the contest being removed carries a recorded result — dropping it
--       silently discards an outcome somebody entered
--
-- Independent conditions, and (b) is not implied by (a): with confidence off
-- there is no ranking to protect and a judged contest can still be thrown away.
--
-- Adding, reordering, re-pricing and editing a contest in place are all
-- untouched and stay free. This constrains one verb.
--
-- ══ Why (a) tests `use_confidence` ═════════════════════════════════════════
--
-- Turning confidence OFF does not null the ranks already stored — the settings
-- arm of this function writes `pickem_games` and nothing else. Without that
-- term, a game that once used confidence would refuse removals forever to
-- protect numbers that no longer score anything.
--
-- ══ The exit, and why the message can name it ══════════════════════════════
--
-- Clear the results, then reopen picking. Both are reachable and in that order:
-- 165 refuses `unlock` while `_pickem_has_results` is true, and clearing a slate
-- result is itself ungated below a finalize (`set_pickem_result` accepts NULL
-- and only refuses on `status = 'complete' AND NOT corrections_open`, 167).
-- Once picks reopen, people re-rank and the slate is editable again.
--
-- Stated because the refusal rule this repo keeps relearning is that a message
-- must name an action the reader can actually take (164 and 162 both failed it).
--
-- ══ 174's confidence clear stays, and it is still REACHABLE ═══════════════
--
-- The obvious reading is that (a) makes it dead: refuse every removal that
-- would clear something, and the clear can never fire. That reading is wrong,
-- and the case it misses is the one (a) was narrowed for.
--
-- With confidence OFF and stale ranks in the table — reachable, because turning
-- the setting off does not null them — (a) does not fire, the removal is
-- ALLOWED, and the clear runs and nulls exactly those stale ranks. Which is the
-- right outcome: they index a slate that no longer exists and nothing scores
-- them.
--
-- So it is live logic on that path and a backstop on every other. Written down
-- because "the guard makes the old clear dead" is the plausible-sounding
-- conclusion, and it was believed here until a test of the confidence-off path
-- disagreed.
--
-- ══ Scope ═════════════════════════════════════════════════════════════════
--
-- Function body only. No schema change and no backfill: rankings already lost
-- to this are not recoverable, because which rank belonged to which contest was
-- never stored anywhere else. This stops the next one.

CREATE OR REPLACE FUNCTION public.save_pickem_config(p_game_id text, p_payload jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_keep text[];
  v_prior text[];
  v_item jsonb;
  v_idx integer := 0;
  v_multiplier numeric;
BEGIN
  PERFORM public.assert_game_edit(p_game_id);

  -- Frozen only while picks are OPEN — people are filling in sheets against
  -- this slate right now, and moving it under them is the thing worth
  -- refusing. 148 gated on `picks_opened_at IS NOT NULL`, which froze the slate
  -- from the first open FOREVER, and that is the entire reason `reopen` had to
  -- exist: nulling that column was the only way back.
  -- TWO boundaries now, because they guard two different things (migration 157).
  --
  -- The SLATE freezes while picks are OPEN: people are choosing against those
  -- games right now, and adding or removing one invalidates every ranking.
  --
  -- The SETTINGS freeze at the first RESULT, which is later and sometimes much
  -- later. Until something is scored, changing how scoring works rewrites
  -- nothing. They used to share the slate's boundary, which is what forced
  -- `points_total` into a function of its own (152) and left the settings page
  -- unable to commit atomically.
  IF (p_payload ? 'slate') AND public._pickem_picks_open_state(p_game_id) THEN
    RAISE EXCEPTION 'SLATE_LOCKED: picks are open, so the slate is frozen. Lock picks first — nobody loses anything unless the slate itself changes.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF (p_payload ? 'settings') AND public._pickem_has_results(p_game_id) THEN
    RAISE EXCEPTION 'PICKEM_SCORED: results are in, so how this game scores is frozen'
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.pickem_games (game_id) VALUES (p_game_id)
  ON CONFLICT (game_id) DO NOTHING;

  IF p_payload ? 'settings' THEN
    UPDATE public.pickem_games
       SET roll_up = COALESCE(p_payload -> 'settings' ->> 'rollUp', roll_up),
           use_confidence = COALESCE((p_payload -> 'settings' ->> 'useConfidence')::boolean, use_confidence)
     WHERE game_id = p_game_id;
  END IF;

  IF p_payload ? 'slate' THEN
    -- The id set BEFORE this write, for the ranking-invalidation test below.
    SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::text[])
      INTO v_prior
      FROM public.pickem_slate_games
     WHERE game_id = p_game_id;

    -- UPSERT, never clean-replace — see 148's header. Survivors keep their ids,
    -- so they keep their picks.
    SELECT COALESCE(array_agg(elem ->> 'id' ORDER BY elem ->> 'id'), ARRAY[]::text[])
      INTO v_keep
      FROM jsonb_array_elements(p_payload -> 'slate') AS elem;

    -- ── THE REMOVAL GUARD (migration 175, #1208) ──────────────────────────
    --
    -- 174 made an ADD free and kept the clear for REMOVALS, on the grounds that
    -- a rank outranging the new N is genuinely invalid. True — but it left the
    -- removal itself permitted, so the destruction was narrowed rather than
    -- stopped: post-lock, dropping a contest still nulled every ranking with no
    -- refusal, and `pickem_picks_write` gates on `pickem_picks_open` so nobody
    -- could put them back (146:397, and the proxy path at 163:190).
    --
    -- Picks being OPEN is impossible here: the SLATE_LOCKED guard at the top of
    -- this function has already raised for that case. Deliberately NOT restated
    -- as a condition -- two predicates that must always agree is how they drift
    -- (CLAUDE.md #24). If that guard is ever narrowed this one over-refuses,
    -- which is the safe direction to fail in.
    IF EXISTS (SELECT unnest(v_prior) EXCEPT SELECT unnest(v_keep)) THEN

      -- (a) Rankings exist and cannot be rebuilt.
      --
      -- Gated on `use_confidence` because turning confidence OFF does not null
      -- the ranks already stored -- the settings arm above writes only
      -- `pickem_games`. Without this term a game that once used confidence
      -- would refuse removals forever, to protect numbers that no longer score.
      IF EXISTS (
           SELECT 1 FROM public.pickem_games
            WHERE game_id = p_game_id AND use_confidence
         )
         AND EXISTS (
           SELECT 1 FROM public.pickem_picks
            WHERE game_id = p_game_id AND confidence IS NOT NULL
         ) THEN
        RAISE EXCEPTION 'SLATE_RANKED: the slate is locked while rankings exist and picks are closed'
          USING ERRCODE = 'check_violation';
      END IF;

      -- (b) A contest being removed carries a recorded outcome.
      --
      -- Independent of (a): with confidence OFF there is no ranking to lose,
      -- but dropping a judged contest still discards a result somebody entered,
      -- and it does so silently. Scoped to the contests actually LEAVING -- a
      -- result on a survivor is none of this guard's business.
      IF EXISTS (
           SELECT 1 FROM public.pickem_slate_games s
            WHERE s.game_id = p_game_id
              AND s.result IS NOT NULL
              AND NOT (s.id = ANY (v_keep))
         ) THEN
        RAISE EXCEPTION 'SLATE_CONTEST_SCORED: that contest has a result recorded'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;

    DELETE FROM public.pickem_slate_games
     WHERE game_id = p_game_id
       AND NOT (id = ANY (v_keep));

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_payload -> 'slate')
    LOOP
      -- Default 1 rather than NULL: spec §2.3 — setting nothing must produce a
      -- normal game, and scoring must never branch on whether a multiplier was
      -- supplied.
      v_multiplier := COALESCE((v_item ->> 'multiplier')::numeric, 1);
      IF v_multiplier <= 0 THEN
        RAISE EXCEPTION 'BAD_MULTIPLIER: a multiplier must be greater than zero'
          USING ERRCODE = 'check_violation';
      END IF;

      INSERT INTO public.pickem_slate_games
        (id, game_id, display_order, away_team, home_team, spread, kickoff, note, multiplier)
      VALUES (
        v_item ->> 'id',
        p_game_id,
        v_idx,
        v_item ->> 'awayTeam',
        v_item ->> 'homeTeam',
        NULLIF(v_item ->> 'spread', ''),
        NULLIF(v_item ->> 'kickoff', ''),
        NULLIF(v_item ->> 'note', ''),
        v_multiplier
      )
      ON CONFLICT (id) DO UPDATE SET
        display_order = EXCLUDED.display_order,
        away_team     = EXCLUDED.away_team,
        home_team     = EXCLUDED.home_team,
        spread        = EXCLUDED.spread,
        kickoff       = EXCLUDED.kickoff,
        note          = EXCLUDED.note,
        multiplier    = EXCLUDED.multiplier;

      v_idx := v_idx + 1;
    END LOOP;

    -- THE CLEAR, at the cause -- now REMOVAL-ONLY (migration 174).
    --
    -- 157 wrote this as `v_prior IS DISTINCT FROM v_keep`, reasoning that "a
    -- ranking is a permutation of 1..N over the slate, so a changed id SET
    -- invalidates every one of them". That was correct when it was written and
    -- it is half-correct now, because migration 166 changed what a valid sheet
    -- IS. A sheet's ranks need only be WITHIN 1..N and distinct (166:130-143);
    -- exactly-1..N is required only of a COMPLETE sheet (166:154-159).
    --
    -- So the two directions stopped being symmetric:
    --
    --   ADD    (N=4 -> 5, ranks 1-4 kept)  ranks stay in range, stay distinct,
    --                                      and the completeness gate no longer
    --                                      applies -> ALREADY a legal partial
    --                                      sheet. Nothing to invalidate.
    --   REMOVE (N=5 -> 4, ranks 1-5 kept)  a rank of 5 is now out of range ->
    --                                      genuinely invalid. Still clears.
    --
    -- Both directions verified by evaluating 166's three gates directly, with
    -- negative controls (out-of-range, duplicate rank, complete-but-gapped) to
    -- prove the check can refuse: the ADD case is admitted, the REMOVE case is
    -- refused.
    --
    -- This is what #1150 cost. After the lock the slate is deliberately
    -- editable (157, above) but nobody can re-rank -- `pickem_picks_write`
    -- gates on `pickem_picks_open` (146:397), the proxy path gates on it too
    -- (163:190), and 165:97 refuses a reopen once results exist. So a runner
    -- adding one late game silently zeroed every sheet, with no way back short
    -- of Reset scores. Migration 156 removed `reopen` for destroying rankings
    -- and relocated that destruction here, "where the cause is" (156:194);
    -- this finishes that move by making the harmless direction harmless.
    --
    -- A SET DIFFERENCE, not an inequality. `v_prior` and `v_keep` are both
    -- `array_agg(id ORDER BY id)`, so this asks the only question that matters:
    -- did any id LEAVE? Ordering is normalised away by the ORDER BY, and row
    -- content (spread, kickoff, note, multiplier, teams) was never in the
    -- comparison -- an edit in place has always been free and still is.
    --
    -- 157's `IS DISTINCT FROM` was also guarding the empty-slate case, where an
    -- aggregate over no rows would be NULL if the COALESCE were ever removed.
    -- EXCEPT keeps that safe from the other side: a NULL `v_prior` unnests to
    -- no rows, so the difference is empty and nothing is cleared -- the same
    -- answer, reached without depending on NULL-vs-empty semantics at all.
    --
    -- NAMED AND UNREACHABLE: a payload listing the same id twice makes `v_keep`
    -- longer than `v_prior` with an identical SET, which the old array compare
    -- treated as a change and this does not. No client path produces one and
    -- the UPSERT absorbs it either way; recorded because the arrays-vs-sets
    -- difference is real even though nothing reaches it.
    IF EXISTS (SELECT unnest(v_prior) EXCEPT SELECT unnest(v_keep)) THEN
      UPDATE public.pickem_picks
         SET confidence = NULL, updated_at = now()
       WHERE game_id = p_game_id
         AND confidence IS NOT NULL;
    END IF;
  END IF;
END;
$function$;

COMMENT ON FUNCTION public.save_pickem_config(text, jsonb) IS
  'Commits a pick''em settings page atomically. Two freeze boundaries, guarding two different questions (157): the SLATE is frozen while picks are OPEN, the scoring SETTINGS freeze at the first RESULT. An id JOINING the slate costs nothing (174) — existing ranks stay a legal partial sheet under 166. An id LEAVING is REFUSED (175) when confidence ranks are stored, or when that contest has a result: both destroy work nobody can rebuild once picks are closed (#1150, #1208). Reordering, re-pricing and editing in place are free and always have been.';
