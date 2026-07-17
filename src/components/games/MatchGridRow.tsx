"use client";

import { RowNumber } from "@/components/games/RowNumber";

/**
 * MatchGridRow — the ONE row grammar the match-scoped settings panels share so their
 * columns line up when you scan down the page (Settings polish §E):
 *
 *     [ ] [#] [ side A ] vs [ side B ] [ value ]
 *
 * The value slot is what differs per panel — Point Distribution's points field,
 * Handicaps' relocated "Even" selector — while everything to its left is identical.
 * Built as ONE component with a value slot (NOT three panels styled to resemble each
 * other, which is how they drifted before). The number uses the shared `RowNumber`
 * (the Matches treatment), so all three number columns match.
 *
 * The leading 24px column is an empty spacer that lines these rows up under Matches'
 * grab-handle column (Matches keeps its own editable drag-grid — it owns the reorder
 * + 2v2-stacking the flex rows don't need — but shares this column template + the
 * RowNumber so #, A, vs, B all sit in the same place). `below` is the reveal slot
 * Handicaps uses for its stroke stepper.
 */
export const MATCH_ROW_GRID = "24px 22px minmax(0,1fr) auto minmax(0,1fr) auto";

export function MatchGridRow({
  number,
  sideA,
  sideB,
  value,
  isFirst = false,
  below,
  testId,
}: {
  number: number;
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
        {/* Empty spacer — aligns these rows under Matches' grab-handle column. */}
        <span aria-hidden="true" />
        <RowNumber number={number} />
        <div className="min-w-0">{sideA}</div>
        <span className="text-center" style={{ fontSize: 10, fontWeight: 700, color: "var(--color-bt-text-dim)" }}>vs</span>
        <div className="min-w-0">{sideB}</div>
        <div className="flex items-center justify-end">{value}</div>
      </div>
      {below != null && <div style={{ marginTop: 8 }}>{below}</div>}
    </div>
  );
}
