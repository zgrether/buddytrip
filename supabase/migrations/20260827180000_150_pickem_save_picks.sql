-- 150 — the sheet's one atomic write, and the ranking-clear a reopen promised.
--
-- Phase 3. Two changes, both forced by things that turned out to be true rather
-- than by anything on the plan.
--
-- ════════════════════════════════════════════════════════════════════════════
--  1. save_pickem_picks — and why it is SECURITY **INVOKER**
-- ════════════════════════════════════════════════════════════════════════════
--
-- Every other RPC in this feature (`save_pickem_config`, `set_pickem_phase`) is
-- SECURITY DEFINER, because each is a staff action whose gate is
-- `assert_game_edit`. **This one must not be**, and the reason is the whole
-- feature:
--
--   `pickem_picks_select` / `pickem_picks_write` are the two policies in this
--   schema with NO staff branch. A DEFINER function that writes picks runs as
--   the owner and bypasses both — so it would BE the staff bypass those
--   policies exist to refuse, reachable at /rest/v1/rpc, and `tsc` would have
--   nothing to say about it.
--
-- So this function runs as the caller and RLS is still the gate. It exists for
-- ATOMICITY and for ERROR MESSAGES, never for privilege. Copying the DEFINER
-- line off its neighbours would be the single most damaging edit available in
-- this file; it is called out here because "consistent with the others" is
-- exactly the reasoning migration 147 was written to warn about.
--
-- ── The atomicity is not decoration: a plain upsert CANNOT do this ──────────
--
-- `uq_pickem_picks_confidence` is a PARTIAL unique index, so it can never be a
-- DEFERRABLE constraint — Postgres checks it row by row, mid-statement. Swap
-- two ranks (1↔2, the commonest edit a person makes on this screen) and a
-- single multi-row upsert transiently holds two rows at the same value and
-- raises 23505. The client would see "could not be saved" for a sheet that is
-- perfectly legal.
--
-- Hence the two-phase body: NULL every rank on this sheet, then write the new
-- ones. Two statements, one transaction, no intermediate state that violates
-- anything. This is not reachable from a PostgREST `.upsert()` at all, which is
-- the real reason the procedure exists.
--
-- ── Validated here as well as in the policy, for different reasons ──────────
--
-- The lifecycle check duplicates what `pickem_picks_write` already enforces.
-- That is deliberate and it is NOT a second definition: both call the same
-- `pickem_picks_open`, the ONE predicate (migration 147, and pinned against its
-- TypeScript twin by `pickemLifecycleParity.rls.test.ts`). Without it the
-- deadline arrives as an empty result set from an UPDATE — no error, nothing
-- written, and a person who is told their sheet saved. With it, they are told
-- the deadline passed.
--
-- ── Completeness is a server rule, not a client one ────────────────────────
--
-- Spec §4: everyone starts with a complete valid sheet, so a partial sheet is
-- not a state the app has. A sheet arriving with fifteen of sixteen games is a
-- bug somewhere, and accepting it would create the "no picks on game 12" state
-- the scoring engine is being written to never have to handle.
--
-- ════════════════════════════════════════════════════════════════════════════
--  2. Reopening the slate clears every ranking
-- ════════════════════════════════════════════════════════════════════════════
--
-- Migration 148's `reopen` arm carries the comment "what the runner is told,
-- and what the spec states, is that everyone re-ranks" — and then does not
-- clear anything. The sentence was true about the COPY and false about the
-- code, which is the failure mode CLAUDE.md keeps a whole section on: a message
-- that states a finding it did not produce.
--
-- It was invisible in Phase 2 because nothing wrote a rank yet.
--
-- Add a game and 1..N no longer covers N+1 games; remove one and there is a
-- hole. Either way the stored ranking is no longer a ranking of this slate. The
-- decision (HANDOFF §7.2) is the least destructive correct thing:
--
--   * keep every pick whose game still exists — that is what 148's upsert
--     already protects, and it is unchanged here
--   * clear the ranking ENTIRELY — not compacted, not renumbered. A rank
--     nobody chose that looks like one they did is worse than an obvious gap,
--     and re-ranking is the point of the reopen warning
--   * the person is TOLD, which is the client's half: `confidence IS NULL` on a
--     confidence game is the signal, and it needs no column of its own
--
-- Clearing on REOPEN rather than on the subsequent slate save is deliberate:
-- reopen is the moment the runner is warned and consents, and it is one
-- statement instead of a diff between two slates.

