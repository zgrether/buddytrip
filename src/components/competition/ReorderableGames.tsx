"use client";

import { useState, type ReactNode } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type DraggableAttributes,
} from "@dnd-kit/core";
import type { SyntheticListenerMap } from "@dnd-kit/core/dist/hooks/utilities";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";

/**
 * Drag-to-reorder for the leaderboard's game rows.
 *
 * ── The handle sits OUTSIDE the row, not inside it ───────────────────────────
 * Every board row is itself a button or a link that opens the game. A handle
 * placed inside that element would share its tap target, and a drag would also
 * be a click. So the sortable node is a flex WRAPPER: handle first, the existing
 * row second, taking the remaining width.
 *
 * That is also what "the columns squish" means, and it costs `GameRow` /
 * `CompletedRow` nothing — neither is modified. They simply render into a
 * narrower box and their own layout absorbs it. It is why #867's `InReviewBadge`
 * (which substitutes for BOTH completed arms) cannot collide with the handle:
 * the badge is inside the row, and the row is just narrower.
 *
 * ── ONE DndContext PER SECTION ───────────────────────────────────────────────
 * This is what makes a cross-section drag impossible rather than merely
 * discouraged. A game's section IS its lifecycle state, and dragging cannot
 * change state — so the guarantee should be structural, not a rule enforced in
 * `onDragEnd`. Separate contexts mean a row in Ready has no droppable target in
 * Completed to begin with; there is no rejected drag to explain, because there
 * is no drag.
 *
 * ── The dnd-kit settings are REUSED, not rediscovered ────────────────────────
 * Every one was found by device testing on the matches board and the roster
 * (`TeamsPanel.tsx`), and they are copied here wholesale rather than re-derived:
 *
 *   1. PointerSensor with a DISTANCE activation (a handle drag, never a
 *      long-press, which on touch would fight the page scroll).
 *   2. KeyboardSensor with `sortableKeyboardCoordinates` — keyboard reorder.
 *   3. Stable ids — the game id, never the index. A positional id makes dnd-kit
 *      re-key every row on each move and the drag jumps.
 *   4. `DragOverlay` with `dropAnimation={null}` — the live reflow already shows
 *      the destination, so nothing needs to animate on release.
 *   5. Source row HIDDEN (opacity 0) while dragging — one visual object, not
 *      two; the row still occupies its slot so siblings reflow around a stable gap.
 *   6. `animateLayoutChanges: () => false` — dnd-kit's default animates every
 *      row whose index changed once a drag ends, layered on a possibly-still-
 *      settling transform. That read on device as neighbours re-seating at release.
 *   7. `WebkitTapHighlightColor: "transparent"` — unreset, mobile WebKit paints a
 *      native instantaneous highlight on whatever the release lands on.
 *
 * (The seventh established condition, a real scrollable ancestor, is a property
 * of the board this renders into rather than something set here.)
 */

/** The grip. `touch-none` is what stops the browser claiming the gesture as a
 *  scroll before dnd-kit's distance threshold is met. */
function DragHandle({
  attributes,
  listeners,
  label,
}: {
  // Loose on purpose: dnd-kit's `DraggableAttributes` has no index signature, and
  // the DragOverlay's inert copy passes `{}`. Both are just spread onto a button.
  attributes: Record<string, unknown> | DraggableAttributes;
  listeners: SyntheticListenerMap | undefined;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-label={`Reorder ${label}`}
      data-testid="game-drag-handle"
      className="flex h-8 w-6 shrink-0 cursor-grab touch-none items-center justify-center active:cursor-grabbing"
      style={{ color: "var(--color-bt-text-dim)", WebkitTapHighlightColor: "transparent" }}
      {...attributes}
      {...listeners}
    >
      <GripVertical size={16} />
    </button>
  );
}

function SortableRow({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    animateLayoutChanges: () => false,
  });
  return (
    <div
      ref={setNodeRef}
      className="flex items-center gap-1"
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0 : 1,
        WebkitTapHighlightColor: "transparent",
      }}
    >
      <DragHandle attributes={attributes} listeners={listeners} label={label} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/**
 * Wraps ONE section's rows in its own drag context.
 *
 * `ids` is the section's game ids in display order; `onReorder` receives the
 * section's ids in their NEW order. Turning that into the board-wide sequence is
 * the caller's job — the order is global, and only the caller knows the other
 * sections.
 *
 * When `enabled` is false this renders `children` untouched: no context, no
 * handles, no sortable wrappers. The board's default state costs nothing.
 */
export function ReorderableSection({
  enabled,
  ids,
  labelOf,
  renderRow,
  children,
  onReorder,
}: {
  enabled: boolean;
  ids: string[];
  /** Accessible name for a row's handle — the game's name. */
  labelOf: (id: string) => string;
  /** Renders one row by id. Used for both the live row and the drag overlay. */
  renderRow: (id: string) => ReactNode;
  /** What to render when reordering is off — the untouched existing list. */
  children: ReactNode;
  onReorder: (nextIds: string[]) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const [draggingId, setDraggingId] = useState<string | null>(null);

  if (!enabled) return <>{children}</>;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={(e: DragStartEvent) => setDraggingId(String(e.active.id))}
      onDragCancel={() => setDraggingId(null)}
      onDragEnd={(e: DragEndEvent) => {
        setDraggingId(null);
        const { active, over } = e;
        if (!over || active.id === over.id) return;
        const from = ids.indexOf(String(active.id));
        const to = ids.indexOf(String(over.id));
        if (from < 0 || to < 0) return;
        onReorder(arrayMove(ids, from, to));
      }}
    >
      {/* Stable ids — the game id, never the index. */}
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div className="flex flex-col">
          {ids.map((id) => (
            <SortableRow key={id} id={id} label={labelOf(id)}>
              {renderRow(id)}
            </SortableRow>
          ))}
        </div>
      </SortableContext>
      <DragOverlay dropAnimation={null}>
        {draggingId ? (
          <div
            className="flex items-center gap-1 rounded-xl"
            style={{
              // Lifted-card look (STYLE_GUIDE §1 Level 3) so the floating copy
              // reads as picked up rather than as a duplicate row.
              background: "var(--color-bt-card-raised)",
              boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
            }}
          >
            <DragHandle attributes={{}} listeners={undefined} label={labelOf(draggingId)} />
            <div className="min-w-0 flex-1">{renderRow(draggingId)}</div>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
