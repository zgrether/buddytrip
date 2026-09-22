/**
 * rosterCacheSync — every query that WRITES `teamAssignments.list`, in one
 * place, so an optimistic roster mutation can cancel all of them.
 *
 * ── The bug this exists for ────────────────────────────────────────────────
 *
 * `teamAssignments.list` has TWO writers, not one. The obvious writer is its
 * own fetch. The second is `competitions.faceBootstrap`: `LiveFaceClient`
 * re-seeds the roster from `boot.assignments` via `setData` on every bootstrap
 * resolve (pattern #10), and it is mounted above every roster surface
 * (`CompetitionFace.tsx` renders `TeamSheet` and `RostersOverlay`).
 *
 * Each roster mutation's `onMutate` cancelled the first and not the second. So
 * a bootstrap fetch started by one tap's settle would still be in flight when
 * the NEXT tap wrote its optimistic row — and when it landed, it overwrote the
 * roster with a snapshot taken before that tap, putting the person who had just
 * been added back into "available crew".
 *
 * Lived on bbmi.app, adding crew to a team from the mobile roster. Measured
 * across five taps, the bootstrap is always exactly ONE PERSON BEHIND, so each
 * seed restores the one it dropped last time and drops the newest — a hole that
 * rolls down the list behind your thumb:
 *
 *     CACHE: P1          => P1,P2           tap P2
 *     CACHE: P1,P2       => P1              seed drops P2
 *     CACHE: P1          => P1,P3           tap P3   (P2 still gone)
 *     CACHE: P1,P3       => P1,P2           seed: P2 back, P3 gone
 *     ...
 *
 * Each person is out for ~0.6-1.1s, which is why it read as "one or more come
 * back to the available list a few seconds later" rather than as one bug.
 *
 * ── Why TAPPING FASTER was safer, and why testing never found it ───────────
 *
 * The trailing-edge guard in `useTeamAssignmentMutations` (`pendingRef`,
 * added 2026-07-11) holds the invalidate until a burst finishes, so taps CLOSER
 * TOGETHER than one write round-trip are covered. Going down a list at a human
 * pace — ~1s apart — lets `pending` reach 0 between taps, so every tap gets its
 * own settle and its own already-stale bootstrap refetch. The defect is keyed to
 * tap RHYTHM, which is why it presented as random and why deliberate testing
 * (which taps fast) missed it.
 *
 * ── The rule ───────────────────────────────────────────────────────────────
 *
 * ANY query whose resolution writes `teamAssignments.list` belongs in here, and
 * every optimistic roster mutation calls this instead of cancelling by hand.
 * A second list that merely happens to match is how the two drift (#22's "one
 * invalidator, not two lists that happen to match", applied to cancellation).
 *
 * The shape is `GameRefreshUtils` / `ScoreEventUtils`: a STRUCTURAL slice of
 * tRPC utils, so the contract is testable without a React tree — and so a test
 * watching this actually watches the code, rather than a transcription of it.
 */

type Canceller<I> = { cancel: (input: I) => unknown };

export type RosterCacheUtils = {
  teamAssignments: { list: Canceller<{ tripId: string; competitionId: string }> };
  competitions: { faceBootstrap: Canceller<{ tripId: string }> };
};

export type RosterCacheKey = { tripId: string; competitionId: string };

/**
 * Cancel every in-flight fetch that would write `teamAssignments.list`.
 *
 * Await this BEFORE the optimistic `setData`, exactly as `onMutate` already did
 * for the list alone — an uncancelled fetch resolving afterwards overwrites the
 * optimistic row with pre-write server state.
 */
export async function cancelRosterWriters(
  utils: RosterCacheUtils,
  key: RosterCacheKey,
): Promise<void> {
  await Promise.all([
    utils.teamAssignments.list.cancel(key),
    // THE LINE THE REGRESSION TEST WATCHES. `faceBootstrap` writes this cache
    // key through LiveFaceClient's seed; cancelling only the list leaves the
    // bootstrap free to land a stale roster on top of the optimistic one.
    utils.competitions.faceBootstrap.cancel({ tripId: key.tripId }),
  ]);
}
