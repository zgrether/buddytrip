-- ════════════════════════════════════════════════════════════════════════════
-- 116 · bracket_entrants.team_id becomes NULLABLE
--
-- Reverses one decision from migration 112, which declared `team_id text NOT
-- NULL` and reasoned: "an entrant belongs to exactly one cup team, so its points
-- land on one team. In 2v2 that is what 'a partner must be on the same cup team'
-- MEANS structurally."
--
-- That reasoning is still correct FOR A COMPETITION-ATTACHED BRACKET, and
-- nothing about it is being abandoned. What it missed is that a bracket does not
-- have to be attached to one. A STANDALONE game — cornhole at a bar with no trip
-- and no cup — is a shape this app already supports for other formats (~40% of
-- production games are standalone, per migration 096's note), and it has no
-- teams for an entrant to belong to. Under 112's column such a bracket cannot be
-- represented at all.
--
-- ── Why relax it NOW, when nothing standalone ships yet ────────────────────
-- Because the two directions cost wildly different amounts. Relaxing a NULL
-- constraint later means a migration against a table that by then holds real
-- brackets; permitting NULL now and refusing it in the application is one guard
-- to delete when standalone brackets are built. The schema is the expensive
-- layer to change and the application is the cheap one, so the constraint that
-- is genuinely a PRODUCT-SCOPE decision ("we haven't built standalone brackets
-- yet") belongs in the cheap layer, not the expensive one.
--
-- This is the same split CLAUDE.md's Schema Cleanup Rule protects from the other
-- side: the database enforces what must be true of the DATA, and a rule that is
-- really about what we have chosen to build so far is not that.
--
-- ── The refusal that replaces it, and where it lives ───────────────────────
-- `games.saveConfig`'s zod refinement refuses an entrant with a null team, in
-- the tRPC front door — NOT in `save_game_config`. Deliberate: the RPC's guards
-- are data-integrity invariants that must hold whatever the caller is, and this
-- is not one. It is "we have not built that yet", which is exactly the kind of
-- rule that should sit in the layer that changes when we do build it. When
-- standalone brackets ship, that refinement is the one thing to remove and this
-- column is already ready.
--
-- No data migration and no backfill: relaxing NOT NULL cannot invalidate an
-- existing row, and every bracket_entrants row today already has a team.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.bracket_entrants ALTER COLUMN team_id DROP NOT NULL;

COMMENT ON COLUMN public.bracket_entrants.team_id IS
  'The cup team this entrant''s result lands on. NULL means a STANDALONE bracket '
  '(no competition, so no teams) — permitted by the schema, currently refused by '
  'games.saveConfig''s zod refinement because standalone brackets are not built '
  'yet. For a competition-attached bracket this is what makes 2v2 partners share '
  'a team structurally: one entrant, one team_id, so a pairing cannot span two.';
