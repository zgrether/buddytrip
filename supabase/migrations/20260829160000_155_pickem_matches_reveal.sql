-- 155 — a member can read a pick'em game's matches once picks are revealed.
--
-- Phase 4 §5: "participants see matches when picks lock. Not before, and there
-- is no separate publish step. The lock is the reveal."
--
-- ══ Without this, the reveal shows nothing ══════════════════════════════════
--
-- `game_matches_select` reads:
--
--     is_trip_member(g.trip_id)
--     AND (g.scoring_enabled = true OR staff)
--
-- `scoring_enabled` is match play's go-live, and PICK'EM NEVER SETS IT —
-- migration 135's CHECK refuses the state picks-open occupies, which is the
-- whole reason `FORMAT_SURFACE.pickem.gameState` is false. So for a pick'em
-- game that clause is permanently false and a plain member can never read its
-- matches AT ALL, before or after the lock.
--
-- The UI would have rendered the matches panel at the reveal and the member
-- would have seen an empty one — the payload filtered away underneath it, with
-- nothing erroring. Found by reading the policy rather than by testing the
-- surface as an owner, which is the account every check so far has used.
--
-- ══ Why the reveal belongs HERE and not only in the client ═════════════════
--
-- The same reasoning as migration 146's slate rule. The component is the polite
-- half; a member who reads `/rest/v1/game_matches` directly must learn nothing
-- either. Putting the reveal in the policy also means the client and the API
-- cannot disagree about when it happens — both now key on
-- `pickem_picks_revealed`, the ONE predicate, which `pickemLifecycleParity`
-- already pins against its TypeScript twin.
--
-- ══ Scoped to pick'em, additive, grants nothing else ═══════════════════════
--
-- The new arm requires `game_type_id = 'gtt_pickem'`, so no other format's
-- visibility changes by a single row. For pick'em it grants exactly the reveal:
-- before the lock a member reads nothing (the staff arm still serves the runner
-- building the pairing), after it they read the matches.
--
-- `pickem_picks_revealed` checks trip membership internally (migration 147), so
-- the outer `is_trip_member` is redundant with it — kept because it guards the
-- other arms and removing it would make this policy's safety depend on a
-- function it merely happens to call.

DROP POLICY IF EXISTS game_matches_select ON public.game_matches;
CREATE POLICY game_matches_select ON public.game_matches
  FOR SELECT
  USING (EXISTS (
    SELECT 1
      FROM public.games g
     WHERE g.id = game_matches.game_id
       AND public.is_trip_member(g.trip_id)
       AND (
         g.scoring_enabled = true
         OR public.has_trip_role(g.trip_id, ARRAY['Owner'::text, 'Organizer'::text])
         OR public.is_game_delegate(g.id)
         -- Pick'em's reveal. The lock IS the reveal (§5) — one gate, no publish
         -- step, no `matches_published_at`.
         OR (g.game_type_id = 'gtt_pickem' AND public.pickem_picks_revealed(g.id))
       )
  ));

COMMENT ON POLICY game_matches_select ON public.game_matches IS
  'Trip members read a game''s matches once it is scoring, or always if they are staff/delegate. Pick''em adds a fourth arm: its matches become readable at pickem_picks_revealed, because pick''em never sets scoring_enabled (migration 135 refuses that state) and would otherwise hide its matches from members forever — including after the lock, which is exactly when §5 says they must appear (migration 155).';
