/**
 * The account-deletion confirmation-text check (regression fix, follows #957).
 *
 * The confirmation `<input>` on the delete-account sheet renders with
 * Tailwind's `uppercase` class (`text-transform: uppercase`) so the field
 * always LOOKS like "DELETE" once anything is typed. That is display-only —
 * it does not change what the browser puts in `e.target.value`. A user who
 * types lowercase (the mobile-keyboard default; a virtual keyboard has no
 * always-on caps lock, so shift-typing all six letters is friction nobody
 * takes) sees "DELETE" on screen and reasonably believes they matched it,
 * while the raw value is "delete" — and a case-sensitive `===` against
 * "DELETE" never matches. The button never enables, for anyone who doesn't
 * manually shift-type every letter. This reproduces regardless of whether
 * the account is blocked by the #957 orphan guard — it is a separate,
 * unconditional bug in the confirmation check itself.
 *
 * Fix: normalize the STORED value to uppercase on every keystroke (the same
 * pattern `TeamsPanel` already uses for team short codes — see
 * `setShortName(e.target.value.toUpperCase())`), so what gets compared is
 * what's displayed, and trim it so a trailing space (autocomplete/autocorrect
 * inserting one after a "recognized" word) can't cause the same silent
 * mismatch.
 */

export const DELETE_CONFIRMATION_WORD = "DELETE";

/** Apply on every input change so the stored value matches what the CSS displays. */
export function normalizeDeleteConfirmationInput(raw: string): string {
  return raw.toUpperCase();
}

/** Whether the (already-normalized) confirmation text satisfies the check. */
export function isDeleteConfirmed(confirmText: string): boolean {
  return confirmText.trim() === DELETE_CONFIRMATION_WORD;
}
