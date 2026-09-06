-- ════════════════════════════════════════════════════════════════════════════
-- 181 · Scramble: the game type, and a play_group that can hold a score
--       WITHOUT being a side of a match
--
-- Scramble is stroke play where the TEAM is the scorer. There is no individual
-- level — not hidden, not aggregated. Strokes are entered, totalled and ranked
-- exactly as stroke play does; what changes is WHOSE a score is.
--
-- ── Why this needs a migration at all, when storage was already permissive ──
--
-- `score_entries` was built polymorphic from the spine (033):
--
--     participant_id   text NOT NULL          -- no FK, deliberately
--     participant_type text NOT NULL CHECK (participant_type IN ('user','play_group'))
--
-- So a group-owned score is a legal ROW today, with no referential integrity to
-- fight and no new column. The blocker is the WRITE: `can_score_unit`'s
-- play_group branch (072, replaced by 090) resolves entirely through
-- `game_matches`, and 090's own comment says so — "they resolve via
-- `game_matches`, which rack/stroke don't have". A scramble game is stroke play
-- and has no matches, so that EXISTS can never be true and every member is
-- refused. The row would be legal; the write denied.
--
-- ── Gated BY GAME TYPE, which is 090's lesson applied rather than restated ───
--
-- The tempting form is an unconditional `OR caller is a member of the target
-- group`. It looks harmless — a member writing their own group's score — and it
-- is exactly the shape 090 was written to remove. 072 inferred "rack" from the
-- target merely HAVING a play_group_id; migration 089 then made stroke
-- groupings mandatory, the inference silently widened, and a stroke cart-mate
-- could score somebody else's individual row. A real permission leak, created
-- by a structural inference that was true when written.
--
-- So this asks the game what it IS. For any game that is not scramble the
-- branch is not reached and the 2v2 rule below is untouched, byte for byte.
--
-- Note this is narrower than the 2v2 rule it sits beside, not wider: a 2v2
-- caller may score EITHER side of their match (both pairs share one card), while
-- a scramble caller may score only the group they are in.
--
-- Owner / Organizer / game delegate are unaffected either way — the
-- `score_entries_write` policy (136) admits them ahead of `can_score_unit`, so
-- this function only ever decides whether an ordinary MEMBER may write.
--
-- ── The template row is required, not decoration ────────────────────────────
--
-- `games.game_type_id` is `REFERENCES public.game_type_templates(id)` (033), so
-- a scramble game cannot be inserted until this row exists. That is why the type
-- ships in the migration and not only in the client catalog (`gameTypes.ts`),
-- and it is why this lands BEFORE the code that creates such a game — the
-- additive ordering the Migration Workflow prescribes.
--
-- The guard above references 'gtt_scramble' before any game can hold it. That is
-- deliberate and inert: no row matches, so the branch cannot fire until the
-- client half ships.
--
-- `result_strategy` is 'stroke_total' — the SAME engine, so `games.finish`
-- dispatches to the shipped stroke arm with nothing added. The novelty is which
-- participant the scores hang off, which is not something `result_strategy`
-- names. `entry_schema` is 'group_holes' rather than stroke's 'user_holes';
-- nothing in the app reads that column (one comment in `StrokeKeypad` mentions
-- it), so it is descriptive, and describing it honestly costs nothing.
--
-- `compatible_competition_formats` is `free_for_all`, matching stroke play:
-- scramble belongs to a POINTS competition, and match play's `ryder_cup` value
-- is what rack and match carry. The BBMI "Day 1 Scramble" is a different thing
-- entirely — a match-play game whose NAME is Scramble, sides being play_groups
-- — and nothing here touches it.
--
-- Idempotent: ON CONFLICT DO UPDATE on the template, CREATE OR REPLACE on the
-- function. Replays cleanly from zero.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1 · The game type ───────────────────────────────────────────────────────

INSERT INTO public.game_type_templates (
  id, key, name, description, sort_order,
  entry_schema, result_strategy,
  supports_free_for_all, supports_sides, requires_sides,
  compatible_competition_formats, compatible_modifiers,
  config_schema, scorecard_schema
)
VALUES (
  'gtt_scramble', 'scramble', 'Scramble',
  'Team stroke play — everyone tees off, the team plays the best ball each shot, and one score per team is entered. Lowest total wins.', 3,
  'group_holes', 'stroke_total',
  true, false, false,
  ARRAY['free_for_all']::text[], ARRAY[]::text[],
  '{}'::jsonb,
  '{
    "units": {
      "type": "holes", "count": 18, "ordered": true,
      "labels": ["1","2","3","4","5","6","7","8","9","10","11","12","13","14","15","16","17","18"],
      "metadata": { "par": [4,5,3,4,4,3,5,4,4,4,3,5,4,4,3,4,5,4] }
    },
    "entry": { "value_type": "integer", "value_label": "Strokes", "min": 1, "max": null },
    "scoring": {
      "strategy": "stroke_total", "direction": "low_wins", "aggregation": "sum",
      "sections": [
        { "name": "Front 9", "units": ["1","2","3","4","5","6","7","8","9"] },
        { "name": "Back 9", "units": ["10","11","12","13","14","15","16","17","18"] }
      ],
      "tiebreaker": "shared"
    },
    "participants": { "min": 2, "max": null, "participant_type": "team", "assigned_pairings": false },
    "interaction": { "model": "simultaneous", "entry_timing": "per_unit" }
  }'::jsonb
)
ON CONFLICT (id) DO UPDATE SET
  key = EXCLUDED.key,
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  sort_order = EXCLUDED.sort_order,
  entry_schema = EXCLUDED.entry_schema,
  result_strategy = EXCLUDED.result_strategy,
  supports_free_for_all = EXCLUDED.supports_free_for_all,
  supports_sides = EXCLUDED.supports_sides,
  requires_sides = EXCLUDED.requires_sides,
  compatible_competition_formats = EXCLUDED.compatible_competition_formats,
  compatible_modifiers = EXCLUDED.compatible_modifiers,
  config_schema = EXCLUDED.config_schema,
  scorecard_schema = EXCLUDED.scorecard_schema;

