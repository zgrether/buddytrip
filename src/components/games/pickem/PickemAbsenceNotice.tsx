"use client";

import { TYPE_SCALE } from "@/lib/typeScale";

/**
 * "Nobody chose here" — one notice, wherever pick'em has to say it.
 *
 * ── ONE FAMILY, NOT TWO ───────────────────────────────────────────────────
 *
 * Two surfaces report an absence and they were reporting it in two visual
 * languages: the sheet's `NOT PICKED` (dashed, dim, small-caps) and the board's
 * `NOTHING SUBMITTED` (a solid pill in the same slot as LIVE and FINAL, which
 * are STATES of a contest rather than absences).
 *
 * They are the same fact at two scales — no pick on one game, no sheet at all —
 * so they get one treatment. A reader who has learned the dashed stamp on their
 * own sheet recognises it on the board without being taught twice.
 *
 * ── Dashed, dim, no colour — deliberately ─────────────────────────────────
 *
 * This is not an error and not a loss. It is a blank that has been NAMED, and
 * naming it is the whole job: an unnamed blank reads as "not loaded yet", which
 * is the empty-versus-unknown split this feature keeps having to fix. Colour
 * would make it an alarm; the pill treatment would make it a status.
 *
 * ── Why a third file ──────────────────────────────────────────────────────
 *
 * `PickemSheetRow` renders one of these and `PickemMatchCard` / the head-to-head
 * render the other, and none of those contains the others. Same shape as
 * `PickemBackHeader` and `PickemUnassignedNote` — when two components need one
 * piece and neither owns the other, the piece gets its own file.
 */
export function PickemAbsenceNotice({
  label,
  testId,
  /**
   * ── TWO TREATMENTS, BECAUSE THE TWO PLACES ARE NOT ALIKE ──────────────────
   *
   * `stamp` (the default) is the sheet's: a dashed bordered chip pinned to a
   * row's corner, where it has to hold its own against a multiplier chip it
   * OVERLAPS and against a row that has faded to 0.38. It needs an edge to be
   * a thing at all up there.
   *
   * `caption` is the board's: plain light-grey text under a player's name,
   * inside a card that is already saying "not scoring" by muting the name.
   * A bordered chip there competes with the name it is annotating, and it
   * makes the cell taller — which is what pushed the two names in a row out of
   * alignment with each other.
   *
   * This is a deliberate split of what was ONE treatment, not drift. The
   * shared thing is the WORD and the fact; the chrome belongs to the place.
   */
  variant = "stamp",
  /**
   * An opaque fill, for the one caller that OVERLAPS something.
   *
   * On the sheet this stamp is pinned to the same corner as the multiplier chip
   * and sits over it, so it has to occlude rather than let the chip show
   * through. Nothing else overlaps, and a fill everywhere would put a second
   * surface colour on a board that already has one.
   */
  opaque = false,
}: {
  label: string;
  testId?: string;
  opaque?: boolean;
  variant?: "stamp" | "caption";
}) {
  if (variant === "caption") {
    return (
      <span
        data-testid={testId}
        className="shrink-0"
        style={{
          fontSize: TYPE_SCALE.micro,
          fontWeight: 600,
          letterSpacing: "0.06em",
          color: "var(--color-bt-text-dim)",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
    );
  }
  return (
    <span
      data-testid={testId}
      className="shrink-0 rounded px-1.5"
      style={{
        fontSize: TYPE_SCALE.caption,
        fontWeight: 700,
        letterSpacing: "0.08em",
        color: "var(--color-bt-text-dim)",
        border: "1px dashed var(--color-bt-border)",
        whiteSpace: "nowrap",
        ...(opaque ? { background: "var(--color-bt-card)" } : null),
      }}
    >
      {label}
    </span>
  );
}

/** The sheet's per-GAME absence: this contest, nobody's pick. */
export const NOT_PICKED = "NOT PICKED";
/** The board's per-SIDE absence: this person, no sheet at all. Shorter than
 *  "NOTHING SUBMITTED" because it now sits under a NAME, which supplies the
 *  subject the longer phrase was carrying. */
export const NO_PICKS = "NO PICKS";
