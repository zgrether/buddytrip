-- 166 — A PICK'EM SHEET MAY BE PARTIAL, AND SAVING ONE REPLACES IT.
--
-- Reverses migration 150's completeness gate (carried unchanged through 163),
-- which refused any payload whose distinct slate-game count did not equal the
-- slate's. That gate came from the model in migration 146's era: a sheet was
-- always complete, because the client pre-filled every game with the home team.
--
-- That model is gone. Nothing is pre-filled any more, so "complete" stopped
-- being a property of every sheet and became a thing a person works towards —
-- and Save has to be reachable while they are still working, or the progress
-- lives only in a localStorage draft that a lost phone takes with it.
--
-- ── THREE CHANGES, AND THE SECOND IS NOT OPTIONAL ─────────────────────────
--
-- 1. THE COMPLETENESS GATE IS RELAXED. A payload may name any subset of this
--    game's slate, including none of it.
--
-- 2. THE WRITE REPLACES THE SHEET. It was an upsert over the supplied array and
--    nothing else, which could not express "this game no longer has a pick".
--    That was harmless only while completeness made holes impossible: a
--    complete sheet has no cleared games, so nothing ever needed removing.
--
--    Tapping the side you already took now clears it (r4). Under partial saves
--    an upsert-only write would take the cleared game, find it absent from the
--    payload, and leave the old row exactly where it was — so the pick would
--    come back on the next read, and the person would have watched themselves
--    clear it. The delete below is what makes that feature real.
--
-- 3. RANKS SPLIT INTO TWO RULES, because a partial sheet cannot hold a
--    permutation of 1..N and it is not trying to. Always: every supplied rank
--    is within 1..N and no two are equal. Only on a COMPLETE sheet: exactly
--    1..N with nothing missing.
--
--    The client has always treated the ranking as an order over the SLATE
--    rather than over the picks — every row gets a rank the moment the sheet
--    renders, and dragging reorders all of them. So a partial sheet's ranks are
--    a subset of 1..N, distinct, with gaps where the unpicked games sit. That
--    is exactly what the first rule admits.
--
--    Ranks for unpicked games are NOT stored, and cannot be: `pick` is NOT NULL,
--    so no row exists for a game with no pick. That is the accepted cost of
--    keeping "has any rows" meaning "has submitted something", which the proxy
--    list and the board both read. The ranking of an unpicked game is not a
--    preference anyway — confidence is how sure you are about a pick, and there
--    is nothing to be sure about. The client re-derives slate order for those
--    games on load rather than showing an order it cannot restore.
--
-- ── A GUARD THE OLD GATE WAS PROVIDING BY ACCIDENT ────────────────────────
--
-- `v_supplied` counts DISTINCT slate ids, so a payload naming one contest twice
-- produced a distinct count BELOW the slate count and was refused — by the
-- completeness gate, for the wrong reason. Relax that gate and duplicates
-- become silently legal: both entries reach the upsert and the last one wins,
-- with no error and no way to tell which was kept.
--
-- So the duplicate check is now EXPLICIT, and it is stated as its own rule
-- rather than left as a side effect of a count comparison. It is the same
-- lesson this feature has had repeatedly: a check that works because of what it
-- happens to imply stops working the moment the thing it implies is changed.
--
-- Idempotent (CREATE OR REPLACE). No schema change; no data change.

