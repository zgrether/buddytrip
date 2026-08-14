"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
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
import { GripVertical, Shuffle } from "lucide-react";
import type { GroupBuilderTeam } from "@/components/games/rack/RackGroupBuilder";
import { entrantLabel } from "@/lib/bracketDraft";
import { firstOpponent } from "@/lib/bracket";

/**
 * SEEDING — the ORDER. Question 3 of 3.
 *
 * A drag-to-order list of the field, where a row is a player in Singles and a
 * PAIR in Partners. The order is the seeding: `buildDraw` assigns seeds by
 * index, so 1 plays last, 2 plays second-last, and so on. That standard pairing
 * is what makes the order meaningful rather than arbitrary, and it is why manual
 * ordering is worth having at all.
 *
 * ── No draw preview ─────────────────────────────────────────────────────────
 * The ordered list IS the preview. Each row shows the seed it holds and who it
 * meets first, which is the whole content a preview would carry; drawing the
 * tree twice (here and on the board) would be two renderings of one fact, and
 * the board is the one that stays true once play starts.
 *
 * ── The dnd-kit settings are REUSED, not rediscovered ───────────────────────
 * Copied wholesale from `ReorderableGames`, where every one of them was found by
 * device testing: distance-activated PointerSensor (never a long-press, which
 * fights page scroll on touch), keyboard sensor, stable ids (never the index),
 * `DragOverlay` with no drop animation, source row hidden while dragging,
 * `animateLayoutChanges: () => false`, and `WebkitTapHighlightColor: transparent`.
 *
 * Presentation-only (CLAUDE.md #7).
 */

function DragHandle({
  attributes,
  listeners,
  label,
}: {
  attributes: Record<string, unknown> | DraggableAttributes;
  listeners: SyntheticListenerMap | undefined;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-label={`Reorder ${label}`}
      data-testid="bracket-seed-handle"
      className="flex h-8 w-6 shrink-0 cursor-grab touch-none items-center justify-center active:cursor-grabbing"
      style={{ color: "var(--color-bt-text-dim)", WebkitTapHighlightColor: "transparent" }}
      {...attributes}
      {...listeners}
    >
      <GripVertical size={15} />
    </button>
  );
}

function SeedRow({
  id,
  seed,
  label,
  meets,
  color,
  draggable,
}: {
  id: string;
  seed: number;
  label: string;
  meets: string | null;
  color: string | null;
  draggable: boolean;
}) {
  return (
    <div
      className="flex items-center rounded-lg"
      style={{
        gap: 8,
        padding: "7px 10px",
        background: "var(--color-bt-card-raised)",
        border: "1px solid var(--color-bt-border)",
      }}
      data-testid={`bracket-seed-row-${id}`}
    >
      <span
        className="shrink-0 text-center"
        style={{ fontSize: 11, fontWeight: 700, color: "var(--color-bt-text-dim)", width: 18 }}
      >
        {seed}
      </span>
      <i style={{ width: 6, height: 6, borderRadius: "50%", background: color ?? "var(--color-bt-text-dim)", flexShrink: 0 }} />
      {/* ONE LINE — "Brad & Zach", never stacked. See `entrantLabel`. */}
      <span
        className="min-w-0 flex-1 truncate"
        style={{ fontSize: 12.5, fontWeight: 500, color: "var(--color-bt-text)" }}
      >
        {label}
      </span>
      <span className="shrink-0" style={{ fontSize: 10.5, color: "var(--color-bt-text-dim)" }}>
        {meets ?? "bye"}
      </span>
      {!draggable && <span style={{ width: 0 }} />}
    </div>
  );
}

function SortableSeedRow(props: React.ComponentProps<typeof SeedRow>) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.id,
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
      <DragHandle attributes={attributes} listeners={listeners} label={props.label} />
      <div className="min-w-0 flex-1">
        <SeedRow {...props} />
      </div>
    </div>
  );
}

/**
 * The Randomize confirm — a MODAL on the action, not a persisted setting.
 *
 * Asking here is what keeps the teammate constraint honest. As a stored mode
 * nobody could tell when it re-ran, and it would have to be re-applied (or
 * silently not) every time the field changed. As a question on the button it is
 * asked at the only moment the answer matters, and leaves no rule behind.
 *
 * ── The copy does not overpromise ───────────────────────────────────────────
 * "Spread teammates where possible", never "avoid teammates". `shufflePool`
 * deals round-robin across teams, which REDUCES same-team round-one meetings; an
 * unbalanced field (five from one team, one from another) forces adjacencies and
 * the function does not pretend otherwise. The shuffle still runs when it cannot
 * fully deliver — refusing would be worse, and the alternative the reader wants
 * is a different draw, not an error.
 */
