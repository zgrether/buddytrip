-- 163 · Pick'em proxy entry — one write body, two gates; read follows write
--
-- A guest has no `auth.uid()`, and `pickem_picks_write` requires
-- `user_id = auth.uid()`. So a placeholder's sheet can ONLY ever be written by
-- someone else. That is not a limitation to work around — it is the mechanism,
-- and without it every placeholder scores home-team defaults. 15 guests already
-- hold picks; 97 sit on teams.
--
-- == THE SHAPE ==============================================================
--
--   _pickem_can_proxy_for(game, target)   the policy decision, caller-fact
--   _pickem_write_sheet(game, target, picks)  the un-guarded core, INVOKER
--   save_pickem_picks(game, picks)        INVOKER — unchanged, RLS is its gate
--   save_pickem_picks_for(game, t, picks) DEFINER — explicit gate, then core
--   pickem_sheet_status(game)             who has submitted. NEVER their picks.
--
-- ONE write body, two gates. A `SECURITY INVOKER` function called from inside a
-- `SECURITY DEFINER` one runs as the DEFINER's owner, so the same core bypasses
-- RLS on the proxy path and stays bound by it on the self path. The ~100 lines
-- of validation — completeness, the 1..N confidence permutation checked as a
-- set difference in both directions, slate membership, and the two-phase rank
-- clear the partial unique index forces — exist once. Two copies of that is the
-- `games.post` trap in CLAUDE.md #8: a second procedure whose reason for
-- existing is "this case is different".
--
-- == `entered_by` IS NEVER A PARAMETER ======================================
--
-- The core reads it from `auth.uid()` rather than taking it, which is correct on
-- BOTH paths (self: actor = target; proxy: actor = the proxy) and makes the
-- audit trail unforgeable. Were it a parameter, the core is callable directly by
-- `authenticated` — RLS would still refuse a foreign TARGET, but nothing would
-- stop someone stamping another person's name on their own sheet.
--
-- NULL means "written before this column existed", which is the truth for every
-- existing row. Proxy is `entered_by <> user_id`. NOT null-for-self: a NULL that
-- means "self" gets read as "unknown", and this feature has already produced
-- that exact collapse twice — sheets scoring nowhere rendering as absent, and a
-- push reading as an unplayed zero.
--
-- == THE READ WIDENS, AND ONLY HERE =========================================
--
-- Whoever can WRITE a sheet can read it. Write-without-read protects nothing: a
-- captain who can overwrite Ty's sheet but not see it destroys twelve correct
-- picks blindfolded. So `pickem_picks_select` gains ONE arm — a call to
-- `_pickem_can_proxy_for`.
--
-- It is a call to a definer helper, NOT a captain arm. `is_team_captain` appears
-- in zero policies in this schema and must keep appearing in zero: the RLS
-- audit's F8/F9 removed a captain arm from `team_assignments_update` and
-- `teams_update` because it granted roster control, and migration 139 records
-- why a trigger was rejected as the replacement — `merge_guest_to_real_user`
-- repoints `team_assignments.user_id` inside the signup trigger, and triggers
-- fire even for SECURITY DEFINER. Captain powers live in definer RPCs
-- (`update_team_identity`, `reorder_team_roster`) and this follows them.
--
-- A PLAIN PARTICIPANT'S REFUSAL IS UNTOUCHED. `_pickem_can_proxy_for` returns
-- false for them on every row but their own, so Phase 0's mutation check — 6 of
-- 31 tests red when a staff branch is restored to the participant path — still
-- holds and is re-run in this PR.
--
-- CLAUDE.md #26 (a SELECT policy is also an UPDATE check) applies but costs
-- nothing here: `pickem_picks_write` keeps `user_id = auth.uid()` in BOTH USING
-- and WITH CHECK, so a widened SELECT admits no write. Proxy writes never touch
-- the policy at all — they go through the definer.
--
-- == THE COUNT AND THE SHEET ARE DIFFERENT FUNCTIONS ========================
--
-- "Has Ty submitted" is a count; "what did Ty pick" is the sheet. They have the
-- SAME answer for a captain about his own team and DIFFERENT answers about the
-- other team, so sharing a function is precisely where the leak would be.
-- `pickem_sheet_status` returns `(user_id, submitted)` and has no column that
-- could carry a pick.

-- == 1 . entered_by =========================================================

