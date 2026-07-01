/**
 * Pure draft operations for the Rack-n-Stack manual playing-group builder — the
 * client-safe logic behind `RackGroupBuilder` (mirrors how the 2v2 match-builder
 * factors its draft edits into `matchDraft.ts`). A draft is `string[][]`: one array
 * of user ids per group, in group order. No React, no tRPC — so it unit-tests
 * directly and the component stays a thin view over these.
 */

export const MAX_PER_GROUP = 4;
export const MAX_GROUPS = 12;

/** Append an empty group (capped at MAX_GROUPS). */
export function addGroup(groups: string[][]): string[][] {
  return groups.length < MAX_GROUPS ? [...groups, []] : groups;
}

/** Drop a group; its players return to the pool (no longer in any group). */
export function removeGroup(groups: string[][], index: number): string[][] {
  return groups.filter((_, i) => i !== index);
}

/**
 * Assign a player to group `index`. Enforces "at most one group": the player is
 * first removed from every group, then added to the target — unless it's already
 * full (MAX_PER_GROUP), in which case the draft is returned unchanged.
 */
export function assignPlayer(groups: string[][], index: number, userId: string): string[][] {
  const cleared = groups.map((g) => g.filter((u) => u !== userId));
  if ((cleared[index]?.length ?? 0) >= MAX_PER_GROUP) return groups;
  return cleared.map((g, i) => (i === index ? [...g, userId] : g));
}

/** Remove a player from group `index` (back to the pool). */
export function removePlayer(groups: string[][], index: number, userId: string): string[][] {
  return groups.map((g, i) => (i === index ? g.filter((u) => u !== userId) : g));
}

/** Everyone currently in a group — the set removed from the combined picker pool. */
export function assignedIds(groups: string[][]): Set<string> {
  return new Set(groups.flat());
}

/**
 * The persist shape for `playGroups.setFoursomes`: empty groups (an unfinished
 * "add group") are dropped and the survivors renumber Group 1..N.
 */
export function toPersist(groups: string[][]): { name: string; userIds: string[] }[] {
  return groups.filter((g) => g.length > 0).map((userIds, i) => ({ name: `Group ${i + 1}`, userIds }));
}
