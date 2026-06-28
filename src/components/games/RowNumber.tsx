"use client";

/**
 * RowNumber — the index CELL of the Matches/Handicaps row grid (row pattern Phase
 * 1b). A single grid cell the consumer places in its own column. Dim, `tabular-nums`,
 * ~13px medium — reads as a quiet table index column.
 *
 * Centers the number; pass `className`/`style` to place + span it (a 2v2 match is two
 * rows tall — the consumer makes the cell span both). Independent of `DragHandle` —
 * Handicaps uses `RowNumber` alone (no reorder).
 */
export function RowNumber({
  number,
  className = "",
  style,
}: {
  number: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <span
      className={`flex items-center justify-center ${className}`}
      style={{ fontSize: 13, fontWeight: 500, color: "var(--color-bt-text-dim)", fontVariantNumeric: "tabular-nums", ...style }}
    >
      {number}
    </span>
  );
}
