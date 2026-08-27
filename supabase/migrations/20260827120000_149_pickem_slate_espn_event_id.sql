-- 149 — a slate game remembers which real-world contest it came from.
--
-- Phase 2b. `pickem_slate_games.espn_event_id` is provenance: set when a row was
-- filled from the matchup search, NULL when the runner typed it. Nothing scores
-- from it and nothing requires it.
--
-- ══ Why store it at all, when nothing reads it for scoring ══════════════════
--
-- Two reasons, one of them immediate:
--
--   1. **Dedupe, now.** Searching "Ohio State" and then "Michigan" surfaces the
--      SAME game from both sides. Without an id the second add is a plausible
--      duplicate — same two teams, same kickoff — that nobody notices until a
--      participant is asked to rank sixteen games and finds seventeen. The
--      client already hides a taken game, but the client is not authoritative
--      and a reload has to know too; this is what survives the reload.
--   2. **The hook if results are ever pulled rather than typed.** Not built,
--      not promised — but an id costs nothing today and cannot be recovered
--      later from "Alabama at Georgia" plus a kickoff a runner may have edited.
--
-- ══ UNIQUE per game, not globally ═══════════════════════════════════════════
--
-- The same real-world contest can legitimately appear on two different pick'em
-- games — a trip could run a Saturday slate and a season-long one that share a
-- marquee matchup — so the constraint is scoped to `game_id`. Partial, because
-- NULL is the common case (manual entry) and several hand-typed rows must be
-- able to coexist.
--
-- ══ Not validated against anything ══════════════════════════════════════════
--
-- No FK, no format check, no lookup. ESPN is undocumented and unofficial: an id
-- shape could change, and a constraint asserting today's shape would turn their
-- change into our outage. It is an opaque token we hand back to ourselves.

ALTER TABLE public.pickem_slate_games
  ADD COLUMN IF NOT EXISTS espn_event_id text;

COMMENT ON COLUMN public.pickem_slate_games.espn_event_id IS
  'Provenance: the ESPN event id when this row was filled from the matchup search, NULL when typed by hand. Nothing scores from it. Exists to dedupe (the same contest surfaces from both teams'' schedules) and as the hook if results are ever pulled rather than entered. Deliberately unvalidated — ESPN is undocumented, and a CHECK on its id shape would make their change our outage (migration 149).';

CREATE UNIQUE INDEX IF NOT EXISTS uq_pickem_slate_espn_event
  ON public.pickem_slate_games (game_id, espn_event_id)
  WHERE espn_event_id IS NOT NULL;

-- ── save_pickem_config learns the new field ────────────────────────────────
--
-- Re-declared in full (plpgsql has no append). Body is migration 148's with ONE
-- column threaded through the insert and the upsert — the UPSERT-not-clean-
-- replace decision it turns on is unchanged and is re-stated there, because it
-- is the thing most likely to be "simplified" by someone reading this later.
CREATE OR REPLACE FUNCTION public.save_pickem_config(p_game_id text, p_payload jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_locked boolean;
  v_keep text[];
  v_item jsonb;
  v_idx integer := 0;
  v_multiplier numeric;
BEGIN
  PERFORM public.assert_game_edit(p_game_id);

  SELECT EXISTS (
    SELECT 1 FROM public.pickem_games pg
     WHERE pg.game_id = p_game_id
       AND pg.picks_opened_at IS NOT NULL
  ) INTO v_locked;

  IF v_locked THEN
    RAISE EXCEPTION 'SLATE_LOCKED: picks are open, so the slate and its scoring settings are frozen. Reopen the slate first — everyone will have to re-rank.'
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
    -- UPSERT, never clean-replace. `pickem_picks` cascades off these rows, so
    -- delete-and-reinsert destroys every pick — invisible while building (no
    -- picks exist yet) and fatal after Reopen the slate, where the promise is
    -- that everyone RE-RANKS rather than losing their winners.
    SELECT COALESCE(array_agg(elem ->> 'id'), ARRAY[]::text[])
      INTO v_keep
      FROM jsonb_array_elements(p_payload -> 'slate') AS elem;

    DELETE FROM public.pickem_slate_games
     WHERE game_id = p_game_id
       AND NOT (id = ANY (v_keep));

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_payload -> 'slate')
    LOOP
      v_multiplier := COALESCE((v_item ->> 'multiplier')::numeric, 1);
      IF v_multiplier <= 0 THEN
        RAISE EXCEPTION 'BAD_MULTIPLIER: a multiplier must be greater than zero'
          USING ERRCODE = 'check_violation';
      END IF;

      INSERT INTO public.pickem_slate_games
        (id, game_id, display_order, away_team, home_team, spread, kickoff, note, multiplier, espn_event_id)
      VALUES (
        v_item ->> 'id',
        p_game_id,
        v_idx,
        v_item ->> 'awayTeam',
        v_item ->> 'homeTeam',
        NULLIF(v_item ->> 'spread', ''),
        NULLIF(v_item ->> 'kickoff', ''),
        NULLIF(v_item ->> 'note', ''),
        v_multiplier,
        NULLIF(v_item ->> 'espnEventId', '')
      )
      ON CONFLICT (id) DO UPDATE SET
        display_order = EXCLUDED.display_order,
        away_team     = EXCLUDED.away_team,
        home_team     = EXCLUDED.home_team,
        spread        = EXCLUDED.spread,
        kickoff       = EXCLUDED.kickoff,
        note          = EXCLUDED.note,
        multiplier    = EXCLUDED.multiplier,
        espn_event_id = EXCLUDED.espn_event_id;

      v_idx := v_idx + 1;
    END LOOP;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.save_pickem_config(text, jsonb) IS
  'The pick''em slate modal''s single atomic write: the slate and the two scoring settings commit together or not at all, because spec §4 freezes all of them at the same instant for the same reason. UPSERTS slate rows by id and deletes only genuinely-removed ones — a clean-replace would cascade-delete every pick through pickem_picks'' FK, which is harmless while building and destroys a full field of sheets after Reopen the slate (migration 148; espn_event_id threaded through in 149).';
