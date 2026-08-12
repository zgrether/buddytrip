/**
 * The colour of a trip role — ONE value, read by every surface that paints one.
 *
 * There are three role states (`PERMISSIONS.md`): Owner, Organizer, Member.
 * Member has no mark anywhere, so two of them are painted.
 *
 * ── Why this module exists ──────────────────────────────────────────────────
 * The badge was already rendered from two independent copies — `RoleBadge` and
 * `RolePill` in `CrewRoster.tsx` — that agreed only because nobody had changed
 * either one. The rail's role edge was about to be a third. A shared token per
 * role is what makes "the edge matches the badge" true by construction instead
 * of true by inspection, which is the same reasoning `teamTextColor` and
 * `categoryIcon` are single helpers.
 *
 * ── Organizer is BLUE, and the history behind that is worth keeping ─────────
 * Organizer rendered as `--color-bt-accent` (teal) everywhere, and the belief
 * was that it had been blue before a token migration swept it. It had not. Full
 * history: the badge was created as a hardcoded `#00d4aa` (commit `5d7a5e72`,
 * 2026-03-12, then labelled "Planner") and the hex-to-token pass two days later
 * (`b3b0add5`) turned that into `var(--color-bt-accent)`. The suspected
 * mechanism was real and this file WAS in that sweep — what it swept was the
 * teal itself, not a blue. No commit ever gave this badge a blue.
 *
 * It is blue NOW for a forward reason rather than a restorative one. The rail
 * paints the role as a 3px edge, and at 3px a teal band competes with two
 * things that are already teal on the same row — the selected-row treatment
 * (`--color-bt-accent-faint` background, `--color-bt-accent-border`) and the
 * trophy mark. A third teal element at that size is not a distinction.
 * `--color-bt-planning` is the palette's blue, and its dark value is explicitly
 * luminosity-matched against teal-400 (see `globals.css`), which is exactly the
 * property needed here.
 *
 * ── The one stale doc, flagged not silently resolved ────────────────────────
 * `STYLE_GUIDE.md` §2 lists `--color-bt-ready` (described as violet) as "Planner
 * role badge". That token is orange (`#f97316`) in `globals.css` and no role
 * badge has ever used it — the row is wrong on both the value and the usage.
 * §"Role badge (RoleBadge component)" is the one that matched the code.
 */

export type BadgedRole = "Owner" | "Organizer";

export interface RoleColor {
  /** Text and, on the rail, the 3px edge. */
  text: string;
  /** Badge fill. */
  faint: string;
  /** Badge border. */
  border: string;
}

export const ROLE_COLOR: Record<BadgedRole, RoleColor> = {
  Owner: {
    text: "var(--color-bt-owner)",
    faint: "var(--color-bt-warning-faint)",
    border: "var(--color-bt-warning-border)",
  },
  Organizer: {
    text: "var(--color-bt-planning)",
    faint: "var(--color-bt-planning-faint)",
    border: "var(--color-bt-planning-border)",
  },
};

/** The role this row/member is marked with, or `null` for Member (no mark). */
export function badgedRole(role: string | null | undefined): BadgedRole | null {
  return role === "Owner" || role === "Organizer" ? role : null;
}
