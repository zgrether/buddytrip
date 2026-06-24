-- 066 — Per-game reset primitives (config-checklist Phase A).
--
-- Pushes the reset primitive ONE LEVEL DOWN: "reset a game" gets a single home,
-- and competition-reset becomes the loop. Same "one known home, callers don't
-- reimplement" principle as migration 063 (which this refactors), applied per
-- game so Phase B's per-game danger zone has the capability before the UI.
--
-- Layering (by blast radius AND by guard):
--   _reset_game_scoring / _reset_game_to_skeleton  — UN-GUARDED cores. Do the
--     work for ONE game; NO auth check; NOT granted to authenticated (granting
--     them would be a direct-PostgREST bypass of the owner gate — the exact hole
--     063's assert_competition_owner closed). Callable only by the guarded
--     wrappers / other DEFINER functions.
--   reset_game_scoring / reset_game_to_skeleton    — owner-guarded public
--     wrappers. Granted to authenticated.
--   reset_competition_scoring / reset_competition_to_skeleton  — REFACTORED to
--     guard owner ONCE then loop the un-guarded core. The guard does NOT ride the
--     loop. Same EXTERNAL behavior as 063 (this is a behavior-preserving refactor
--     to share the core, not a behavior change).
--
-- Owner-only, per 063: resetting a game is destructive; the burden of proof is on
-- WIDENING destructive capability, so delegates are not granted reset.
--
-- THE BEHAVIOR-CRITICAL DETAIL (carried verbatim from 063): the clears are split.
-- The DELETEs (results/scores, and in skeleton the pairing/roster/foursome rows)
-- run UNCONDITIONALLY by game_id — incl. dropped games. The games-ROW UPDATEs
-- (status/corrections, and the config columns + the §E-1 point-value CASE) are
-- gated `status <> 'dropped'`, so a dropped game keeps its dropped status and
-- (in skeleton) its config columns. The per-game cores reproduce that split
-- exactly; a uniform clear would change 063's behavior and fail its regression.
--
-- §E-1 (per-match point value survives skeleton): the survives-logic is a per-ROW
-- CASE on points_distribution — it carries to the per-game core unchanged
-- (scoping the row UPDATE to id = $1 doesn't touch the CASE).

-- ── Per-game owner guard ─────────────────────────────────────────────────────
-- Resolves the game's TRIP (games.trip_id — always present) and asserts the
-- caller is that trip's Owner. Deliberately NOT routed through
-- assert_competition_owner: games.competition_id is NULLABLE (migration 056,
-- ON DELETE SET NULL) — a standalone game, or a game whose competition was
-- deleted, has no competition, so a game→competition→trip chain would break.
-- trip_id covers competition and non-competition games alike. Reuses
-- assert_competition_owner's owner-check MECHANISM, not its signature.
CREATE OR REPLACE FUNCTION public.assert_game_owner(p_game_id text)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
AS $$
DECLARE
  v_trip_id text;
BEGIN
  SELECT trip_id INTO v_trip_id FROM public.games WHERE id = p_game_id;

  IF v_trip_id IS NULL THEN
    RAISE EXCEPTION 'Game % not found', p_game_id USING ERRCODE = 'P0002';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.trip_members tm
    WHERE tm.trip_id = v_trip_id
      AND tm.user_id = (auth.uid())::text
      AND tm.role = 'Owner'
  ) THEN
    RAISE EXCEPTION 'Only the trip owner can reset a game' USING ERRCODE = '42501';
  END IF;
END;
$$;

-- ── Un-guarded core: scoring ─────────────────────────────────────────────────
-- Clears ONE game's SCORING bucket; keeps config + identity; keeps scoring_enabled
-- (the game stays armed). DELETEs unconditional; games-row UPDATE skips dropped.
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
  -- scoring_enabled KEPT (re-scoreable). A dropped game stays dropped.
  UPDATE public.games
    SET status = 'pending', corrections_open = false
    WHERE id = p_game_id AND status <> 'dropped';
END;
$$;

-- ── Un-guarded core: skeleton ────────────────────────────────────────────────
-- SUPERSET of scoring (CALLS it), then clears ONE game's CONFIG bucket, leaving
-- the identity shell. scoring_enabled → false (un-armed). Per-match point VALUE
-- survives (§E-1): placement games clear only the split (points_distribution →
-- NULL); a per-match distribution holds the value itself, so it is kept.
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
    WHERE id = p_game_id AND status <> 'dropped';
END;
$$;

-- ── Owner-guarded public wrappers ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reset_game_scoring(p_game_id text)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
AS $$
BEGIN
  PERFORM public.assert_game_owner(p_game_id);
  PERFORM public._reset_game_scoring(p_game_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.reset_game_to_skeleton(p_game_id text)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
AS $$
BEGIN
  PERFORM public.assert_game_owner(p_game_id);
  PERFORM public._reset_game_to_skeleton(p_game_id);
END;
$$;

-- ── Competition functions: REFACTORED to guard-once + loop the core ──────────
-- Same external behavior as 063; internal refactor to share the per-game core.
-- The owner guard runs ONCE (not per game); the loop drives the un-guarded core.
-- The loop selects ALL games (incl. dropped) and the core self-skips dropped on
-- its games-row UPDATEs — reproducing 063's split exactly.
CREATE OR REPLACE FUNCTION public.reset_competition_scoring(p_trip_id text, p_competition_id text)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
AS $$
DECLARE
  v_game_id text;
BEGIN
  PERFORM public.assert_competition_owner(p_trip_id, p_competition_id);

  FOR v_game_id IN
    SELECT id FROM public.games WHERE competition_id = p_competition_id
  LOOP
    PERFORM public._reset_game_scoring(v_game_id);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.reset_competition_to_skeleton(p_trip_id text, p_competition_id text)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
AS $$
DECLARE
  v_game_id text;
BEGIN
  -- Guard ONCE here (no longer via reset_competition_scoring — that would
  -- double-guard). The scoring-clear nesting now lives in the per-game core
  -- (_reset_game_to_skeleton calls _reset_game_scoring).
  PERFORM public.assert_competition_owner(p_trip_id, p_competition_id);

  FOR v_game_id IN
    SELECT id FROM public.games WHERE competition_id = p_competition_id
  LOOP
    PERFORM public._reset_game_to_skeleton(v_game_id);
  END LOOP;
END;
$$;

-- ── Grants ───────────────────────────────────────────────────────────────────
-- Wrappers + the guard helper to authenticated. The un-guarded cores are locked
-- to DEFINER context (the wrappers call them as the owner): they must be callable
-- by NO client role.
--
-- ⚠ CRITICAL: Supabase's default privileges auto-GRANT EXECUTE on every new
-- public function to PUBLIC + anon + authenticated + service_role. So revoking
-- only `authenticated` leaves the core callable by anon AND via the PUBLIC grant
-- (authenticated inherits PUBLIC) — a direct-PostgREST bypass of the owner gate.
-- The cores must be revoked FROM PUBLIC, anon, authenticated (service_role is the
-- trusted backend key and may keep it). The DEFINER wrappers run as the function
-- owner, so they reach the cores regardless of the cores' client grants.
GRANT EXECUTE ON FUNCTION public.assert_game_owner(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reset_game_scoring(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reset_game_to_skeleton(text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public._reset_game_scoring(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._reset_game_to_skeleton(text) FROM PUBLIC, anon, authenticated;
