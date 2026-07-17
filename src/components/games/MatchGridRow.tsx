"use client";

import { MatchNumberBadge } from "@/components/games/MatchNumberBadge";

/**
 * MatchGridRow — the ONE row grammar the match-scoped settings panels share so their
 * columns line up when you scan down the page (Settings polish §E):
 *
 *     [# / shape] [ side A ] vs [ side B ] [ value ]
 *
 * The value slot is what differs per panel — Point Distribution's points field,
 * Handicaps' relocated "Even" selector — while everything to its left is identical.
 * Built as ONE component with a value slot (NOT three panels styled to resemble each
 * other, which is how they drifted before). The leading cell is the shared
 * `MatchNumberBadge` (number + 1V1/2V2 tag), the same cell the Matches panel uses.
 *
 * No drag-handle spacer: these rows start at the number (they don't reorder), so they
 * don't reserve Matches' grab-handle column. `below` is the reveal slot Handicaps
 * uses for its stroke stepper.
 */
export const MATCH_ROW_GRID = "auto minmax(0,1fr) auto minmax(0,1fr) auto";

export function MatchGridRow({
  number,
  playersPerSide,
  sideA,
  sideB,
  value,
  isFirst = false,
  below,
  testId,
}: {
  number: number;
  /** Drives the 1V1/2V2 shape tag under the number. */
  playersPerSide: number;
  sideA: React.ReactNode;
  sideB: React.ReactNode;
  /** The right-column value — × (Matches), points field (Point Distribution), or the
   *  "Even" selector (Handicaps). */
  value: React.ReactNode;
  /** No top hairline on the first row (the separator delimits BETWEEN matches). */
  isFirst?: boolean;
  /** Optional reveal beneath the row — Handicaps' stroke stepper + caption. */
  below?: React.ReactNode;
  testId?: string;
}) {
  return (
    <div
      style={{
        borderTop: isFirst ? undefined : "1px solid var(--color-bt-border)",
        paddingTop: isFirst ? 0 : 12,
        paddingBottom: 12,
      }}
      data-testid={testId}
    >
      <div className="grid items-center" style={{ gridTemplateColumns: MATCH_ROW_GRID, gap: 8 }}>
        <MatchNumberBadge number={number} playersPerSide={playersPerSide} />
        <div className="min-w-0">{sideA}</div>
        <span className="text-center" style={{ fontSize: 10, fontWeight: 700, color: "var(--color-bt-text-dim)" }}>vs</span>
        <div className="min-w-0">{sideB}</div>
        <div className="flex items-center justify-end">{value}</div>
        {/* The reveal sits on a second grid row spanning the matchup columns (sideA ·
            vs · sideB). sideA and sideB are equal (1fr), so the CENTER of that span is
            the vs column — the reveal's own inner centering lands it under "vs". */}
        {below != null && <div style={{ gridColumn: "2 / 5", marginTop: 4 }}>{below}</div>}
      </div>
    </div>
  );
}
