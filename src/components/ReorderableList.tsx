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
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, ChevronUp, GripVertical } from "lucide-react";
import { canMoveBy, moveBy, moveItem } from "@/lib/reorderList";

/**
 * The reorder primitive — drag-to-order plus an arrow fallback, in one place.
 *
 * ── Why this exists, and why now ────────────────────────────────────────────
 * Six drag-to-reorder implementations existed before this file, with no shared
 * component: `ReorderableGames`, `CompetitionGamesPanel`, `TeamsPanel`,
 * `BracketSeedList` and `MatchGameView` on dnd-kit, plus `NewsComposer` /
 * `NewsPanel` on plain arrow buttons. What WAS shared was a seven-point settings
 * recipe, written down in `ReorderableGames.tsx`, whose header says it was
 * "REUSED, not rediscovered" — every setting found by device testing on the
 * matches board and the roster, then copied wholesale.
 *
 * A recipe copied by hand into five files is an extraction that has not
 * happened yet. This is the extraction, and pick'em's confidence list is its
 * first consumer.
 *
 * ── The six existing consumers are NOT migrated ─────────────────────────────
 * Deliberately. They work, they are on a shipping path, and rewriting five
 * surfaces to prove a primitive is the trade that turns a small PR into a
 * regression hunt across the whole app. The migration is filed separately. The
 * rule CLAUDE.md states — pick'em should be an extraction's first consumer, not
 * its justification — is satisfied by the six that already exist: the
 * justification predates pick'em by five surfaces.
 *
 * ── The seven points, preserved verbatim in behaviour ───────────────────────
 * Each was established by device testing, and none should be "cleaned up"
 * without repeating that testing:
 *
 *   1. `PointerSensor` with a DISTANCE activation (4px) — a handle drag, never
 *      a long-press, which on touch would fight the page scroll.
 *   2. `KeyboardSensor` with `sortableKeyboardCoordinates` — keyboard reorder.
 *   3. Stable ids, never the index. A positional id makes dnd-kit re-key every
 *      row on each move and the drag jumps.
 *   4. `DragOverlay` with `dropAnimation={null}` — the live reflow already
 *      shows the destination, so nothing needs to animate on release.
 *   5. Source row HIDDEN (opacity 0) while dragging — one visual object, not
 *      two; the row still occupies its slot so siblings reflow around a stable
 *      gap.
 *   6. `animateLayoutChanges: () => false` — dnd-kit's default animates every
 *      row whose index changed once a drag ends, layered on a possibly-still-
 *      settling transform. On device that read as neighbours re-seating at
 *      release.
 *   7. `WebkitTapHighlightColor: "transparent"` — unreset, mobile WebKit paints
 *      a native instantaneous highlight on whatever the release lands on.
 *
 * Plus `touch-none` on the grip, which is what stops the browser claiming the
 * gesture as a scroll before the distance threshold is met. The eighth
 * condition from the original list — a real scrollable ancestor — is a property
 * of the host, not something this can set.
 *
 * ── Arrows are not an accessibility afterthought ────────────────────────────
 * They ship alongside the grip, per `NewsComposer`'s precedent. Pick'em's
 * confidence list is sixteen rows on a phone inside a scrollable panel, which
 * is the hardest drag in the app, and arrows never fail. They are also the only
 * reorder path this repo's test environment can exercise, since `environment:
 * "node"` means components are rendered, never clicked — the arithmetic behind
 * them lives in `@/lib/reorderList` and is unit-tested directly.
 *
 * ── Presentation-only ───────────────────────────────────────────────────────
 * No tRPC, no DB, no auth (CLAUDE.md #7). Every value arrives as a prop and
 * every change leaves through `onReorder`, which receives the FULL new id order
 * — never a delta. The caller owns persistence.
 */

/** Where the grip and arrows sit relative to the row's own content. */
export type ReorderControlsSide = "leading" | "trailing";

function Grip({
  attributes,
  listeners,
  label,
}: {
  // Loose on purpose: dnd-kit's `DraggableAttributes` has no index signature,
  // and the DragOverlay's inert copy passes `{}`. Both are only spread onto a
  // button.
  attributes: Record<string, unknown> | DraggableAttributes;
  listeners: SyntheticListenerMap | undefined;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-label={`Reorder ${label}`}
      data-testid="reorder-grip"
      className="flex h-8 w-6 shrink-0 cursor-grab touch-none items-center justify-center active:cursor-grabbing"
      style={{ color: "var(--color-bt-text-dim)", WebkitTapHighlightColor: "transparent" }}
      {...attributes}
      {...listeners}
    >
      <GripVertical size={16} />
    </button>
  );
}

/** The touch/keyboard fallback. Disabled state and click target read the SAME
 *  `canMoveBy`, so an arrow can never be enabled and inert. */
function Arrows({
  index,
  count,
  label,
  onMove,
}: {
  index: number;
  count: number;
  label: string;
  onMove: (delta: number) => void;
}) {
  const upEnabled = canMoveBy(index, -1, count);
  const downEnabled = canMoveBy(index, 1, count);
  return (
    <div className="flex shrink-0 flex-col" style={{ gap: 2 }}>
      <button
        type="button"
        aria-label={`Move ${label} up`}
        data-testid="reorder-up"
        disabled={!upEnabled}
        onClick={() => onMove(-1)}
        className="flex h-4 w-6 items-center justify-center rounded transition-colors hover:bg-[var(--color-bt-hover)] disabled:opacity-30"
        style={{ color: "var(--color-bt-text-dim)", WebkitTapHighlightColor: "transparent" }}
      >
        <ChevronUp size={12} />
      </button>
      <button
        type="button"
        aria-label={`Move ${label} down`}
        data-testid="reorder-down"
        disabled={!downEnabled}
        onClick={() => onMove(1)}
        className="flex h-4 w-6 items-center justify-center rounded transition-colors hover:bg-[var(--color-bt-hover)] disabled:opacity-30"
        style={{ color: "var(--color-bt-text-dim)", WebkitTapHighlightColor: "transparent" }}
      >
        <ChevronDown size={12} />
      </button>
    </div>
  );
}

