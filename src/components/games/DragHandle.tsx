"use client";

import { forwardRef } from "react";
import { GripVertical } from "lucide-react";

/**
 * DragHandle — the grab-affordance CELL of the Matches/Handicaps row grid (row
 * pattern Phase 1b). A single grid cell the consumer places in its own column
 * (`grab │ # │ … │ ×`). Dim, `cursor: grab`.
 *
 * Touch-aware DnD pass: the grip is now the @dnd-kit drag activator. Spread the
 * `handleProps` from `useSortableRow` onto it (ref + listeners + a11y attributes)
 * and the grip starts a pointer/touch/keyboard drag. `forwardRef` lets dnd-kit's
 * `setActivatorNodeRef` point at the grip so the activator is the grip alone — the
 * row content stays tappable. Any extra props (listeners, `aria-*`, `role`,
 * `tabIndex`, `onKeyDown`) are forwarded to the span.
 *
 * Centers its grip; pass `className`/`style` to place + span it (e.g. a 2v2 match
 * is two rows tall — the consumer makes the cell span both). Does NOT wrap or assume
 * `RowNumber` — Handicaps omits this cell entirely (handicaps don't reorder).
 */
export interface DragHandleProps extends React.HTMLAttributes<HTMLSpanElement> {
  className?: string;
  style?: React.CSSProperties;
}

export const DragHandle = forwardRef<HTMLSpanElement, DragHandleProps>(function DragHandle(
  { className = "", style, ...rest },
  ref
) {
  return (
    <span
      ref={ref}
      aria-label="Drag to reorder"
      title="Drag to reorder"
      {...rest}
      className={`flex cursor-grab items-center justify-center active:cursor-grabbing ${className}`}
      style={{ color: "var(--color-bt-text-dim)", touchAction: "none", ...style }}
    >
      <GripVertical size={16} />
    </span>
  );
});
