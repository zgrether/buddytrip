/**
 * rosterMutations — the cache policy of the four roster mutations
 * (`teamAssignments.assign` / `remove` / `reorder` / `setCaptain`), outside the
 * component, so a test can drive the code the app runs (`TeamsPanel` wires it).
 *
 * ── Optimistic patch, and NO snapshot restore on error (#1405) ─────────────
 *
 * Each mutation patches the roster cache the instant it is tapped. On failure
 * it does NOT restore a snapshot of the cache taken when it started, which is
 * what these did until #1405 and what CLAUDE.md #1 prescribes against.
 *
 * Taps down a crew list run concurrently. A snapshot taken by tap 1 predates
 * taps 2..N, so restoring it when tap 1 fails rolls the roster back past every
 * later add, INCLUDING ones the server already committed. A failed tap wiped a
 * successful sibling off the screen until the next refetch.
 *
 * The error path is instead the same re-pull of server truth every settle
 * already does: `onSettled` runs after `onError` every time, and the settle
 * below re-fetches at the TRAILING EDGE of the burst. Server truth cannot
 * discard a sibling's committed write; a snapshot can. The failed tap's
 * optimistic row stays until that refetch lands, which for a lone tap is
 * immediately.
 *
 * It is deliberately NOT an `invalidate()` inside `onError`: mid-burst, a
 * refetch started there can resolve after a LATER tap's optimistic write and
 * overwrite it with server state that has not caught up to that write yet,
 * which is the first roster race (2026-07-11) that the trailing edge closed.
 * Waiting for the burst to drain is what makes the refetch safe.
 *
 * Kept from before, unchanged: every `onMutate` cancels every writer of the
 * roster cache first (`cancelRosterWriters`, including the `faceBootstrap`
 * re-seed), and the burst counter holds the refetch until the last tap settles.
 */

export type RosterRow = {
  competition_id?: string;
  user_id: string;
  team_id: string | null;
  sort_order?: number | null;
  is_captain?: boolean | null;
};

export interface RosterMutationCache {
  /** Cancel every in-flight fetch that writes the roster cache. The app passes
   *  `cancelRosterWriters`; awaited BEFORE the optimistic patch. */
  cancelWriters(): Promise<void>;
  /** Apply an optimistic patch to the roster cache. */
  patch(fn: (rows: RosterRow[]) => RosterRow[]): void;
  /** Re-pull server truth once a burst has fully settled. `leaderboard` is true
   *  when a mutation in the burst changed a team's SIZE (assign / remove). */
  refetch(opts: { leaderboard: boolean }): void;
}

export type AssignVars = { competitionId: string; userId: string; teamId: string };
export type RemoveVars = { userId: string };
export type ReorderVars = { teamId: string; orderedUserIds: string[] };
export type SetCaptainVars = { teamId: string; userId: string; isCaptain: boolean };

/** Pure patches, exported for the component's own reading of them. */
export const rosterPatches = {
  assign(rows: RosterRow[], v: AssignVars): RosterRow[] {
    // Composite PK is (competition_id, user_id): drop any existing row for this
    // user before inserting the new pairing.
    const filtered = rows.filter((a) => a.user_id !== v.userId);
    // sort_order MIRRORS the server: `assign` writes max + 1, the end of the
    // target team's order. Omitting it was not neutral: every reader sorts on
    // `sort_order ?? 0`, so the newcomer tied with the FIRST row and rendered
    // near the top, then jumped to the bottom when the refetch landed.
    const nextSortOrder =
      filtered
        .filter((a) => a.team_id === v.teamId)
        .reduce((max, a) => Math.max(max, a.sort_order ?? 0), -1) + 1;
    return [
      ...filtered,
      { competition_id: v.competitionId, user_id: v.userId, team_id: v.teamId, sort_order: nextSortOrder },
    ];
  },
  remove(rows: RosterRow[], v: RemoveVars): RosterRow[] {
    return rows.filter((a) => a.user_id !== v.userId);
  },
  reorder(rows: RosterRow[], v: ReorderVars): RosterRow[] {
    const orderIndex = new Map(v.orderedUserIds.map((id, i) => [id, i]));
    return rows.map((a) =>
      a.team_id === v.teamId && orderIndex.has(a.user_id) ? { ...a, sort_order: orderIndex.get(a.user_id)! } : a
    );
  },
  setCaptain(rows: RosterRow[], v: SetCaptainVars): RosterRow[] {
    // One captain per team: the target gets the flag, any other captain on the
    // SAME team is cleared.
    return rows.map((a) => {
      if (a.team_id !== v.teamId) return a;
      if (a.user_id === v.userId) return { ...a, is_captain: v.isCaptain };
      return a.is_captain ? { ...a, is_captain: false } : a;
    });
  },
};

/** The burst counter, shared by all four mutations of one roster surface. It is
 *  the state that must outlive a render; the options around it need not. */
export type RosterBurst = { pending: number; needsLeaderboard: boolean };
export const newRosterBurst = (): RosterBurst => ({ pending: 0, needsLeaderboard: false });

/**
 * Build the four mutations' cache options around ONE shared burst counter.
 * Cheap to rebuild every render (the component does, so it always acts on its
 * current key); the `burst` must be the same object across renders, because it
 * is what holds the refetch until the last tap of a burst settles.
 */
export function createRosterMutations(cache: RosterMutationCache, burst: RosterBurst = newRosterBurst()) {
  const settle = () => {
    burst.pending = Math.max(0, burst.pending - 1);
    if (burst.pending > 0) return; // more of this burst still in flight
    cache.refetch({ leaderboard: burst.needsLeaderboard });
    burst.needsLeaderboard = false;
  };

  function optimistic<V>(changesTeamSize: boolean, patch: (rows: RosterRow[], v: V) => RosterRow[]) {
    return {
      onMutate: async (vars: V) => {
        burst.pending += 1;
        if (changesTeamSize) burst.needsLeaderboard = true;
        await cache.cancelWriters();
        cache.patch((rows) => patch(rows, vars));
      },
      // No onError. See the header: the settle's trailing-edge refetch IS the
      // error path, and a restored snapshot would discard a sibling's write.
      onSettled: settle,
    };
  }

  return {
    assign: optimistic<AssignVars>(true, rosterPatches.assign), // team size → points move
    remove: optimistic<RemoveVars>(true, rosterPatches.remove),
    reorder: optimistic<ReorderVars>(false, rosterPatches.reorder), // order only
    setCaptain: optimistic<SetCaptainVars>(false, rosterPatches.setCaptain), // flag only
  };
}
