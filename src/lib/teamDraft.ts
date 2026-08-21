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