-- ── save_pickem_picks ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.save_pickem_picks(p_game_id text, p_picks jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $$
DECLARE
  v_user text := (auth.uid())::text;
  v_use_confidence boolean;
  v_slate_count integer;
  v_supplied integer;
  v_item jsonb;
  v_conf integer;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED: no signed-in user'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- The message, not the gate. `pickem_picks_write` refuses the rows either
  -- way; without this the refusal is a silent zero-row write.
  IF NOT public.pickem_picks_open(p_game_id) THEN
    RAISE EXCEPTION 'PICKS_CLOSED: picks are not open for this game'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT pg.use_confidence INTO v_use_confidence
    FROM public.pickem_games pg WHERE pg.game_id = p_game_id;
  IF v_use_confidence IS NULL THEN
    RAISE EXCEPTION 'GAME_NOT_FOUND: no pick''em config for this game'
      USING ERRCODE = 'no_data_found';
  END IF;

  SELECT count(*) INTO v_slate_count
    FROM public.pickem_slate_games s WHERE s.game_id = p_game_id;

  -- DISTINCT: two entries for one contest would otherwise pass a bare count and
  -- then silently last-write-wins through the upsert.
  SELECT count(DISTINCT elem ->> 'slateGameId') INTO v_supplied
    FROM jsonb_array_elements(p_picks) AS elem;

  IF v_supplied <> v_slate_count THEN
    RAISE EXCEPTION 'INCOMPLETE_SHEET: expected % picks, got %', v_slate_count, v_supplied
      USING ERRCODE = 'check_violation';
  END IF;

  -- Every id must belong to THIS game's slate. The composite FK would catch a
  -- foreign id, but only after the count above had already passed — and its
  -- error names a constraint rather than the problem.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_picks) AS elem
     WHERE NOT EXISTS (
       SELECT 1 FROM public.pickem_slate_games s
        WHERE s.id = elem ->> 'slateGameId' AND s.game_id = p_game_id)
  ) THEN
    RAISE EXCEPTION 'UNKNOWN_SLATE_GAME: a pick names a game that is not on this slate'
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_use_confidence THEN
    -- Exactly 1..N, each once. Checked as a set difference in BOTH directions:
    -- "all between 1 and N" plus "all distinct" is the same thing only because
    -- there are N of them, and that coincidence is the kind of reasoning that
    -- stops being true when someone adds a tie-break rule.
    IF EXISTS (
      SELECT generate_series(1, v_slate_count)
      EXCEPT
      SELECT (elem ->> 'confidence')::integer FROM jsonb_array_elements(p_picks) AS elem
    ) OR EXISTS (
      SELECT (elem ->> 'confidence')::integer FROM jsonb_array_elements(p_picks) AS elem
      EXCEPT
      SELECT generate_series(1, v_slate_count)
    ) THEN
      RAISE EXCEPTION 'BAD_CONFIDENCE: ranks must be exactly 1..% with no repeats', v_slate_count
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- PHASE 1 — clear this sheet's ranks. See the header: the partial unique
  -- index is checked per row, so 1↔2 in one statement raises 23505 without it.
  UPDATE public.pickem_picks
     SET confidence = NULL
   WHERE game_id = p_game_id AND user_id = v_user AND confidence IS NOT NULL;

  -- PHASE 2 — write. Every target rank is now free.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_picks)
  LOOP
    -- Confidence OFF stores NULL regardless of what the client sent. A stored 1
    -- would collide under the partial unique index on the second game, and a
    -- stored rank on a game that does not rank is a value nobody chose.
    v_conf := CASE WHEN v_use_confidence
                   THEN (v_item ->> 'confidence')::integer
                   ELSE NULL END;

    INSERT INTO public.pickem_picks (id, game_id, slate_game_id, user_id, pick, confidence, updated_at)
    VALUES (
      (gen_random_uuid())::text,
      p_game_id,
      v_item ->> 'slateGameId',
      v_user,
      v_item ->> 'pick',
      v_conf,
      now()
    )
    ON CONFLICT (slate_game_id, user_id) DO UPDATE SET
      pick = EXCLUDED.pick,
      confidence = EXCLUDED.confidence,
      updated_at = now();
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.save_pickem_picks(text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_pickem_picks(text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.save_pickem_picks(text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_pickem_picks(text, jsonb) TO service_role;

COMMENT ON FUNCTION public.save_pickem_picks(text, jsonb) IS
  'One participant''s whole sheet, written atomically. SECURITY INVOKER on purpose: pickem_picks'' policies have no staff branch, and a DEFINER function here would be exactly the bypass they refuse. Exists because a partial unique index cannot be deferred, so swapping two ranks in a single upsert raises 23505 mid-statement — the body nulls the sheet''s ranks and then rewrites them (migration 150).';

-- ── set_pickem_phase: reopen now clears the rankings ───────────────────────
--
-- Re-declared in full (plpgsql has no append). Everything but the `reopen` arm
-- is migration 148's body unchanged.
CREATE OR REPLACE FUNCTION public.set_pickem_phase(p_game_id text, p_action text, p_deadline timestamptz DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  PERFORM public.assert_game_edit(p_game_id);

  INSERT INTO public.pickem_games (game_id) VALUES (p_game_id)
  ON CONFLICT (game_id) DO NOTHING;

  IF p_action = 'open' THEN
    -- Refuse an empty slate. "Picks open soon" with nothing to pick is a dead
    -- end for sixteen people, and the runner cannot see that from his own
    -- screen because HE can read the slate whether or not it has rows.
    IF NOT EXISTS (SELECT 1 FROM public.pickem_slate_games WHERE game_id = p_game_id) THEN
      RAISE EXCEPTION 'EMPTY_SLATE: add at least one game before opening picks'
        USING ERRCODE = 'check_violation';
    END IF;
    UPDATE public.pickem_games
       SET picks_opened_at = COALESCE(picks_opened_at, now()),
           picks_deadline = p_deadline,
           picks_locked_at = NULL
     WHERE game_id = p_game_id;

  ELSIF p_action = 'lock' THEN
    UPDATE public.pickem_games SET picks_locked_at = COALESCE(picks_locked_at, now())
     WHERE game_id = p_game_id AND picks_opened_at IS NOT NULL;

  ELSIF p_action = 'reopen' THEN
    -- Back to `building`. Picks SURVIVE — that is what 148's upsert protects.
    -- The RANKING does not, and now actually does not: see this migration's
    -- header for why clearing entirely beats renumbering, and why the previous
    -- version's comment describing this behaviour was not the same as having it.
    --
    -- Unconditional, not gated on `use_confidence`: a game that ran with
    -- confidence off has nothing but NULLs here, so the statement is a no-op —
    -- and if the setting is flipped ON during the same reopen (which the now-
    -- unfrozen `save_pickem_config` permits), a ranking left over from an
    -- earlier confidence-on era would come back to life mid-edit.
    UPDATE public.pickem_picks SET confidence = NULL, updated_at = now()
     WHERE game_id = p_game_id AND confidence IS NOT NULL;

    UPDATE public.pickem_games
       SET picks_opened_at = NULL, picks_locked_at = NULL
     WHERE game_id = p_game_id;

  ELSE
    RAISE EXCEPTION 'BAD_ACTION: expected open, lock or reopen' USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.set_pickem_phase(text, text, timestamptz) IS
  'The pick''em lifecycle transitions. open refuses an empty slate; lock stamps picks_locked_at; reopen returns to building, KEEPS every pick and CLEARS every ranking (migration 150 — 148 promised the clear in a comment and did not do it). The deadline is evaluated lazily by pickem_picks_open/_revealed because no scheduler exists.';