function Controls({
  attributes,
  listeners,
  label,
  index,
  count,
  arrows,
  onMove,
}: {
  attributes: Record<string, unknown> | DraggableAttributes;
  listeners: SyntheticListenerMap | undefined;
  label: string;
  index: number;
  count: number;
  arrows: boolean;
  onMove: (delta: number) => void;
}) {
  return (
    <div className="flex shrink-0 items-center" style={{ gap: 2 }}>
      {arrows ? <Arrows index={index} count={count} label={label} onMove={onMove} /> : null}
      <Grip attributes={attributes} listeners={listeners} label={label} />
    </div>
  );
}

function SortableRow({
  id,
  label,
  index,
  count,
  arrows,
  controlsSide,
  rowClassName,
  onMove,
  children,
}: {
  id: string;
  label: string;
  index: number;
  count: number;
  arrows: boolean;
  controlsSide: ReorderControlsSide;
  rowClassName?: string;
  onMove: (delta: number) => void;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    animateLayoutChanges: () => false,
  });
  const controls = (
    <Controls
      attributes={attributes}
      listeners={listeners}
      label={label}
      index={index}
      count={count}
      arrows={arrows}
      onMove={onMove}
    />
  );
  return (
    <div
      ref={setNodeRef}
      className={`flex items-center gap-1 ${rowClassName ?? ""}`}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0 : 1,
        WebkitTapHighlightColor: "transparent",
      }}
    >
      {controlsSide === "leading" ? controls : null}
      <div className="min-w-0 flex-1">{children}</div>
      {controlsSide === "trailing" ? controls : null}
    </div>
  );
}

export function ReorderableList({
  ids,
  labelOf,
  renderRow,
  onReorder,
  enabled = true,
  arrows = true,
  controlsSide = "leading",
  listClassName = "flex flex-col gap-2",
  rowClassName,
  disabledFallback,
}: {
  /** The rows, in display order. Ids must be STABLE — never an array index. */
  ids: string[];
  /** Accessible name for a row's controls. */
  labelOf: (id: string) => string;
  /** Renders one row's content. `index` is its position, which is what a
   *  confidence list needs to show a rank derived from position. */
  renderRow: (id: string, index: number) => ReactNode;
  /** Receives the FULL new order, never a delta — the caller persists it. */
  onReorder: (nextIds: string[]) => void;
  /** When false, `disabledFallback` renders (or the plain rows if omitted): no
   *  context, no handles, no sortable wrappers, no cost. */
  enabled?: boolean;
  arrows?: boolean;
  controlsSide?: ReorderControlsSide;
  /**
   * The list wrapper's className. Passed rather than hardcoded because
   * `ReorderableGames` learned the hard way that a hardcoded `"flex flex-col"`
   * silently DROPS the caller's row spacing the moment reordering turns on —
   * the squish is supposed to narrow the columns, not collapse the vertical
   * rhythm. One place either path can get it from.
   */
  listClassName?: string;
  rowClassName?: string;
  /** What to render when `enabled` is false — typically the caller's own
   *  untouched read-only list. */
  disabledFallback?: ReactNode;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const [draggingId, setDraggingId] = useState<string | null>(null);

  if (!enabled) {
    return (
      <>
        {disabledFallback ?? (
          <div className={listClassName}>
            {ids.map((id, i) => (
              <div key={id} className={rowClassName}>
                {renderRow(id, i)}
              </div>
            ))}
          </div>
        )}
      </>
    );
  }

  const move = (index: number, delta: number) => {
    const next = moveBy(ids, index, delta);
    // Reference equality means the move was refused at an end — emitting there
    // would hand the caller a "change" that changed nothing, and a draft-dirty
    // flag downstream would light up for a tap that did not move anything.
    if (next !== ids) onReorder(next);
  };

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
        onReorder(moveItem(ids, from, to));
      }}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div className={listClassName}>
          {ids.map((id, i) => (
            <SortableRow
              key={id}
              id={id}
              label={labelOf(id)}
              index={i}
              count={ids.length}
              arrows={arrows}
              controlsSide={controlsSide}
              rowClassName={rowClassName}
              onMove={(delta) => move(i, delta)}
            >
              {renderRow(id, i)}
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
            {controlsSide === "leading" ? (
              <Controls
                attributes={{}}
                listeners={undefined}
                label={labelOf(draggingId)}
                index={ids.indexOf(draggingId)}
                count={ids.length}
                arrows={arrows}
                onMove={() => {}}
              />
            ) : null}
            <div className="min-w-0 flex-1">
              {renderRow(draggingId, ids.indexOf(draggingId))}
            </div>
            {controlsSide === "trailing" ? (
              <Controls
                attributes={{}}
                listeners={undefined}
                label={labelOf(draggingId)}
                index={ids.indexOf(draggingId)}
                count={ids.length}
                arrows={arrows}
                onMove={() => {}}
              />
            ) : null}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
