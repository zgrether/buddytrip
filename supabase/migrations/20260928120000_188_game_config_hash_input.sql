-- 188 · game_config_hash_input — the configHash's eight reads as ONE call.
--
-- `readGameConfigHash` (src/server/routers/games.ts) fingerprints a game's
-- config from eight parallel PostgREST reads. It backs the ~20s configHash poll
-- on every open game view (CLAUDE.md #16/#19) AND saveConfig's
-- optimistic-concurrency check. Measured over BBMI 2026: about 1,200 polling
-- calls a day, each 8 reads plus the membership check, so ~9 Supabase requests
-- per call and ~10.8k a day. This returns the SAME data as one jsonb document,
-- so a call is 2 requests (the gate plus this).
--
-- ── What this is NOT ────────────────────────────────────────────────────────
-- It does not compute the hash. The fingerprint is still `computeConfigHash`
-- over this document, in JS, in the one place both consumers call — so the poll
-- and the concurrency check cannot disagree, and a hash an open client already
-- holds stays valid across the deploy (pinned by a parity test against the
-- PostgREST reads it replaces).
--
-- ── SECURITY INVOKER, deliberately (CLAUDE.md #28) ──────────────────────────
-- The reads it replaces ran through the CALLER's client, under RLS. This runs
-- as the caller too, so every table's own SELECT policy still decides what
-- comes back, and a non-member gets `game: null` exactly as the `games` read
-- returned no row. A DEFINER version would be a container-fact helper — the
-- category #28 says must not exist ungated.
--
-- ── The column lists are a contract ─────────────────────────────────────────
-- Each object below lists exactly `HASH_COLS[table]` (games.ts). The coverage
-- guard (`configHash.coverage.test.ts`) asserts the keys this function returns
-- per table equal HASH_COLS, and HASH_COLS against the live schema, so a column
-- added to a hashed table has to be classified AND added here, or CI fails.
--
-- ── Ordering is part of the hash (#16) ──────────────────────────────────────
-- Every list keeps the total order the PostgREST reads used: participants and
-- delegates by user_id, groups and matches by id, entrants by seed with members
-- by user_id, the draw by (bracket, round, slot).

CREATE OR REPLACE FUNCTION public.game_config_hash_input(p_trip_id text, p_game_id text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO ''
AS $$
  SELECT jsonb_build_object(
    'game', (
      SELECT jsonb_build_object(
        'name', g.name,
        'status', g.status,
        'game_type_id', g.game_type_id,
        'config', g.config,
        'modifiers', g.modifiers,
        'rules_for_today', g.rules_for_today,
        'scorecard_schema', g.scorecard_schema,
        'tee_time', g.tee_time,
        'points_distribution', g.points_distribution,
        'points_total', g.points_total,
        'competition_format', g.competition_format,
        'scoring_enabled', g.scoring_enabled,
        'course_id', g.course_id,
        'back_course_id', g.back_course_id,
        'corrections_open', g.corrections_open,
        'pairings_published_at', g.pairings_published_at,
        'entry_mode', g.entry_mode,
        'bracket_config', g.bracket_config
      )
      FROM public.games g
      WHERE g.id = p_game_id AND g.trip_id = p_trip_id
    ),
    'participants', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'user_id', p.user_id,
        'play_group_id', p.play_group_id,
        'team_id', p.team_id,
        'handicap_strokes', p.handicap_strokes
      ) ORDER BY p.user_id)
      FROM public.game_participants p
      WHERE p.game_id = p_game_id
    ), '[]'::jsonb),
    'groups', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', pg.id,
        'display_name', pg.display_name,
        'handicap_strokes', pg.handicap_strokes,
        'tee_time', pg.tee_time
      ) ORDER BY pg.id)
      FROM public.play_groups pg
      WHERE pg.game_id = p_game_id
    ), '[]'::jsonb),
    'matches', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', m.id,
        'play_group_id', m.play_group_id,
        'match_number', m.match_number,
        'display_order', m.display_order,
        'side_a', m.side_a,
        'side_b', m.side_b,
        'point_value', m.point_value
      ) ORDER BY m.id)
      FROM public.game_matches m
      WHERE m.game_id = p_game_id
    ), '[]'::jsonb),
    'delegates', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('user_id', d.user_id) ORDER BY d.user_id)
      FROM public.game_delegates d
      WHERE d.game_id = p_game_id
    ), '[]'::jsonb),
    'bracketEntrants', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'seed', e.seed,
        'team_id', e.team_id,
        'bracket_entrant_members', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('user_id', em.user_id) ORDER BY em.user_id)
          FROM public.bracket_entrant_members em
          WHERE em.entrant_id = e.id
        ), '[]'::jsonb)
      ) ORDER BY e.seed)
      FROM public.bracket_entrants e
      WHERE e.game_id = p_game_id
    ), '[]'::jsonb),
    'bracketDraw', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'bracket', bm.bracket,
        'round', bm.round,
        'slot', bm.slot,
        'entrant_a_id', bm.entrant_a_id,
        'entrant_b_id', bm.entrant_b_id
      ) ORDER BY bm.bracket, bm.round, bm.slot)
      FROM public.bracket_matches bm
      WHERE bm.game_id = p_game_id
    ), '[]'::jsonb),
    'pickem', (
      SELECT jsonb_build_object('roll_up', pk.roll_up, 'use_confidence', pk.use_confidence)
      FROM public.pickem_games pk
      WHERE pk.game_id = p_game_id
    )
  );
$$;

COMMENT ON FUNCTION public.game_config_hash_input(text, text) IS
  'The configHash input document: the eight reads readGameConfigHash made, as one jsonb. The hash itself is still computed in JS. SECURITY INVOKER so RLS decides exactly as it did for the PostgREST reads (CLAUDE.md #28). Column lists must equal HASH_COLS in games.ts; configHash.coverage.test.ts enforces it (migration 188).';

REVOKE ALL ON FUNCTION public.game_config_hash_input(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.game_config_hash_input(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.game_config_hash_input(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.game_config_hash_input(text, text) TO service_role;
