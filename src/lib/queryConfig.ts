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
 * structure. CONSEQUENCE, not just prohibition: this already happened once
 * (F4, competitions.leaderboard in GamePageHeader.tsx) — on a route with no
 * OTHER observer polling that key (e.g. a standalone game route with no
 * CompetitionLeaderboard mounted), staleTime: Infinity is the query's ONLY
 * freshness policy, so standings silently FREEZE until an unrelated remount,
 * while still being presented as live. A comment didn't catch it last time —
 * before spreading STRUCTURE_QUERY onto any query, grep every OTHER call site
 * on the same tRPC key first; if even one of them expects live data, none of
 * them can use this. For `competitions.leaderboard` specifically, use
 * `LEADERBOARD_QUERY` below instead of hand-rolling options.
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

/**
 * `LEADERBOARD_QUERY` — the cache policy for `competitions.leaderboard`
 * SPECIFICALLY (F4). Every observer of this key (`CompetitionLeaderboard`,
 * `GamePageHeader`, `NonGolfGameView`) must resolve to the SAME effective
 * behaviour — one query key, one policy, not three. staleTime/gcTime are
 * deliberately absent; observers rely on the global defaults
 * (`staleTime: 60_000`, `providers.tsx`), so this only adds the interval.
 *
 * ── This is a BACKSTOP now, not the freshness mechanism ──────────────────────
 * It used to be 30s, and it was how the board learned that anything had
 * happened. Migration 096 + `useRealtimeScoreEvents` made that push-based: a
 * score write broadcasts, and every open surface invalidates within a tick. The
 * interval survives only to cover what a socket cannot — a dropped connection, a
 * backgrounded tab that missed events, a Realtime outage, or a write from a path
 * that somehow bypasses the trigger.
 *
 * So it is deliberately LONG (5 min). Do not tune it back down to "make the
 * board feel live" — if the board feels stale, the subscription is broken and
 * shortening this hides the bug instead of fixing it. And do not remove it
 * either: the same reasoning as CLAUDE.md #19 (the configHash poll kept
 * alongside `useRealtimeGame`) applies here — the redundancy is the point on a
 * golf course, where dead zones and network handoffs are routine, not edge
 * cases.
 *
 * All three observers now spread this constant. `CompetitionLeaderboard` used to
 * keep its own 30s literal as "the reference"; that only worked while the value
 * never moved, and the moment it did (here) a literal left behind would have
 * been exactly the three-way drift this constant exists to prevent.
 *
 * This is NOT a general "STATE query" policy — do not reach for it, or
 * generalize it into one, for other state queries. `scores.listByGame` is
 * also a STATE query (see the prohibition above) but polls at its OWN
 * cadence, `GAME_SYNC_INTERVAL_MS` (20s, `useConfigSync.ts`) — a DIFFERENT
 * interval for a DIFFERENT reason (game-state sync, not standings), and one
 * that is explicitly NOT retired by this change. Centralizing refetchInterval
 * across unrelated STATE queries would force one cadence onto both and break
 * whichever one didn't ask for it. Scope a new constant like this one to its
 * OWN query key if another STATE query needs the same everyone-must-match
 * guarantee.
 */
export const LEADERBOARD_QUERY = {
  refetchInterval: 5 * 60_000,
} as const;
