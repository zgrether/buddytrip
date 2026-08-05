"use client";

import { Sheet } from "@/components/Sheet";

/**
 * ScorecardSheet — the golf scorecard as a slide-in overlay (composing the shared
 * `Sheet` primitive, NOT a new overlay). The scorecard "floats": it's a layer
 * reachable from the leaderboard, the game scoreboard, and score entry, and it
 * dismisses back to whichever called it — never a rung in the nav spine.
 *
 * It's narrower than a full page on purpose: the `StandardGrid` inside owns its
 * own horizontal scroll + sticky first column (and the #562 opaque-fill fix), so
 * it scrolls left-right within the sheet rather than needing full-page width. The
 * body is full-bleed (`p-0`) so the grid runs edge-to-edge; the sheet's title +
 * ✕ header replaces the old bespoke 52px "‹ Back / Scorecard" bar. Dismiss = tap
 * the scrim, the ✕, or (where the caller wires it) browser back.
 *
 * The caller passes the already-built `<StandardGrid>` as children so each format
 * keeps ownership of its own grid props (values / saveStatus / onCellTap live in
 * the caller's useScoreSaver — that locality is what preserves in-progress entry,
 * #543).
 */
export function ScorecardSheet({
  title = "Scorecard",
  subtitle,
  onClose,
  children,
}: {
  /** The LABEL — "Scorecard", or "Scorecard · Final" once locked. Secondary. */
  title?: string;
  /** The COURSE name. Primary when present — it is what identifies this card. */
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  // The course leads. These arrived as title="Scorecard · Final" /
  // subtitle=<course>, which put the generic label in the heading slot and the
  // one identifying fact underneath it in smaller dim text — every scorecard in
  // the app announced itself with the same word. Swapped HERE rather than at the
  // six call sites so the hierarchy can't be got right in some and wrong in
  // others; the props keep their caller-facing meaning (label / course).
  // No course applied → the label leads, since there is nothing else to say.
  return (
    <Sheet
      title={subtitle ?? title}
      subtitle={subtitle ? title : undefined}
      onClose={onClose}
      maxWidthClass="max-w-2xl"
      bodyClassName="p-0"
      testId="scorecard-sheet"
    >
      {children}
    </Sheet>
  );
}
