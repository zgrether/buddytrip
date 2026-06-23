/**
 * Structure/State cache split — the "alive" competition face.
 *
 * Two kinds of competition data change at very different rates, and the app used
 * to fetch them as one blob on every boundary-cross (trip↔live, open/close/reopen
 * a game), which felt like loading a foreign webpage each time:
 *
 *   STRUCTURE — does the competition exist, teams + rosters, the games list, each
 *   game's type/name/config/pairings/course/handicaps. SLOW-changing: only a
 *   structural mutation (create/edit a game, set pairings, a roster/team edit, the
 *   reset primitives, go-live) changes it. Once the cup is built it's ~static.
 *
 *   STATE — scores, match statuses, computed standings. FAST-changing (every score
 *   entry), comparatively small. It has its OWN refresh cadence (the leaderboard's
 *   30s poll / realtime) and must stay fresh.
 *
 * `STRUCTURE_QUERY` is the cache policy for the structure half — load once, KEEP:
 *
 *   - staleTime: Infinity — never refetched by TIME. The only thing that makes a
 *     structure query stale is an explicit invalidation from a structural mutation
 *     (invalidate overrides staleTime and refetches active observers / marks
 *     inactive ones for refetch-on-mount). This is what makes reopen-a-game and
 *     trip↔live INSTANT: a warm remount reads the kept cache, no refetch. (The old
 *     60s default is exactly why structure refetched on every >60s remount.)
 *   - gcTime: 30 min — long enough to OUTLIVE leaving the live face (a trip-page
 *     visit, opening/closing a game) so returning is a cache hit, not a cold load.
 *     (The global default gcTime is 5 min — too short to survive a longer detour.)
 *
 * Apply this ONLY to structure queries. Do NOT spread it onto a STATE query
 * (scores.listByGame, competitions.leaderboard) — that's the "one blob tuned two
 * ways" trap this split exists to undo: you'd freeze the scores along with the
 * structure.
 *
 * ── The SERVER half is separate ──
 * This fixes the CLIENT (React Query) half. The trip→live reload ALSO has a server
 * half: the Live route is a Server Component that re-resolves faceBootstrap on
 * every navigation. A long client cache can't touch a blocking server RSC fetch —
 * that's killed by Router Cache retention (`experimental.staleTimes.dynamic` in
 * next.config.ts). The two work together: the Router Cache stops the server
 * re-resolve; STRUCTURE_QUERY makes the kept client cache the authority.
 */
export const STRUCTURE_QUERY = {
  staleTime: Infinity,
  gcTime: 30 * 60_000,
} as const;
