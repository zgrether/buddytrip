-- 156 — retire `reopen`, and stop `open` writing the deadline.
--
-- Two corrections to migration 151, both the same shape as the one migration
-- 153 already made: a compound action doing several things because they
-- happened to arrive together.
--
-- ══ 1. `open` no longer takes a deadline ═══════════════════════════════════
--
-- 151's `open` wrote THREE columns, one of them `picks_deadline = p_deadline`
-- with no COALESCE. Both UI call sites pass null. So re-opening a game always
-- wiped its deadline — silently, leaving a game that stays open until someone
-- locks it by hand, with the countdown simply gone and nothing saying why.
--
-- 153 split `set_pickem_deadline` out of this function for exactly this reason,
-- observing that using `open` to edit a deadline would "publish a building game
-- or silently unlock a locked one". That closed the seam from one side. The
-- deadline was still riding along on the other.
--
-- COALESCE(p_deadline, picks_deadline) was the obvious fix and is the wrong
-- one: it makes "open with no deadline" inexpressible, which is a legitimate
-- thing to want. The honest fix is that `open` should not write the deadline at
-- all. `set_pickem_deadline` exists now, works in any phase, and is what the
-- deadline row already calls. Open opens; the deadline is set separately,
-- before or after. **Keeping the parameter would keep the trap**, so the
-- parameter goes.
--
-- `open` also stops clearing `picks_locked_at`. `unlock` owns that (151), and
-- a game in `building` has no lock to clear — `lock` refuses a game that never
-- opened. One action, one responsibility.
--
-- ══ 2. `reopen` is DELETED, not relocated ══════════════════════════════════
--
-- `reopen` nulled `confidence` for every participant — irreversible, with no
-- audit table anywhere in this schema — as a SIDE EFFECT of an action whose
-- stated purpose was making the slate editable. Reopen and change nothing, and
-- sixteen rankings were destroyed for no reason. It also nulled
-- `picks_opened_at`, losing the original publish time (`open` re-stamps a fresh
-- `now()`), and bumped `updated_at` on every pick, losing when each person
-- submitted.
--
-- The consequence belongs to the EDIT, not to the mode. Adding or removing a
-- game is what invalidates a ranking; opening the door is not. So:
--
--   * the slate is editable whenever picks are NOT OPEN — which now includes
--     `locked`, where it previously was not
--   * rankings are cleared when the slate ACTUALLY CHANGES, in the function
--     that changes it, where the cause is
--
-- That leaves `unlock` as the whole of the "let me edit this again" path, and
-- it destroys nothing.
--
-- ── Why the clear is still needed at all ───────────────────────────────────
--
-- `reconcileSheet` already recovers on the client: a stored ranking that is not
-- exactly 1..N over the current slate is discarded wholesale and re-defaulted.
-- So the UI would survive with no server clear.
--
-- Scoring would not. A sheet nobody re-opens keeps its stale ranks in the
-- table, and Phase 5 reads that column. Leaving a partial ranking behind is the
-- landmine 150 removed on the reopen path; it belongs here for the same reason.
--
-- ── What counts as "changed" ───────────────────────────────────────────────
--
-- The SET of slate ids, and nothing else. A ranking is a permutation of 1..N
-- over the slate, so gaining or losing a game invalidates it and reordering,
-- re-spreading or re-weighting one does not. Clearing on a multiplier edit
-- would destroy work for a change the ranking survives — the same
-- over-destruction this migration exists to remove.
--
-- ══ 3. The lifecycle predicate, extracted rather than copied ═══════════════
--
-- `save_pickem_config` needs to ask "are picks open?". It cannot call
-- `pickem_picks_open`, because migration 147 correctly put `is_trip_member`
-- INSIDE that function — so from a `SECURITY DEFINER` body it conflates "picks
-- are open" with "the caller is a member", and returns FALSE for `service_role`
-- (no `auth.uid()`), letting the guard pass on a game whose picks are open.
--
-- Writing the condition inline would be a second definition of the rule, which
-- is the failure this file has been avoiding since 146. So the lifecycle half
-- is extracted and `pickem_picks_open` is rebuilt on top of it. No behaviour
-- change through the policies — `pickemLifecycleParity.rls.test.ts` pins that.
--
-- `_pickem_picks_open_state` answers about a CONTAINER, not about its caller,
-- which is exactly the shape CLAUDE.md #28 says must not be reachable from the
-- exposed API. It is therefore REVOKEd from anon and authenticated, following
-- `_write_game_side`'s precedent, and is only ever called from definer bodies.

-- ── The pure lifecycle condition ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._pickem_picks_open_state(p_game_id text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.pickem_games pg
     WHERE pg.game_id = p_game_id
       AND pg.picks_opened_at IS NOT NULL
       AND pg.picks_locked_at IS NULL
       AND (pg.picks_deadline IS NULL OR now() <= pg.picks_deadline)
  );
$$;