ALTER TABLE public.pickem_picks
  ADD COLUMN IF NOT EXISTS entered_by text REFERENCES public.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.pickem_picks.entered_by IS
  'Who SAVED this row, from auth.uid() — never a parameter, so it cannot be forged. Equal to user_id for self-entry; different for a proxy (migration 163). NULL means the row predates this column, which is why self-entry stores the actor rather than NULL: a NULL meaning "self" becomes indistinguishable from "unknown".';

-- The guest merge. A ghost can never BE an actor — `entered_by` comes from
-- `auth.uid()` and a placeholder has none — so this matches zero rows today and
-- is here because the rule's failure direction is silent data loss, and one line
-- is cheaper than discovering later that some new path made guests actor-capable.
CREATE OR REPLACE FUNCTION public.merge_guest_pickem_picks(p_ghost_id text, p_real_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  DELETE FROM public.pickem_picks gp
   WHERE gp.user_id = p_ghost_id
     AND EXISTS (SELECT 1 FROM public.pickem_picks rp
                  WHERE rp.game_id = gp.game_id AND rp.user_id = p_real_id);
  UPDATE public.pickem_picks SET user_id = p_real_id WHERE user_id = p_ghost_id;
  -- Unreachable by construction (see above), kept so it cannot become reachable
  -- silently. Deliberately AFTER the user_id repoint so a sheet the ghost owned
  -- and somehow stamped carries the real id in both columns.
  UPDATE public.pickem_picks SET entered_by = p_real_id WHERE entered_by = p_ghost_id;
END;
$function$;

-- == 2 . the policy decision ================================================

-- Caller-fact: names `auth.uid()`, so per CLAUDE.md #28 it is safe to expose —
-- change the caller with the same arguments and the answer moves. Contrast
-- `_pickem_has_results`, which answers about a CONTAINER and is REVOKEd.
--
-- One SELECT rather than a plpgsql cascade because it is evaluated PER ROW by
-- the select policy: a board read is ~256 rows, so the arms have to be one plan
-- and one round trip, not four.
CREATE OR REPLACE FUNCTION public._pickem_can_proxy_for(p_game_id text, p_target_user_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT (auth.uid())::text IS NOT NULL AND (
    -- SELF. First because it is the common case and costs no query.
    p_target_user_id = (auth.uid())::text
    OR EXISTS (
      SELECT 1 FROM public.games g
       WHERE g.id = p_game_id
         AND (
           -- STAFF — any sheet. The runner already sets the slate, the spreads,
           -- the multipliers and the results; confidentiality from him is
           -- theater, and the Owner can remove a delegate or an organizer.
           public.has_trip_role(g.trip_id, ARRAY['Owner', 'Organizer'])
           OR public.is_game_delegate(g.id)
           -- CAPTAIN — own team only, and this is THE hard boundary. Both the
           -- caller and the target must be on the SAME team in THIS game's
           -- competition. `g.competition_id IS NULL` (a standalone game) makes
           -- both EXISTS empty, so the arm is false rather than an error.
           OR EXISTS (
                SELECT 1
                  FROM public.team_assignments cap
                  JOIN public.team_assignments tgt
                    ON tgt.team_id = cap.team_id
                   AND tgt.competition_id = cap.competition_id
                 WHERE cap.competition_id = g.competition_id
                   AND cap.user_id = (auth.uid())::text
                   AND cap.is_captain
                   AND tgt.user_id = p_target_user_id
              )
         )
    )
  );
$function$;

COMMENT ON FUNCTION public._pickem_can_proxy_for(text, text) IS
  'Can the CALLER enter and read a sheet for this target (migration 163). Caller-fact — the answer moves with who is asking, so it is safe to expose under CLAUDE.md #28. Gates both save_pickem_picks_for and the proxy arm of pickem_picks_select, so write and read cannot drift apart.';

-- == 3 . the un-guarded write core ==========================================

-- SECURITY INVOKER deliberately. Called from `save_pickem_picks` it runs as the
-- caller and `pickem_picks_write` is the gate, exactly as before this migration.
-- Called from `save_pickem_picks_for` (DEFINER) it runs as the owner and the
-- explicit check there is the gate.
--
-- Executable by `authenticated` because the self path needs it. That is safe:
-- RLS refuses a foreign target, and `entered_by` is not a parameter.
CREATE OR REPLACE FUNCTION public._pickem_write_sheet(
  p_game_id text,
  p_user_id text,
  p_picks jsonb
)
RETURNS void
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  v_actor text := (auth.uid())::text;
  v_use_confidence boolean;
  v_slate_count integer;
  v_supplied integer;
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

-- == 4 . the two public entry points ========================================

-- Unchanged signature, unchanged behaviour, unchanged gate. Its 28 tests should
-- not notice this migration except for `entered_by` now being stamped.
CREATE OR REPLACE FUNCTION public.save_pickem_picks(p_game_id text, p_picks jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  -- Runs as the caller, so `pickem_picks_write` still refuses anything that is
  -- not their own sheet. The target is not a parameter here at all.
  PERFORM public._pickem_write_sheet(p_game_id, (auth.uid())::text, p_picks);
END;
$function$;

CREATE OR REPLACE FUNCTION public.save_pickem_picks_for(
  p_game_id text,
  p_target_user_id text,
  p_picks jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF (auth.uid())::text IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED: no signed-in user'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- The ONLY gate on this path — RLS is bypassed from here down, which is the
  -- whole point and also why this is the first statement after authentication.
  IF NOT public._pickem_can_proxy_for(p_game_id, p_target_user_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: you cannot enter picks for that person'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- The target must be a member of this game's trip. `_pickem_can_proxy_for`
  -- answers about the ACTOR; without this a delegate could mint a sheet for any
  -- user id in the database, which is F1's lesson (ids are not secrets).
  IF NOT EXISTS (
    SELECT 1 FROM public.games g
      JOIN public.trip_members tm ON tm.trip_id = g.trip_id
     WHERE g.id = p_game_id AND tm.user_id = p_target_user_id
  ) THEN
    RAISE EXCEPTION 'NOT_A_MEMBER: that person is not on this trip'
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM public._pickem_write_sheet(p_game_id, p_target_user_id, p_picks);
END;
$function$;

-- == 5 . submission status — a COUNT, and no column that could carry a pick ==

CREATE OR REPLACE FUNCTION public.pickem_sheet_status(p_game_id text)
RETURNS TABLE (user_id text, submitted boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT tm.user_id,
         EXISTS (
           SELECT 1 FROM public.pickem_picks p
            WHERE p.game_id = p_game_id AND p.user_id = tm.user_id
         ) AS submitted
    FROM public.games g
    JOIN public.trip_members tm ON tm.trip_id = g.trip_id
   WHERE g.id = p_game_id
     AND public._pickem_can_proxy_for(p_game_id, tm.user_id);
$function$;

COMMENT ON FUNCTION public.pickem_sheet_status(text) IS
  'Who the caller may proxy for, and whether each has a sheet (migration 163). Deliberately SEPARATE from any read of the picks themselves: "has Ty submitted" and "what did Ty pick" have the same answer for a captain about his own team and different answers about the other team, so one function serving both is exactly where the leak would be.';

-- == 6 . the read arm =======================================================

DROP POLICY IF EXISTS pickem_picks_select ON public.pickem_picks;
CREATE POLICY pickem_picks_select ON public.pickem_picks
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.games g
       WHERE g.id = pickem_picks.game_id
         AND public.is_trip_member(g.trip_id)
         AND (
           pickem_picks.user_id = (auth.uid())::text
           OR public.pickem_picks_revealed(pickem_picks.game_id)
           -- Read follows write. One call to a caller-fact definer helper — NOT
           -- a captain arm, and not a staff arm either: both are inside the
           -- helper, so this policy has exactly one place to look and the write
           -- gate cannot drift away from it.
           OR public._pickem_can_proxy_for(pickem_picks.game_id, pickem_picks.user_id)
         )
    )
  );

-- == 7 . grants =============================================================

REVOKE ALL ON FUNCTION public._pickem_can_proxy_for(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public._pickem_write_sheet(text, text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_pickem_picks_for(text, text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pickem_sheet_status(text) FROM PUBLIC, anon;

-- `_pickem_can_proxy_for` must be executable by `authenticated` because the
-- select policy evaluates it AS that role. Caller-fact, so this is the
-- `is_trip_member` shape and not the `_pickem_has_results` shape.
GRANT EXECUTE ON FUNCTION public._pickem_can_proxy_for(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public._pickem_write_sheet(text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_pickem_picks_for(text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pickem_sheet_status(text) TO authenticated;