CREATE OR REPLACE FUNCTION public._pickem_write_sheet(p_game_id text, p_user_id text, p_picks jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_actor text := (auth.uid())::text;
  v_use_confidence boolean;
  v_slate_count integer;
  v_supplied integer;
  v_rows integer;
  v_item jsonb;
  v_conf integer;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED: no signed-in user'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- The message, not the gate. `pickem_picks_write` refuses the rows either
  -- way; without this the refusal is a silent zero-row write. On the proxy path
  -- RLS is bypassed, so here it IS the gate — which is why it stays first.
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

  SELECT count(*), count(DISTINCT elem ->> 'slateGameId')
    INTO v_rows, v_supplied
    FROM jsonb_array_elements(p_picks) AS elem;

  -- EXPLICIT now. It used to be implied by the completeness gate: duplicates
  -- dragged the distinct count below the slate count, so the payload was
  -- refused for the wrong reason. With that gate relaxed, two entries for one
  -- contest would both reach the upsert and the last would silently win.
  IF v_rows <> v_supplied THEN
    RAISE EXCEPTION 'DUPLICATE_PICK: a contest appears more than once in this sheet'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Every id must belong to THIS game's slate. The composite FK would catch a
  -- foreign id, but its error names a constraint rather than the problem — and
  -- this is now the ONLY thing bounding the payload, since a subset is legal.
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
    -- ALWAYS: in range, and no two the same. A partial sheet's ranks are a
    -- subset of 1..N with gaps where the unpicked games are, which is what the
    -- client produces and what this admits.
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_picks) AS elem
       WHERE (elem ->> 'confidence') IS NULL
          OR (elem ->> 'confidence')::integer < 1
          OR (elem ->> 'confidence')::integer > v_slate_count
    ) THEN
      RAISE EXCEPTION 'BAD_CONFIDENCE: every rank must be between 1 and %', v_slate_count
        USING ERRCODE = 'check_violation';
    END IF;

    IF (SELECT count(DISTINCT (elem ->> 'confidence')::integer)
          FROM jsonb_array_elements(p_picks) AS elem) <> v_rows THEN
      RAISE EXCEPTION 'BAD_CONFIDENCE: two picks share a rank'
        USING ERRCODE = 'check_violation';
    END IF;

    -- ONLY WHEN COMPLETE: exactly 1..N, nothing missing. Checked as a set
    -- difference because "all in range" plus "all distinct" is the same thing
    -- as a permutation only because there are N of them — a coincidence that
    -- stops holding the moment the count is allowed to vary, which is precisely
    -- what this migration allows.
    IF v_supplied = v_slate_count AND EXISTS (
      SELECT generate_series(1, v_slate_count)
      EXCEPT
      SELECT (elem ->> 'confidence')::integer FROM jsonb_array_elements(p_picks) AS elem
    ) THEN
      RAISE EXCEPTION 'BAD_CONFIDENCE: a complete sheet must rank exactly 1..%', v_slate_count
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- REPLACE, not merge. Anything this sheet holds that the payload does not
  -- name has been cleared by the person, and leaving it would hand the pick
  -- back to them on the next read.
  DELETE FROM public.pickem_picks
   WHERE game_id = p_game_id
     AND user_id = p_user_id
     AND slate_game_id NOT IN (
       SELECT elem ->> 'slateGameId' FROM jsonb_array_elements(p_picks) AS elem
     );

  -- PHASE 1 — clear this sheet's surviving ranks. The partial unique index is
  -- checked per row, so swapping 1↔2 in one statement raises 23505 without it.
  UPDATE public.pickem_picks
     SET confidence = NULL
   WHERE game_id = p_game_id AND user_id = p_user_id AND confidence IS NOT NULL;

  -- PHASE 2 — write. Every target rank is now free.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_picks)
  LOOP
    -- Confidence OFF stores NULL regardless of what the client sent. A stored 1
    -- would collide under the partial unique index on the second game, and a
    -- stored rank on a game that does not rank is a value nobody chose.
    v_conf := CASE WHEN v_use_confidence
                   THEN (v_item ->> 'confidence')::integer
                   ELSE NULL END;

    INSERT INTO public.pickem_picks
      (id, game_id, slate_game_id, user_id, pick, confidence, entered_by, updated_at)
    VALUES (
      (gen_random_uuid())::text,
      p_game_id,
      v_item ->> 'slateGameId',
      p_user_id,
      v_item ->> 'pick',
      v_conf,
      v_actor,
      now()
    )
    ON CONFLICT (slate_game_id, user_id) DO UPDATE SET
      pick = EXCLUDED.pick,
      confidence = EXCLUDED.confidence,
      entered_by = EXCLUDED.entered_by,
      updated_at = now();
  END LOOP;
END;
$function$;

COMMENT ON FUNCTION public._pickem_write_sheet(text, text, jsonb) IS
  'Writes one pick''em sheet, REPLACING it: rows this game/user holds that the '
  'payload does not name are deleted, so a cleared pick actually clears. A '
  'partial sheet is legal (migration 166); ranks must be distinct and within '
  '1..N always, and exactly 1..N only when the sheet is complete.';

-- The `DELETE` runs under `pickem_picks_write` on the self path, which is
-- `FOR ALL` — own row, picks open, trip member — so it needs no new policy.
-- On the proxy path `save_pickem_picks_for` is SECURITY DEFINER and has already
-- gated on `_pickem_can_proxy_for`, exactly as the insert did.