REVOKE ALL ON FUNCTION public._pickem_picks_open_state(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._pickem_picks_open_state(text) FROM anon;
REVOKE ALL ON FUNCTION public._pickem_picks_open_state(text) FROM authenticated;

COMMENT ON FUNCTION public._pickem_picks_open_state(text) IS
  'The pick''em lifecycle condition ALONE — opened, not hand-locked, deadline not passed — with no membership check. Answers about a container rather than about its caller, so it is REVOKEd from anon and authenticated per CLAUDE.md #28 and is only called from SECURITY DEFINER bodies. pickem_picks_open ANDs this with is_trip_member; save_pickem_config needs the lifecycle half without the authorization half, because from a definer body the membership check would read false for service_role and let a frozen-slate write through (migration 156).';

-- Rebuilt on the extracted condition. Same answer as migration 147's body.
CREATE OR REPLACE FUNCTION public.pickem_picks_open(p_game_id text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.pickem_games pg
      JOIN public.games g ON g.id = pg.game_id
     WHERE pg.game_id = p_game_id
       AND public.is_trip_member(g.trip_id)
  ) AND public._pickem_picks_open_state(p_game_id);
$$;

-- ── set_pickem_phase: three actions, no deadline ───────────────────────────
--
-- The 3-argument signature is DROPPED rather than left beside the new one:
-- `set_pickem_phase(text, text, timestamptz DEFAULT NULL)` and
-- `set_pickem_phase(text, text)` would make every two-argument call ambiguous,
-- so they cannot coexist. This is a REMOVAL, so per CLAUDE.md's migration rule
-- 3b the code that stopped using the old shape ships WITH it; the two cannot be
-- staged apart, and the window is one deploy on a format not yet in real use.

DROP FUNCTION IF EXISTS public.set_pickem_phase(text, text, timestamptz);

CREATE OR REPLACE FUNCTION public.set_pickem_phase(p_game_id text, p_action text)
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
    -- ONE column. The deadline belongs to `set_pickem_deadline` and the lock to
    -- `unlock`; see this migration's header for what writing all three cost.
    UPDATE public.pickem_games
       SET picks_opened_at = COALESCE(picks_opened_at, now())
     WHERE game_id = p_game_id;

  ELSIF p_action = 'lock' THEN
    UPDATE public.pickem_games SET picks_locked_at = COALESCE(picks_locked_at, now())
     WHERE game_id = p_game_id AND picks_opened_at IS NOT NULL;

  ELSIF p_action = 'unlock' THEN
    -- The whole of the "let me change something" path now that `reopen` is
    -- gone, and it destroys nothing: the slate becomes editable because
    -- `save_pickem_config` gates on picks being OPEN, which a hand-locked game
    -- is not. Rankings survive unless the slate actually changes.
    --
    -- A game past its DEADLINE is not reopened by this — unlocking clears only
    -- the hand lock. Move the deadline with `set_pickem_deadline` to reopen
    -- that one, which is the same tool doing the same job.
    UPDATE public.pickem_games SET picks_locked_at = NULL
     WHERE game_id = p_game_id AND picks_opened_at IS NOT NULL;

  ELSE
    RAISE EXCEPTION 'BAD_ACTION: expected open, lock or unlock' USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_pickem_phase(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_pickem_phase(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_pickem_phase(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_pickem_phase(text, text) TO service_role;

COMMENT ON FUNCTION public.set_pickem_phase(text, text) IS
  'The pick''em lifecycle transitions, one column each: open stamps picks_opened_at (refusing an empty slate), lock stamps picks_locked_at, unlock clears it. It does NOT write the deadline — set_pickem_deadline owns that, because open writing it with no COALESCE silently wiped the deadline of every re-opened game (migration 156). reopen was DELETED in the same migration: it destroyed every ranking as a side effect of making the slate editable, and that consequence now belongs to the slate save, where the cause is.';

-- ── save_pickem_config: editable unless picks are OPEN, and it owns the clear ─

CREATE OR REPLACE FUNCTION public.save_pickem_config(p_game_id text, p_payload jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
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
  IF public._pickem_picks_open_state(p_game_id) THEN
    RAISE EXCEPTION 'SLATE_LOCKED: picks are open, so the slate and its scoring settings are frozen. Lock picks first — nobody loses anything unless the slate itself changes.'
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

    -- THE CLEAR, at the cause. A ranking is a permutation of 1..N over the
    -- slate, so a changed id SET invalidates every one of them; reordering or
    -- re-weighting a game does not, and clearing for those would destroy work
    -- the ranking survives.
    --
    -- `IS DISTINCT FROM` rather than `<>` so the empty-slate case (a NULL from
    -- an empty aggregate, were the COALESCE ever removed) compares as a
    -- difference instead of as unknown.
    IF v_prior IS DISTINCT FROM v_keep THEN
      UPDATE public.pickem_picks
         SET confidence = NULL, updated_at = now()
       WHERE game_id = p_game_id
         AND confidence IS NOT NULL;
    END IF;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.save_pickem_config(text, jsonb) IS
  'The pick''em slate modal''s single atomic write: the slate and the two scoring settings commit together or not at all, because spec §4 freezes all of them at the same instant for the same reason. UPSERTS slate rows by id and deletes only genuinely-removed ones — a clean-replace would cascade-delete every pick through pickem_picks'' FK. Refuses the write only while picks are OPEN (migration 156, replacing 148''s picks_opened_at check, which froze the slate permanently and forced the destructive reopen). Clears every ranking when, and only when, the slate''s id SET changes — the consequence now sits with its cause instead of riding on a mode change.';

REVOKE ALL ON FUNCTION public.save_pickem_config(text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_pickem_config(text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.save_pickem_config(text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_pickem_config(text, jsonb) TO service_role;
