-- 148 — pick'em Phase 2: the format's registration, its two scoring settings,
--       and the one atomic write behind the slate modal.
--
-- ══ Why the settings live beside the slate, on one surface ══════════════════
--
-- Spec §4 names the first lock point: picks opening freezes "the slate, its
-- order, spreads, game times, multipliers, and every setting that changes what a
-- pick means (`roll_up`, `use_confidence`)."
--
-- Everything in that sentence locks at the SAME INSTANT for the SAME REASON — a
-- sheet has already been filled in, and any of these changes what it is worth.
-- Things that share a lock point belong on one surface with one atomic save, so
-- `save_pickem_config` commits the slate and both settings together or commits
-- neither. That is CLAUDE.md #18's principle (one atomic commit per surface,
-- nothing self-persisting per row) applied to a surface `save_game_config` does
-- not own.
--
-- It is deliberately NOT an arm of `save_game_config`. That function is ~700
-- lines and has to be re-declared in full to change, and pick'em's config lives
-- in its own tables rather than in `games` columns — so an arm there would buy
-- nothing and cost a full-body transcription of a function that runs inside
-- every settings save in the app.
--
-- ══ THE SLATE IS UPSERTED, NEVER CLEAN-REPLACED ═════════════════════════════
--
-- This is the load-bearing decision in this migration and it is not obvious.
--
-- `save_game_config` clean-replaces `game_matches` when their structure is
-- dirty, and copying that here would be a data-loss bug: `pickem_picks` has
-- `FOREIGN KEY (slate_game_id, game_id) … ON DELETE CASCADE`, so deleting and
-- re-inserting slate rows with fresh ids DESTROYS EVERY PICK.
--
-- While `building` that is harmless — the picks policy refuses writes before
-- picks open, so there are none. **Reopen the slate is what makes it fatal.**
-- Reopening returns a game with a full field of submitted sheets to `building`,
-- and the spec's stated consequence is that everyone *re-ranks* — not that
-- everyone loses their winners. A clean-replace would silently deliver the
-- harsher outcome, and it would look like it worked.
--
-- So: rows are upserted BY ID, and only rows the payload genuinely dropped are
-- deleted. A game that survives a reopen keeps its picks; a game the runner
-- actually removes takes its picks with it, which is correct and is the only
-- deletion here.
--
-- ══ What this does not do ═══════════════════════════════════════════════════
--
--   * No optimistic-concurrency `baseHash` (CLAUDE.md #18's other half). The
--     slate has exactly one editor by construction — `assert_game_edit` — and
--     the spec asks for no concurrency control. Recorded as a known gap rather
--     than silently skipped: two delegates editing one slate simultaneously
--     will have last-write-win.
--   * No results, no lock point 2. Phase 5.

-- ── The format's row ───────────────────────────────────────────────────────
--
-- `games.game_type_id` has an FK to this table, so pick'em is uncreatable
-- without it. The table is otherwise legacy — `src/lib/gameTypes.ts` is the
-- home of record for what a format MEANS (W-PERF-01) and this row carries only
-- what the FK needs.
INSERT INTO public.game_type_templates (id, key, name, description, category, sort_order)
VALUES (
  'gtt_pickem', 'pickem', 'Pick''em',
  'Everyone picks winners from a slate of real-world games. A correct pick scores its confidence rank times the game''s multiplier.',
  'other', 95
)
ON CONFLICT (id) DO NOTHING;

-- ── The two scoring settings ───────────────────────────────────────────────
ALTER TABLE public.pickem_games
  ADD COLUMN IF NOT EXISTS roll_up text NOT NULL DEFAULT 'team_totals',
  ADD COLUMN IF NOT EXISTS use_confidence boolean NOT NULL DEFAULT true;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'pickem_games_roll_up_check'
       AND conrelid = 'public.pickem_games'::regclass
  ) THEN
    ALTER TABLE public.pickem_games
      ADD CONSTRAINT pickem_games_roll_up_check
      CHECK (roll_up IN ('team_totals', 'individual_matches'));
  END IF;
END $$;

COMMENT ON COLUMN public.pickem_games.roll_up IS
  'team_totals (default) — every sheet sums into its side''s number, higher total takes the game''s points. individual_matches — each participant faces one person from the other side, game points divided by VALID matches. Only meaningful under a match_play competition; a points competition always rolls up as team totals across N teams and does not render the setting (spec §2.1).';
