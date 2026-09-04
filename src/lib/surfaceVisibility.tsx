"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

/**
 * surfaceVisibility — the one rule for "this surface is covered".
 *
 * ── The pair of rules, in a sentence each ──────────────────────────────────
 *
 *   A change marks everything stale and fetches only what someone is looking at.
 *   A surface becoming visible fetches what is stale.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * 2026-09-04: six people entering scores took production down for nine minutes.
 * Every score write broadcasts, every client invalidates five query keys, and
 * each of those refetches — measured at ~200 Supabase reads per score entered,
 * with 95% of the load being write-triggered fan-out rather than polling. It
 * ended in `PGRST003: Timed out acquiring connection from connection pool`.
 *
 * The insight is Zach's, off the score-entry screenshots: while someone is
 * entering a score, the ONLY live thing on their screen is their own match's
 * mini header — "2 UP", "THRU 4". The other four matches, the game's cup
 * totals, the trip leaderboard and every projection are on screens they have
 * backed out of. Each is one or two taps away and will fetch fresh when they
 * get there. So a score event should mark those stale and fetch nothing.
 *
 * ── Why VISIBILITY and not MOUNT ──────────────────────────────────────────
 *
 * Because nothing unmounts. The app has three levels of covered-but-mounted
 * surface, all deliberate:
 *
 *   1. `LiveFaceClient` — never unmounts; it is the parent.
 *   2. `CompetitionLeaderboard` — "HIDDEN, not unmounted, once a game is open"
 *      (`CompetitionFace.tsx`), because unmounting would throw the warm board
 *      away and pay to rebuild it on every back. That is the panel idiom
 *      (CLAUDE.md #12) working as designed.
 *   3. `MatchGameView` — its `useQuery` hooks sit ABOVE the
 *      `screen === "score"` early return, so the overview's observers survive
 *      focused score entry.
 *
 * So `refetchOnMount` never fires on a back-out, `refetchOnWindowFocus` is off
 * (`providers.tsx`), and marking-stale alone would leave the cup page frozen —
 * `faceBootstrap` has `staleTime: Infinity` and NO interval, so nothing would
 * ever refetch it. Mount and visibility genuinely differ here, and the rule has
 * to key on the one that is true.
 *
 * ── Why there is no new fetching mechanism ────────────────────────────────
 *
 * There nearly was: a refetch-on-reveal hook, a registry, `refetchType: "none"`
 * threaded through the score-event handler. None of it is needed. Both halves
 * fall out of React Query's own semantics once a covered surface DISABLES its
 * queries — verified by reading the installed `@tanstack/query-core` 5.90.20,
 * and pinned by `surfaceVisibility.test.tsx` because a library behaviour is not
 * a runtime guarantee (CLAUDE.md #23):
 *
 *   • `query.isActive()` is `observers.some(o => enabled !== false)`, and
 *     `invalidateQueries` defaults to `refetchType: "active"`. A query whose
 *     observers are all disabled is therefore MARKED STALE AND NOT FETCHED.
 *     That is rule one, for free.
 *
 *   • `shouldFetchOptionally(query, prevQuery, options, prevOptions)` returns
 *     true when `prevOptions.enabled === false` and the query is stale. So the
 *     disabled → enabled transition refetches exactly what went stale while the
 *     surface was covered. That is rule two, for free.
 *
 * The score-event handler is UNCHANGED by this: it still invalidates all five
 * keys, which keeps the correctness argument (#10's faceBootstrap pairing, #20's
 * invalidate-only posture) exactly as it was. Visibility decides what fetches;
 * the handler decides what is stale. Those are different questions and this
 * separates them.
 *
 * ── Composition ───────────────────────────────────────────────────────────
 *
 * Visibility is ANDed down the tree: a surface is visible only if it and every
 * ancestor is. That is what makes it a rule rather than three special cases —
 * the game panel covering the board and focused entry covering the game page
 * are the same statement at two depths, and a third level would need no new
 * code.
 *
 * ── What this is NOT ──────────────────────────────────────────────────────
 *
 * Not document visibility. React Query's own `focusManager` already handles the
 * tab being hidden. This is about one surface covering another INSIDE a visible
 * document, which the library has no concept of.
 */
const SurfaceVisibilityContext = createContext<boolean>(true);

/**
 * Mark a subtree covered or revealed.
 *
 * `visible={false}` does not hide anything — the caller still controls
 * rendering. It states that nobody can see this subtree right now, so its
 * queries should stop fetching and start again when it is revealed.
 */
export function SurfaceVisibility({
  visible,
  children,
}: {
  visible: boolean;
  children: ReactNode;
}) {
  const parentVisible = useContext(SurfaceVisibilityContext);
  // ANDed, so a revealed child inside a covered parent stays covered. Memoised
  // so an unchanged boolean does not re-render every consumer beneath it.
  const value = useMemo(() => parentVisible && visible, [parentVisible, visible]);
  return (
    <SurfaceVisibilityContext.Provider value={value}>
      {children}
    </SurfaceVisibilityContext.Provider>
  );
}

/**
 * Is the surface this component sits in currently visible?
 *
 * Defaults to `true` with no provider above, so every existing surface keeps
 * its present behaviour and this can be adopted one surface at a time. The
 * failure direction of a missing provider is "fetches as it does today",
 * never "silently stops fetching".
 */
export function useSurfaceVisible(): boolean {
  return useContext(SurfaceVisibilityContext);
}

/**
 * `enabled` for a query that should only fetch while its surface is visible.
 *
 * Use INSTEAD of a bare `enabled: <conditions>` in any surface that can be
 * covered:
 *
 *     const q = trpc.x.useQuery(input, {
 *       ...POLICY,
 *       enabled: useVisibleEnabled(!!tripId && !!gameId),
 *     });
 *
 * Cached data still renders while covered — disabling stops FETCHES, not the
 * cache — so the warm board stays warm, which is the property the panel idiom
 * exists to provide.
 */
export function useVisibleEnabled(enabled: boolean = true): boolean {
  return useSurfaceVisible() && enabled;
}
