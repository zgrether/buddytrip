import { placementPoints } from "./competitionPlacement";

/**
 * Finishing order WITH TIES, for the non-golf placement entry.
 *
 * ── Why ties instead of per-row point overrides ──────────────────────────────
 * Non-golf produces genuine ties — cornhole, euchre. The first design for that
 * was a per-row points override, which needed its own "must sum exactly"
 * validation, its own refusal path, and an answer to "does an override follow the
 * team or the place when you reorder".
 *
 * None of that is necessary, because the scoring engine ALREADY handles ties.
 * `placementPoints` pools the distribution slots a tie group occupies and splits
 * them: two tied for 1st on [6, 3.5, 1.5] take (6 + 3.5) / 2 = 4.75 each, and the
 * next team takes 1.5. **The total is preserved by construction**, so there is
 * nothing to validate and nothing to refuse. A tie is not a new scoring rule; it
 * is a thing the engine could always compute and the UI could not express.
 *
 * ── The model ────────────────────────────────────────────────────────────────
 * A flat `order` of team ids plus a set of teams that are TIED WITH THE ROW
 * ABOVE. Groups derive from those two. Deliberately not a nested array: the drag
 * stays an ordinary flat dnd-kit sortable (stable ids, one list), and tying is a
 * separate explicit toggle rather than a second meaning overloaded onto a drop
 * target — "between these rows" and "onto this row" are neighbouring intents on a
 * 44px touch target, and only one of them can be got right by feel.
 *
 * A tie flag on the FIRST row is meaningless (nothing above it) and is ignored
 * everywhere here, so callers never have to keep the set pruned.
 */

/** Split a flat order into tie groups. Each group shares one finishing place. */
export function placementGroups(
  order: readonly string[],
  tiedWithPrev: ReadonlySet<string>
): string[][] {
  const groups: string[][] = [];
  for (const [i, id] of order.entries()) {
    // i === 0 can never be tied-with-above, whatever the set says.
    if (i > 0 && tiedWithPrev.has(id) && groups.length > 0) groups[groups.length - 1].push(id);
    else groups.push([id]);
  }
  return groups;
}

/**
 * The PLACE each group finishes in, 1-based, competition-style: a group of two
 * starting at 1 is followed by a group starting at 3. Matches what
 * `placementDetail` already reports for tied teams ("two tied for 3rd are both
 * place 3"), so the entry screen and the scoreboard agree by construction.
 */
export function placeOfGroup(groups: readonly string[][], groupIndex: number): number {
  let place = 1;
  for (let i = 0; i < groupIndex; i++) place += groups[i].length;
  return place;
}

/**
 * What `games.finish` is given. Tied teams share a `position` — the writer has
 * never required positions to be unique, and the leaderboard's placement branch
 * reads `position` as the standing value, so equal positions arrive at
 * `placementPoints` as a genuine tie group and are paid the shared amount.
 */
export function placementsFrom(
  order: readonly string[],
  tiedWithPrev: ReadonlySet<string>
): { entityId: string; position: number }[] {
  const groups = placementGroups(order, tiedWithPrev);
  return groups.flatMap((group, gi) =>
    group.map((entityId) => ({ entityId, position: placeOfGroup(groups, gi) }))
  );
}

/**
 * Points each team earns, previewed inline on the entry screen.
 *
 * Delegates to `placementPoints` — the SAME function the leaderboard scores with
 * — rather than re-deriving the share here. A second implementation of the
 * pooling rule is how the row you tapped and the cup you look at afterwards come
 * to disagree.
 */
export function placementPointsByTeam(
  order: readonly string[],
  tiedWithPrev: ReadonlySet<string>,
  distribution: readonly number[]
): Map<string, number> {
  const groups = placementGroups(order, tiedWithPrev);
  // Standing `value` = the group's place. Equal values are exactly how
  // `placementPoints` recognises a tie, so this needs no tie argument.
  const standings = groups.flatMap((group, gi) =>
    group.map((entityId) => ({ entityId, value: placeOfGroup(groups, gi) }))
  );
  return placementPoints([...distribution], standings, "low_wins");
}

/**
 * Points for an ALREADY-BUILT placements payload — the exact array `games.finish`
 * is handed.
 *
 * `placementPointsByTeam` above answers "what would this finishing order pay?"
 * from the order + ties. This answers the same question from the POSTABLE form,
 * which is what makes it usable as a pre-save preview: the projection and the
 * mutation read one array, so "what the header promised" and "what was sent"
 * cannot be different things. Feed it the payload you are about to post and the
 * preview is the result by construction rather than by two implementations
 * agreeing.
 *
 * Still the same `placementPoints` the leaderboard scores with — this adds a
 * calling convention, NOT a second scoring path. `position` becomes the standing
 * `value` exactly as the server's placement branch does when it reads
 * `game_results.position`, so equal positions arrive as a genuine tie group.
 *
 * The DISTRIBUTION is the caller's to supply, because it differs by how the game
 * is scored, and the server picks it the same way (competitionLeaderboard.ts):
 *   - manual match-play → `[points_total, 0]`: winner takes all, and a tie (both
 *     at position 1) averages to half each, the same convention a golf halve uses
 *   - placement        → `points_distribution.values`
 */
export function pointsForPlacements(
  placements: readonly { entityId: string; position: number }[],
  distribution: readonly number[]
): Map<string, number> {
  return placementPoints(
    [...distribution],
    placements.map((p) => ({ entityId: p.entityId, value: p.position })),
    "low_wins"
  );
}
