/**
 * bootstrapSeed — the caches `competitions.faceBootstrap` re-seeds, and the one
 * cancel an optimistic writer of any of them owes.
 *
 * `LiveFaceClient` writes these keys with `setData` every time the bootstrap
 * resolves (CLAUDE.md #10). So each of them has TWO writers: its own fetch, and
 * the bootstrap. An optimistic mutation that cancels only its own query leaves
 * an in-flight bootstrap free to land afterwards and overwrite the optimistic
 * value with a snapshot taken before the write, which is the roster add race
 * (`rosterCacheSync.ts`), and was still open for the schedule's game link and
 * the competition rename until this module (#1405's C).
 *
 * `bootstrapSeed.guard.test.ts` reads `LiveFaceClient.tsx` and fails if this
 * list and the seed disagree, and fails if any mutation that optimistically
 * writes one of these keys does not cancel the bootstrap first.
 */

export const BOOTSTRAP_SEEDED_KEYS = [
  "competitions.getByTrip",
  "games.myDelegateGameIds",
  "games.listByTrip",
  "teams.list",
  "teamAssignments.list",
] as const;

type BootstrapCanceller = {
  competitions: { faceBootstrap: { cancel: (input: { tripId: string }) => unknown } };
};

/**
 * Cancel an in-flight `faceBootstrap` before an optimistic write to a seeded
 * cache. Await it alongside the query's own cancel, BEFORE the `setData`.
 *
 * Safe for the face: `cancelQueries` reverts to the state captured at fetch
 * start, which already had data, so the face never drops to its spinner
 * (pinned in `rosterCacheSync.test.ts`, "never blanks the cup face").
 */
export async function cancelBootstrapSeed(utils: BootstrapCanceller, tripId: string): Promise<void> {
  await utils.competitions.faceBootstrap.cancel({ tripId });
}
