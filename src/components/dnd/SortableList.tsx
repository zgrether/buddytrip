"use client";

// ── Touch-aware reorder primitive (app-wide DnD pass) ───────────────────────
//
// The ONE reorder mechanism for the app. Native HTML5 drag-and-drop has no touch
// support (iOS Safari has none at all), so every reorder surface that used
// `draggable` + `onDragStart`/`onDrop` routes through @dnd-kit here instead. A
// PointerSensor drives mouse + touch + pen identically, and a KeyboardSensor adds
// accessible reordering — one home for the interaction layer (mirrors the "one
// known home" discipline applied to data).
//
// `SortableList` covers the common case: a SINGLE vertical list reordered in
// place. Surfaces with cross-container drag (roster assign, agenda cross-day /
// comp-link) compose the dnd-kit primitives directly but share `useReorderSensors`
// so activation feels identical everywhere.

import type { CSSProperties, ReactNode } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToVerticalAxis, restrictToParentElement } from "@dnd-kit/modifiers";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

/**
 * Pure reorder math for a drop: given the current id order and the active/over
 * ids from a drag-end, return the new order — or `null` for a no-op (dropped on
 * itself, off any target, or an unknown id). Exported so the contract is unit-
 * testable without simulating dnd-kit pointer events.
 */
export function reorderOnDrop(
  ids: string[],
  activeId: string,
  overId: string | null | undefined
): string[] | null {
  if (!overId || activeId === overId) return null;
  const from = ids.indexOf(activeId);
  const to = ids.indexOf(overId);
  if (from < 0 || to < 0) return null;
  return arrayMove(ids, from, to);
}

/**
 * Shared sensor set for every reorder surface. A small pointer-distance gate
 * means a press that turns into a reorder is distinguished from a tap, so in-row
 * controls (★ / × / steppers / day-pickers) stay tappable and a list that also
 * scrolls keeps scrolling until the finger clearly drags. Keyboard sensor gives
 * an accessible reorder path (focus a handle → Space → arrows).
 */
export function useReorderSensors() {
  return useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
}

// The drag-handle props the row threads onto its grip. `useSortableRow` returns
// these; spread them onto the DragHandle (or any grip element) so only the grip
// initiates a drag — never the whole row, which keeps clicks/taps on row content
// working.
export interface DragHandleProps {
  ref: (el: HTMLElement | null) => void;
  [key: string]: unknown;
}

interface SortableRowState {
  setNodeRef: (el: HTMLElement | null) => void;
  style: CSSProperties;
  isDragging: boolean;
  handleProps: DragHandleProps;
}

/**
 * Per-row sortable wiring. Call inside a component rendered within `SortableList`
 * (or a bare `SortableContext`). Spread `handleProps` onto the grip, put
 * `setNodeRef` + `style` on the row container, and dim with `isDragging`.
 */
export function useSortableRow(id: string): SortableRowState {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging, setActivatorNodeRef } =
    useSortable({ id });
  return {
    setNodeRef,
    style: {
      transform: CSS.Transform.toString(transform),
      transition,
      // Keep the lifted row above its neighbours while it animates past them.
      zIndex: isDragging ? 1 : undefined,
    },
    isDragging,
    handleProps: {
      ref: setActivatorNodeRef,
      ...attributes,
      ...listeners,
    },
  };
}

/**
 * A single vertical sortable list. Pass the ordered `ids` and an `onReorder`
 * callback that receives the new id order after a drop; persist from there. The
 * drag is locked to the vertical axis and to the list bounds so it reads as a
 * pure reorder.
 */
export function SortableList({
  ids,
  onReorder,
  children,
  disabled = false,
}: {
  ids: string[];
  /** New id order after a drop. No-op drops (same position) are filtered out. */
  onReorder: (orderedIds: string[]) => void;
  children: ReactNode;
  /** Read-only viewers: keep the sortable context mounted (so per-row
   *  `useSortableRow` always has its provider) but make it inert — no sensors, no
   *  reorder. Rows simply don't render a drag handle, so nothing can start a drag. */
  disabled?: boolean;
}) {
  const sensors = useReorderSensors();

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    const next = reorderOnDrop(ids, String(active.id), over ? String(over.id) : null);
    if (next) onReorder(next);
  }

  return (
    <DndContext
      sensors={disabled ? undefined : sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis, restrictToParentElement]}
      onDragEnd={disabled ? undefined : handleDragEnd}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy} disabled={disabled}>
        {children}
      </SortableContext>
    </DndContext>
  );
}
