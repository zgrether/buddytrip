"use client";

import { GripVertical } from "lucide-react";

/**
 * DragHandle — the grab-affordance CELL of the Matches/Handicaps row grid (row
 * pattern Phase 1b). A single grid cell the consumer places in its own column
 * (`grab │ # │ … │ ×`). Dim, `cursor: grab`; forwards the drag-arm handlers and
 * **owns no drag state** (the parent arms its own draggable on mousedown).
 *
 * Centers its grip; pass `className`/`style` to place + span it (e.g. a 2v2 match
 * is two rows tall — the consumer makes the cell span both). Does NOT wrap or assume
 * `RowNumber` — Handicaps omits this cell entirely (handicaps don't reorder).
 */
export function DragHandle({
  onMouseDown,
  onMouseUp,
  className = "",
  style,
}: {
  /** Forwarded — the parent arms its own draggable on mousedown. */
  onMouseDown?: () => void;
  onMouseUp?: () => void;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <span
      onMouseDown={onMouseDown}
      onMouseUp={onMouseUp}
      aria-label="Drag to reorder"
      title="Drag to reorder"
      className={`flex cursor-grab items-center justify-center active:cursor-grabbing ${className}`}
      style={{ color: "var(--color-bt-text-dim)", touchAction: "none", ...style }}
    >
      <GripVertical size={16} />
    </span>
  );
}
