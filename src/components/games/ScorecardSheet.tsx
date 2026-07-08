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
  title?: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <Sheet
      title={title}
      subtitle={subtitle}
      onClose={onClose}
      maxWidthClass="max-w-2xl"
      bodyClassName="p-0"
      testId="scorecard-sheet"
    >
      {children}
    </Sheet>
  );
}
