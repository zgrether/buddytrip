"use client";

import { GripVertical } from "lucide-react";

/**
 * RowGutter — the shared row "spine" (Matches/Handicaps row pattern, Phase 1). A
 * recessed left gutter: an optional drag **handle** + the row **number**, de-emphasized
 * as table STRUCTURE (dim, `tabular-nums`), not matchup content.
 *
 * Owns NO drag state — it only forwards the handle's mouse events; the parent arms
 * its own draggable + owns reorder.
 *
 * Alignment: the handle's slot is **always reserved** (rendered empty when
 * `showHandle` is false) so the number — and the content column after the gutter —
 * line up whether or not the row reorders (Matches reorders, Handicaps doesn't).
 * Aligned to the row's FIRST content line (`items-start`), so a taller 2v2 match
 * (two stacked rows, Phase 2) keeps the number with its top row.
 */

// One content row's height — the handle/number center within this; `items-start`
// keeps them on the first line of a taller (2v2) row.
const LINE = 44;
const HANDLE_W = 22;
const NUMBER_W = 16;

export function RowGutter({
  number,
  showHandle = true,
  onHandleMouseDown,
  onHandleMouseUp,
}: {
  number: number;
  /** Reorderable rows show the grip; static rows (Handicaps) hide it — the slot is
   *  still reserved so the number stays in the same column. */
  showHandle?: boolean;
  /** Forwarded to the handle — the parent arms its own draggable on mousedown. */
  onHandleMouseDown?: () => void;
  onHandleMouseUp?: () => void;
}) {
  return (
    <div className="flex flex-shrink-0 items-start">
      <span
        onMouseDown={showHandle ? onHandleMouseDown : undefined}
        onMouseUp={showHandle ? onHandleMouseUp : undefined}
        aria-label={showHandle ? "Drag to reorder" : undefined}
        title={showHandle ? "Drag to reorder" : undefined}
        className={`flex items-center justify-center ${showHandle ? "cursor-grab active:cursor-grabbing" : ""}`}
        style={{ width: HANDLE_W, height: LINE, color: "var(--color-bt-text-dim)", touchAction: "none" }}
      >
        {showHandle && <GripVertical size={16} />}
      </span>
      <span
        className="flex items-center justify-center"
        style={{ width: NUMBER_W, height: LINE, fontSize: 13, fontWeight: 500, color: "var(--color-bt-text-dim)", fontVariantNumeric: "tabular-nums" }}
      >
        {number}
      </span>
    </div>
  );
}