export function RandomizeSeedsPrompt({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: (spreadTeammates: boolean) => void;
}) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center px-6"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onClick={onCancel}
      data-testid="randomize-seeds-prompt"
    >
      <div
        className="w-full max-w-sm rounded-2xl p-5"
        style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <p style={{ fontSize: 15, fontWeight: 700, color: "var(--color-bt-text)" }}>Randomize the seeding</p>
        <p style={{ marginTop: 8, fontSize: 13, color: "var(--color-bt-text-dim)" }}>
          Spreading teammates makes same-team first-round matchups less likely. It can&rsquo;t always avoid them — an
          uneven field forces some — but the shuffle still runs.
        </p>
        <div className="flex flex-col" style={{ gap: 8, marginTop: 16 }}>
          <button
            type="button"
            onClick={() => onConfirm(true)}
            className="rounded-lg px-3 py-2.5"
            style={{ fontSize: 13, fontWeight: 700, background: "var(--color-bt-accent)", color: "var(--color-bt-on-accent)" }}
            data-testid="randomize-spread"
          >
            Spread teammates where possible
          </button>
          <button
            type="button"
            onClick={() => onConfirm(false)}
            className="rounded-lg px-3 py-2.5"
            style={{
              fontSize: 13, fontWeight: 600,
              background: "var(--color-bt-card-raised)", color: "var(--color-bt-text)",
              border: "1px solid var(--color-bt-border)",
            }}
            data-testid="randomize-pure"
          >
            Pure random
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-3 py-2"
            style={{ fontSize: 13, fontWeight: 600, color: "var(--color-bt-text-dim)" }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function BracketSeedList({
  pool,
  teams,
  canEdit,
  onChange,
  onRandomize,
}: {
  /** Entrants in seed order — index 0 is seed 1. */
  pool: string[][];
  teams: GroupBuilderTeam[];
  canEdit: boolean;
  onChange: (next: string[][]) => void;
  /** Randomize was confirmed. The parent owns it because it also records HOW the
   *  order was last produced in `bracket_config.seeding`. */
  onRandomize: (spreadTeammates: boolean) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  const nameById = new Map<string, string>();
  const colorByMember = new Map<string, string>();
  for (const t of teams) for (const p of t.players) { nameById.set(p.id, p.name); colorByMember.set(p.id, t.color); }

  const entrants = pool.filter((e) => e.length > 0);
  // Stable ids — the entrant's membership, never the index. A positional id makes
  // dnd-kit re-key every row on each move and the drag jumps.
  const ids = entrants.map((e) => e.join("+"));
  const byId = new Map(entrants.map((e) => [e.join("+"), e]));

  const rowFor = (id: string) => {
    const entrant = byId.get(id) ?? [];
    const index = ids.indexOf(id);
    const opponent = firstOpponent(index, entrants.length);
    return {
      id,
      seed: index + 1,
      label: entrantLabel(entrant, nameById),
      meets: opponent === null ? null : `v ${opponent + 1}`,
      color: colorByMember.get(entrant[0]) ?? null,
      draggable: canEdit,
    };
  };

  return (
    <div className="flex flex-col" style={{ gap: 10 }} data-testid="bracket-seed-list">
      <div className="flex items-center justify-between" style={{ gap: 8 }}>
        <p style={{ fontSize: 12, color: "var(--color-bt-text-dim)" }}>
          Drag to set the order. Seed 1 plays the last seed, 2 plays the second-last.
        </p>
        <button
          type="button"
          disabled={!canEdit || entrants.length < 2}
          onClick={() => setAsking(true)}
          className="flex items-center rounded-lg"
          style={{
            gap: 5, padding: "6px 10px", fontSize: 12, fontWeight: 600,
            background: "var(--color-bt-card-raised)", color: "var(--color-bt-text)",
            border: "1px solid var(--color-bt-border)",
            opacity: !canEdit || entrants.length < 2 ? 0.5 : 1,
          }}
          data-testid="bracket-randomize"
        >
          <Shuffle size={12} />
          Randomize
        </button>
      </div>

      {entrants.length === 0 ? (
        <p style={{ fontSize: 12, color: "var(--color-bt-text-dim)" }}>
          Pick the field first — there is nothing to seed yet.
        </p>
      ) : !canEdit ? (
        <div className="flex flex-col" style={{ gap: 6 }}>
          {ids.map((id) => <SeedRow key={id} {...rowFor(id)} />)}
        </div>
      ) : (
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
            onChange(arrayMove(entrants, from, to));
          }}
        >
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <div className="flex flex-col" style={{ gap: 6 }}>
              {ids.map((id) => <SortableSeedRow key={id} {...rowFor(id)} />)}
            </div>
          </SortableContext>
          <DragOverlay dropAnimation={null}>
            {draggingId ? (
              <div
                className="flex items-center gap-1 rounded-lg"
                style={{ background: "var(--color-bt-card-raised)", boxShadow: "0 8px 24px rgba(0,0,0,0.35)" }}
              >
                <DragHandle attributes={{}} listeners={undefined} label={rowFor(draggingId).label} />
                <div className="min-w-0 flex-1">
                  <SeedRow {...rowFor(draggingId)} />
                </div>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      {asking && (
        <RandomizeSeedsPrompt
          onCancel={() => setAsking(false)}
          onConfirm={(spread) => { setAsking(false); onRandomize(spread); }}
        />
      )}
    </div>
  );
}