COMMENT ON COLUMN public.pickem_games.use_confidence IS
  'On: participants rank 1..N and a correct pick scores its rank. Off: every pick is worth 1 and the ranking pass DOES NOT EXIST — absent, not disabled. Scoring never branches on this; it sets the confidence term to 1 (spec §2.2).';

-- ── save_pickem_config — the modal's one write ─────────────────────────────
--
-- Payload shape (both keys optional; absent means "leave alone", which is what
-- lets the settings and the slate be saved independently later without a second
-- function):
--
--   {
--     "settings": { "rollUp": "team_totals", "useConfidence": true },
--     "slate": [
--       { "id": "…", "awayTeam": "Alabama", "homeTeam": "Georgia",
--         "spread": "-3.5", "kickoff": "Thu 7:30p", "note": null,
--         "multiplier": 2 }
--     ]
--   }
--
-- `slate` is the WHOLE list in display order; `display_order` is derived from
-- array position, so the client never computes an ordinal and two rows cannot
-- claim the same slot.
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

  -- The slate and both settings are frozen the moment picks open. Checked here
  -- rather than trusted from the client, and expressed through the SAME
  -- predicate the RLS policies use so there is no second definition of "open"
  -- on the server either.
  SELECT EXISTS (
    SELECT 1 FROM public.pickem_games pg
     WHERE pg.game_id = p_game_id
       AND pg.picks_opened_at IS NOT NULL
  ) INTO v_locked;

  IF v_locked THEN
    RAISE EXCEPTION 'SLATE_LOCKED: picks are open, so the slate and its scoring settings are frozen. Reopen the slate first — everyone will have to re-rank.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- A pick'em game must have its config row before anything can be saved into
  -- it. Created here rather than at game-creation time so a game that switches
  -- format later still works.
  INSERT INTO public.pickem_games (game_id) VALUES (p_game_id)
  ON CONFLICT (game_id) DO NOTHING;

  IF p_payload ? 'settings' THEN
    UPDATE public.pickem_games
       SET roll_up = COALESCE(p_payload -> 'settings' ->> 'rollUp', roll_up),
           use_confidence = COALESCE((p_payload -> 'settings' ->> 'useConfidence')::boolean, use_confidence)
     WHERE game_id = p_game_id;
  END IF;

  IF p_payload ? 'slate' THEN
    -- UPSERT, never clean-replace — see the header. Survivors keep their ids,
    -- so they keep their picks.
    SELECT COALESCE(array_agg(elem ->> 'id'), ARRAY[]::text[])
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
  END IF;
END;
$$;

COMMENT ON FUNCTION public.save_pickem_config(text, jsonb) IS
  'The pick''em slate modal''s single atomic write: the slate and the two scoring settings commit together or not at all, because spec §4 freezes all of them at the same instant for the same reason. UPSERTS slate rows by id and deletes only genuinely-removed ones — a clean-replace would cascade-delete every pick through pickem_picks'' FK, which is harmless while building and destroys a full field of sheets after Reopen the slate (migration 148).';

REVOKE ALL ON FUNCTION public.save_pickem_config(text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_pickem_config(text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.save_pickem_config(text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_pickem_config(text, jsonb) TO service_role;

-- ── open / lock / reopen — the three lifecycle transitions ─────────────────
--
-- Separate from the config save because they are a different act: the config
-- save is "what the game IS", these are "where it is". Bundling them would mean
-- a Save could publish a slate as a side effect of a typo fix.
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
    -- Back to `building`. Picks SURVIVE (see the upsert note above) — what the
    -- runner is told, and what the spec states, is that everyone re-ranks.
    UPDATE public.pickem_games
       SET picks_opened_at = NULL, picks_locked_at = NULL
     WHERE game_id = p_game_id;

  ELSE
    RAISE EXCEPTION 'BAD_ACTION: expected open, lock or reopen' USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.set_pickem_phase(text, text, timestamptz) IS
  'The three pick''em lifecycle transitions — open (refuses an empty slate), lock (the manual "Lock picks now"), reopen (back to building; picks survive, rankings are invalidated). Kept apart from save_pickem_config because publishing a slate must never be a side effect of saving an edit to it (migration 148).';

REVOKE ALL ON FUNCTION public.set_pickem_phase(text, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_pickem_phase(text, text, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_pickem_phase(text, text, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_pickem_phase(text, text, timestamptz) TO service_role;
