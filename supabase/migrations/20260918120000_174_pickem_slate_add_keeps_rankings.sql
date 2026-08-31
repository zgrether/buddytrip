-- 174 — a pick'em slate ADD stops destroying every confidence ranking.
--
-- ══ The bug (#1150) ════════════════════════════════════════════════════════
--
-- After picks LOCK, the slate is editable again — deliberately, and correctly:
-- a runner fixing a typo or a spread on the Saturday is normal, and 157
-- narrowed the freeze to "while picks are OPEN" for exactly that reason.
--
-- But `save_pickem_config` cleared every ranking on the game whenever the
-- slate's id set changed, in EITHER direction and regardless of lock state. So
-- adding one late game nulled every confidence on every sheet — silently. No
-- refusal, no warning, no note.
--
-- Confidence IS the score (`pickPoints` multiplies by it), so the wipe
-- re-scored the whole game. Measured on two otherwise identical games in one
-- cup: a decisive 8–0 became a 4–4 tie and the points split.
--
-- And nothing could put it back. `pickem_picks_write` gates on
-- `pickem_picks_open` (146:397) so the player cannot re-rank; the proxy path
-- gates on it too (163:190) so a captain cannot do it for them; and 165:97
-- refuses a reopen once any result is in. The only route back was Reset scores
-- → unlock → sixteen people re-rank → re-enter every result.
--
-- ══ Why only the ADD arm changes ═══════════════════════════════════════════
--
-- Migration 166 changed what a valid sheet IS, which broke the symmetry 157's
-- test assumed. Ranks need only be WITHIN 1..N and distinct (166:130-143);
-- exactly-1..N is demanded only of a COMPLETE sheet (166:154-159).
--
--   ADD    N=4 → 5, ranks 1-4 kept  ·  in range, distinct, and no longer
--                                      "complete" → already a legal PARTIAL
--                                      sheet. There is nothing to invalidate.
--   REMOVE N=5 → 4, ranks 1-5 kept  ·  a rank of 5 is out of range → genuinely
--                                      invalid. Keeps clearing.
--
-- Verified by evaluating 166's three gates directly rather than by reading
-- them, with negative controls — out-of-range, duplicate rank, and
-- complete-but-gapped are each REFUSED, so the check demonstrably can refuse;
-- against that, the ADD case is ADMITTED and the REMOVE case is REFUSED.
--
-- REMOVE stays destructive ON PURPOSE. Making it non-destructive needs
-- re-derivation semantics for an out-of-range rank that nobody has designed,
-- and today's behaviour is at least understood. Out of scope here.
--
-- ══ Replying to 157, which this partly reverses ════════════════════════════
--
-- 157's comment reasoned: "a ranking is a permutation of 1..N over the slate,
-- so a changed id SET invalidates every one of them; reordering or re-weighting
-- a game does not, and clearing for those would destroy work the ranking
-- survives." Every clause of that was true when written, and the last one is
-- the principle this migration extends rather than contradicts — an ADD is one
-- more case where the ranking survives and clearing destroys work for nothing.
-- What changed underneath it is 166, which arrived nine migrations later and
-- made "a permutation of 1..N" no longer the only valid shape.
--
-- Migration 156 is the other half of the history: it DELETED `reopen` because
-- that verb "destroyed every ranking as a side effect of making the slate
-- editable", and moved the consequence here, "where the cause is" (156:194).
-- The destruction was relocated, not removed. This finishes the job.
--
-- ══ Scope ═════════════════════════════════════════════════════════════════
--
-- Function body only. No schema change, no data change, nothing to backfill:
-- rankings already nulled by this bug stay nulled and are not recoverable from
-- here (the ids they ranked are gone from no table — but which rank belonged to
-- which game was never stored anywhere else). This stops the next one.
--
-- NOT fixed here, and still live: `pickemScoring.ts:73` reads
-- `useConfidence ? (pick.confidence ?? 0) : 1`, while this column's own comment
-- (146:217) says "scoring reads COALESCE(confidence, 1)". A null rank on a
-- confidence-ON game therefore scores 0 in code and 1 as documented. That gap
-- survives this migration — the REMOVE arm still produces the state by design —
-- and is filed separately. It is TypeScript, not SQL, and does not belong in a
-- migration PR.

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
  'Commits a pick''em settings page atomically. Two freeze boundaries, guarding two different questions (157): the SLATE is frozen while picks are OPEN, the scoring SETTINGS freeze at the first RESULT. Clearing confidence rankings is REMOVAL-ONLY (174): an id leaving the slate invalidates a rank that outranges it, while an id joining leaves every existing rank a legal partial sheet under 166 — so a post-lock ADD, which nobody can undo because re-ranking is gated on picks being open, no longer silently zeroes every sheet (#1150).';
