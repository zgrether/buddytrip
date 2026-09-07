-- ════════════════════════════════════════════════════════════════════════════
-- 183 · Skins: the game type
--
-- Skins is a per-hole contest with carryover, scored by RECORDING WHO WON THE
-- HOLE. A hole is won outright or it is tied; a tie carries that hole's value
-- into the next one. A skin won belongs to the player, and rolls up to their
-- team the way Stableford's individual scores do.
--
-- ── Entry is by outcome, and that is the fact the whole format hangs off ────
--
-- Players pick up once they are out of a hole, so there is very often no score
-- to enter. The group applies strokes in their heads and then says who won. So
-- this format stores NO stroke scores and computes NO handicaps: there is
-- nothing to allot and no `strokedByPlayer`. The `entry_schema` below says
-- `hole_winner` for that reason, and it is honest description rather than
-- behaviour — nothing in the app reads that column (migration 181 established
-- the same for scramble's `group_holes`).
--
-- ── Why this is a NEW result_strategy and not a reuse ───────────────────────
--
-- `stroke_total` sums a number nobody entered. `match_play` is two-sided at
-- every level — `HoleOutcomeResult`, `DecidedHole`'s W/L/H and `matchState`'s
-- A/B leader all are — and skins is up to four players plus Tied. The carryover
-- fold is genuinely new arithmetic: a hole's own value comes from `holeWeight`
-- (glorious doubles the closing holes) and the pot carries WHOLE, so a tied 16
-- makes 17 worth 4 rather than 2.
--
-- Note what this is NOT: `src/lib/sideBets.ts` already has a `skins` bet kind
-- with carryover, and it is not reusable. Its carry is a COUNT of tied holes
-- (`pot = amount * (1 + carried)`), so every hole is worth the same base and
-- "16 ties -> 17 holds 4" is not expressible in it. That is correct for a
-- uniform-stake money bet and wrong for a weighted format, and it is why the
-- engine here is written rather than borrowed.
--
-- ── `glorious_holes` is compatible, and this is the second format to take it ─
--
-- Glorious doubles a HOLE'S VALUE, which is exactly what a skins hole has. The
-- stroke-play definition in `gameTypes.ts` has said "Skins/scramble take
-- `glorious_holes` when built" since it was written; half of that turned out to
-- be wrong (scramble is a stroke total, with no per-hole value to double — see
-- 181) and this half holds.
--
-- ── The row that migration 044 deleted is NOT this one ──────────────────────
--
-- `game_type_templates` carried a pre-engine placeholder keyed `skins`, seeded
-- by migration 024 and deleted by 044 along with three siblings (they had a NULL
-- `result_strategy` and zero references). This is the engine row, with a
-- `gtt_`-prefixed id like every other engine type.
--
-- It reclaims the `skins` KEY, which 044 freed — and the delete below is
-- repeated from 044 rather than trusted, because `key` is UNIQUE and this
-- INSERT's `ON CONFLICT` is on `id`. A surviving placeholder would therefore
-- fail the migration rather than be absorbed by it, and the cost of ruling that
-- out is one statement. It is keyed on the same stable columns 044 used
-- (`key` + the pre-engine `result_strategy IS NULL` marker), so it is
-- replay-safe — on a fresh replay 044 has already removed the row and this
-- deletes nothing — and it cannot touch the engine row below, whose
-- `result_strategy` is `'skins'`.
--
-- `games.game_type_id` is `REFERENCES public.game_type_templates(id)` (033), so
-- a skins game cannot be inserted until this row exists — which is why the type
-- ships in a migration and not only in the client catalog (`gameTypes.ts`), and
-- why this lands BEFORE the code that creates such a game.
--
-- `compatible_competition_formats` is `free_for_all`, matching stroke play and
-- scramble: skins belongs to a POINTS competition. `match_play` is rack's and
-- match's value and is not offered here — skins produces a per-player count, not
-- a per-slot win/halve.
--
-- Idempotent: ON CONFLICT DO UPDATE. Replays cleanly from zero.
-- ════════════════════════════════════════════════════════════════════════════

-- Repeat of 044's guarded delete — see the header. Stable-column keyed, inert on
-- a fresh replay, and structurally unable to match the engine row inserted next.
DELETE FROM public.game_type_templates
 WHERE key = 'skins' AND result_strategy IS NULL;

INSERT INTO public.game_type_templates (
  id, key, name, description, category, sort_order,
  entry_schema, result_strategy,
  supports_free_for_all, supports_sides, requires_sides, max_players_per_side,
  compatible_competition_formats, compatible_modifiers,
  config_schema, scorecard_schema
)
VALUES (
  'gtt_skins', 'skins', 'Skins',
  'Every hole is worth a skin. Win it outright and it is yours; tie it and the pot carries into the next hole. Record who won each hole — no scores, no handicaps. Most skins wins.',
  'golf', 4,
  'hole_winner', 'skins',
  true, false, false, NULL,
  ARRAY['free_for_all']::text[], ARRAY['glorious_holes']::text[],
  '{}'::jsonb,
  '{
    "units": {
      "type": "holes", "count": 18, "ordered": true,
      "labels": ["1","2","3","4","5","6","7","8","9","10","11","12","13","14","15","16","17","18"],
      "metadata": {
        "par": [4,5,3,4,4,3,5,4,4,4,3,5,4,4,3,4,5,4],
        "handicap_index": [7,3,15,1,11,5,17,9,13,8,4,16,2,12,6,18,10,14]
      }
    },
    "entry": { "value_type": "participant", "value_label": "Winner", "min": null, "max": null },
    "scoring": {
      "strategy": "skins", "direction": "high_wins", "aggregation": "sum",
      "sections": [
        { "name": "Front 9", "units": ["1","2","3","4","5","6","7","8","9"] },
        { "name": "Back 9", "units": ["10","11","12","13","14","15","16","17","18"] }
      ],
      "tiebreaker": "shared"
    },
    "participants": { "min": 2, "max": null, "participant_type": "individual", "assigned_pairings": false },
    "interaction": { "model": "simultaneous", "entry_timing": "per_unit" }
  }'::jsonb
)
ON CONFLICT (id) DO UPDATE SET
  key = EXCLUDED.key,
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  sort_order = EXCLUDED.sort_order,
  entry_schema = EXCLUDED.entry_schema,
  result_strategy = EXCLUDED.result_strategy,
  supports_free_for_all = EXCLUDED.supports_free_for_all,
  supports_sides = EXCLUDED.supports_sides,
  requires_sides = EXCLUDED.requires_sides,
  max_players_per_side = EXCLUDED.max_players_per_side,
  compatible_competition_formats = EXCLUDED.compatible_competition_formats,
  compatible_modifiers = EXCLUDED.compatible_modifiers,
  config_schema = EXCLUDED.config_schema,
  scorecard_schema = EXCLUDED.scorecard_schema;