-- ── 2 · A group may hold a score when the group IS the unit ─────────────────
--
-- Body is 090's, with ONE branch added at the top of the play_group arm. Every
-- other line is unchanged and is reproduced here because the function is
-- replaced wholesale.

CREATE OR REPLACE FUNCTION public.can_score_unit(
  p_game_id text,
  p_participant_id text,
  p_participant_type text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me text := (auth.uid())::text;
  v_my_pg text;
  v_target_pg text;
BEGIN
  IF me IS NULL THEN
    RETURN false;
  END IF;

  IF p_participant_type = 'play_group' THEN
    -- SCRAMBLE (181), BY GAME TYPE: the team is the scoring unit and the game
    -- has no matches, so the 2v2 rule below can never admit anyone. A member of
    -- the group may write its score — and only that group's, which is narrower
    -- than the 2v2 rule beneath it.
    IF (SELECT game_type_id FROM games WHERE id = p_game_id) = 'gtt_scramble' THEN
      RETURN EXISTS (
        SELECT 1
        FROM game_participants gp
        WHERE gp.game_id = p_game_id
          AND gp.user_id = me
          AND gp.play_group_id = p_participant_id
      );
    END IF;

    -- 2v2: participant is a SIDE (play_group). The caller must be in a play_group
    -- that is a side of the match containing that side (either side = same card).
    RETURN EXISTS (
      SELECT 1
      FROM game_matches gm
      JOIN game_participants gp
        ON gp.game_id = gm.game_id AND gp.user_id = me
      WHERE gm.game_id = p_game_id
        AND (gm.side_a->>'id' = p_participant_id OR gm.side_b->>'id' = p_participant_id)
        AND gp.play_group_id IN (gm.side_a->>'id', gm.side_b->>'id')
    );
  END IF;

  -- participant_type = 'user'

  -- 1v1: participant is a user-side of a match → the caller must be a user-side
  -- of that same match (their own match, both players).
  IF EXISTS (
    SELECT 1 FROM game_matches gm
    WHERE gm.game_id = p_game_id
      AND ((gm.side_a->>'type' = 'user' AND gm.side_a->>'id' = p_participant_id)
        OR (gm.side_b->>'type' = 'user' AND gm.side_b->>'id' = p_participant_id))
  ) THEN
    RETURN EXISTS (
      SELECT 1 FROM game_matches gm
      WHERE gm.game_id = p_game_id
        AND (gm.side_a->>'id' = p_participant_id OR gm.side_b->>'id' = p_participant_id)
        AND (gm.side_a->>'id' = me OR gm.side_b->>'id' = me)
    );
  END IF;

  -- rack (BY GAME TYPE, 090): the target user is in a play_group (cart) → the caller
  -- must share it. Gated on the game being rack, NOT merely on the target being grouped —
  -- stroke is grouped now too, and must fall through to the individual rule below.
  IF (SELECT game_type_id FROM games WHERE id = p_game_id) = 'gtt_rack_n_stack' THEN
    SELECT play_group_id INTO v_target_pg
    FROM game_participants
    WHERE game_id = p_game_id AND user_id = p_participant_id;
    IF v_target_pg IS NULL THEN
      RETURN false; -- an ungrouped rack target isn't a scorable unit for a member
    END IF;
    SELECT play_group_id INTO v_my_pg
    FROM game_participants
    WHERE game_id = p_game_id AND user_id = me;
    RETURN v_my_pg IS NOT NULL AND v_my_pg = v_target_pg;
  END IF;

  -- stroke (and any other non-match, non-rack user unit): the unit is the individual.
  -- The caller scores only their own row, and must be a participant — regardless of
  -- which group they're in.
  RETURN p_participant_id = me AND EXISTS (
    SELECT 1 FROM game_participants WHERE game_id = p_game_id AND user_id = me
  );
END;
$$;

COMMENT ON FUNCTION public.can_score_unit(text, text, text) IS
  'Which unit an ordinary MEMBER may write a score for. Owner/Organizer/delegate bypass this entirely (see the score_entries_write policy). Branches BY GAME TYPE where the unit is not the individual: gtt_scramble (the play_group IS the unit, members of it may write it) and gtt_rack_n_stack (the cart is the unit, cart-mates may write each other). Match play resolves through game_matches. Everything else is individual-scoped. Migration 181 added the scramble branch; 090 the rack one.';
