/**
 * Edit/Add Team modal — draft-dirtiness predicates. PURE, client-safe, no deps.
 *
 * The Edit Team modal is a PARTIAL draft surface, and that is deliberate (see the
 * rule at `orderDraft` in `TeamsPanel.tsx`):
 *
 *   - team FIELDS  — name / short name / colour / roster ORDER — draft and commit
 *     together on Save.
 *   - MEMBERSHIP   — add / remove / captain ★ — applies the moment it is tapped.
 *
 * So "is there unsaved work?" is a question about the FIELDS only. Nothing here
 * knows about membership, and it must stay that way while the split stands —
 * a leave-guard that claimed to cover membership would be promising to undo writes
 * that already landed.
 *
 * ── Why this is separate from `canSubmit` ────────────────────────────────────
 * They look alike and are NOT the same question:
 *
 *   canSubmit             "can this be saved?"      — in CREATE mode, always true
 *                                                     for a valid new team, even
 *                                                     though nothing was edited.
 *   hasUnsavedTeamWork    "would leaving lose work?" — in CREATE mode, false until
 *                                                     the user actually types or
 *                                                     picks something.
 *
 * Wiring the leave-guard to `canSubmit` would prompt on every cancelled Add Team,
 * training the user to dismiss the prompt — which is how a guard stops working
 * without anyone noticing it stopped.
 *
 * Both modes go through ONE comparison by choosing the right BASELINE: edit mode
 * compares against the team on the server, create mode against the empty form the
 * modal opened with. No `isEdit` branch, so the two cannot drift.
 */

/** The three identity fields the modal drafts. */
export type TeamIdentityDraft = {
  name: string;
  shortName: string;
  color: string;
};

/**
 * Does the drafted identity differ from `baseline`?
 *
 * Name is trimmed and short name is compared case-INSENSITIVELY, because the modal
 * upper-cases the short name on save — so typing "ham" over a stored "HAM" is not an
 * edit, and must not arm the leave-guard or enable Save.
 */
export function identityDiffers(
  draft: TeamIdentityDraft,
  baseline: TeamIdentityDraft,
): boolean {
  return (
    draft.name.trim() !== baseline.name.trim() ||
    draft.shortName.trim().toUpperCase() !== baseline.shortName.trim().toUpperCase() ||
    draft.color !== baseline.color
  );
}

/**
 * Does the roster-order draft differ from the server's canonical order?
 *
 * `null` means untouched — the roster is following the server, so there is nothing
 * to lose. Dragging a row and putting it back compares equal and reports clean,
 * matching the existing Save-stays-disabled behaviour.
 */
export function orderDiffers(
  draft: readonly string[] | null,
  serverOrder: readonly string[],
): boolean {
  if (draft === null) return false;
  if (draft.length !== serverOrder.length) return true;
  return !draft.every((id, i) => id === serverOrder[i]);
}

/**
 * Is there drafted, uncommitted work that leaving would throw away?
 *
 * Membership is deliberately absent — see the header. Callers pass the baseline
 * that matches their mode (server team for edit, opening form for create).
 */
export function hasUnsavedTeamWork(input: {
  identity: TeamIdentityDraft;
  baseline: TeamIdentityDraft;
  orderDraft: readonly string[] | null;
  serverOrder: readonly string[];
}): boolean {
  return (
    identityDiffers(input.identity, input.baseline) ||
    orderDiffers(input.orderDraft, input.serverOrder)
  );
}

/**
 * Project a roster-order draft onto the roster that actually exists RIGHT NOW.
 *
 * The Edit Team modal is a partial draft (see the header): order drafts, but add /
 * remove apply on tap. So the moment someone drags a row and THEN adds a player,
 * the stored draft is a snapshot of a roster that no longer exists — it is missing
 * the newcomer, and after a removal it names someone who has left.
 *
 * That single stale-set condition produced both halves of the reported bug:
 *
 *   - `teamAssignments.reorder` validates its input is a PERMUTATION of the team's
 *     current roster and refuses anything else, so Save failed with "Order must be
 *     exactly this team's current roster" — a refusal naming a condition the reader
 *     could not clear from the modal, since the only order they could see was the
 *     stale one (CLAUDE.md's refusal rule).
 *   - the roster list renders every assignment but feeds `SortableContext` the
 *     DRAFT ids, so a player missing from the draft rendered as a row that was not
 *     a sortable item: visible, appended at the bottom, and immovable. The
 *     newest-added player is always the one at the bottom, which is exactly how it
 *     was reported.
 *
 * So the draft is never read raw. Reconciling it against the live roster keeps the
 * drafted SEQUENCE while making the SET always correct: ids that have left are
 * dropped, ids that arrived are appended in the roster's own order — which is where
 * the server puts them anyway (`assign` writes `sort_order = max + 1`), so an add on
 * its own reconciles equal to the server and correctly does NOT mark the order dirty.
 *
 * `null` in, `null` out — untouched stays untouched.
 */
export function reconcileOrderDraft(
  draft: readonly string[] | null,
  rosterOrder: readonly string[],
): string[] | null {
  if (draft === null) return null;
  const live = new Set(rosterOrder);
  const kept = draft.filter((id) => live.has(id));
  const keptSet = new Set(kept);
  const arrived = rosterOrder.filter((id) => !keptSet.has(id));
  return [...kept, ...arrived];
}
