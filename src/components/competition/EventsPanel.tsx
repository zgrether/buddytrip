"use client";

import { useRef, useState } from "react";
import {
  AlertTriangle,
  Calendar,
  ChevronDown,
  ChevronUp,
  Flag,
  GripVertical,
  Info,
  MapPin,
  Pencil,
  Plus,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { trpc } from "@/lib/trpc-client";

interface Props {
  competitionId: string;
  tripId: string;
  canEdit: boolean;
}

type EventType = "GOLF" | "GENERIC";
type ScoringFormat =
  | "scramble"
  | "stableford"
  | "skins"
  | "match_play"
  | "singles"
  | "sabotage"
  | "other";

interface PointDistribution {
  id?: string;
  position: number;
  label: string;
  points: number;
}

interface AgendaItemLink {
  id: string;
  title: string;
  item_type: string;
  course_name: string | null;
  scheduled_date: string | null;
}

export interface EventRow {
  id: string;
  competition_id: string;
  type: EventType;
  title: string;
  description: string | null;
  scoring_format: ScoringFormat | null;
  is_practice: boolean;
  points_available: number | null;
  sort_order: number;
  status: "upcoming" | "active" | "completed";
  point_distributions?: PointDistribution[];
  agenda_item?: AgendaItemLink | null;
}

// Shared dataTransfer key — ScheduleTab reads this when a competition
// event is dropped onto an agenda item.
export const DND_EVENT_KEY = "application/x-buddytrip-event-id";

const FORMAT_LABELS: Record<ScoringFormat, string> = {
  scramble: "Scramble",
  stableford: "Stableford",
  skins: "Skins",
  match_play: "Match Play",
  singles: "Singles",
  sabotage: "Sabotage",
  other: "Other",
};

// ── EventsPanel ─────────────────────────────────────────────────────────────

export function EventsPanel({ competitionId, tripId, canEdit }: Props) {
  const [editing, setEditing] = useState<EventRow | null>(null);
  const [creating, setCreating] = useState(false);
  const dragState = useRef<{ idx: number } | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  // Separate state for isDragging — refs must not be read during render.
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);

  const utils = trpc.useUtils();
  const { data: events = [] } = trpc.events.list.useQuery(
    { tripId, competitionId },
    { enabled: !!competitionId }
  );

  const eventsTyped = events as EventRow[];

  const reorder = trpc.events.reorder.useMutation({
    async onMutate(vars) {
      await utils.events.list.cancel({ tripId, competitionId });
      const prev = utils.events.list.getData({ tripId, competitionId });
      const orderMap = new Map(vars.orderedIds.map((id, i) => [id, i]));
      utils.events.list.setData({ tripId, competitionId }, (old) =>
        (old as EventRow[] | undefined)
          ?.map((e) => {
            const newOrder = orderMap.get(e.id);
            return newOrder !== undefined ? { ...e, sort_order: newOrder } : e;
          })
          .sort((a, b) => a.sort_order - b.sort_order) as never
      );
      return { prev };
    },
    onError(_e, _v, ctx) {
      if (ctx?.prev) utils.events.list.setData({ tripId, competitionId }, ctx.prev);
    },
    onSettled: () => utils.events.list.invalidate({ tripId, competitionId }),
  });

  const handleReorderDrop = (toIdx: number) => {
    if (!dragState.current) return;
    const fromIdx = dragState.current.idx;
    dragState.current = null;
    setDraggingIdx(null);
    setDragOverIdx(null);
    if (fromIdx === toIdx) return;
    const newOrder = [...eventsTyped];
    const [moved] = newOrder.splice(fromIdx, 1);
    newOrder.splice(toIdx, 0, moved);
    reorder.mutate({ tripId, competitionId, orderedIds: newOrder.map((e) => e.id) });
  };

  // Touch-friendly reorder used by the up/down arrows on the event card.
  // Drag-and-drop requires mouse/pointer events so doesn't work on most
  // tablets and phones in touch mode — these buttons cover that gap.
  //
  // The move runs through a FLIP animation (First Last Invert Play) so
  // both swapped cards slide into their new positions over 280ms — same
  // duration as the crew-assignment fade so the motion vocabulary is
  // consistent across the competition surface.
  const listRef = useRef<HTMLDivElement>(null);

  const moveEvent = (idx: number, direction: -1 | 1) => {
    const target = idx + direction;
    if (target < 0 || target >= eventsTyped.length) return;

    // 1. Snapshot current positions of every card BEFORE the mutation.
    const container = listRef.current;
    const before = new Map<string, number>();
    if (container) {
      container
        .querySelectorAll<HTMLElement>("[data-event-card]")
        .forEach((el) => {
          const id = el.dataset.eventCard;
          if (id) before.set(id, el.getBoundingClientRect().top);
        });
    }

    // 2. Fire the optimistic reorder — the cache updates and React
    //    re-renders with the new order, repainting cards in place.
    const newOrder = [...eventsTyped];
    [newOrder[idx], newOrder[target]] = [newOrder[target], newOrder[idx]];
    reorder.mutate({
      tripId,
      competitionId,
      orderedIds: newOrder.map((e) => e.id),
    });

    if (!container) return;

    // 3. After React commits the new order (two rAFs to be safe),
    //    measure new positions, jump each moved card back to its OLD
    //    spot via translateY, then transition that transform to 0.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        container
          .querySelectorAll<HTMLElement>("[data-event-card]")
          .forEach((el) => {
            const id = el.dataset.eventCard;
            if (!id) return;
            const oldTop = before.get(id);
            if (oldTop == null) return;
            const newTop = el.getBoundingClientRect().top;
            const delta = oldTop - newTop;
            if (delta === 0) return;

            // Invert: place the card at its previous position visually
            el.style.transition = "none";
            el.style.transform = `translateY(${delta}px)`;
            // Force layout flush so the next transition is observable
            void el.offsetHeight;
            // Play: animate back to the natural position
            el.style.transition = "transform 280ms ease-out";
            el.style.transform = "";
            // Cleanup once the animation finishes
            window.setTimeout(() => {
              el.style.transition = "";
            }, 300);
          });
      });
    });
  };

  const totalEvents = eventsTyped.length;
  const practiceCount = eventsTyped.filter((e) => e.is_practice).length;
  const unlinkedGolf = eventsTyped.filter((e) => e.type === "GOLF" && !e.is_practice && !e.agenda_item).length;

  const statusText = `${totalEvents} event${totalEvents === 1 ? "" : "s"}${
    practiceCount > 0 ? ` · ${practiceCount} practice` : ""
  }${unlinkedGolf > 0 ? ` · ${unlinkedGolf} unlinked` : ""}`;

  const body = (
    <>
      {eventsTyped.length === 0 && <EventsEmptyState canEdit={canEdit} />}

      <div ref={listRef} className="space-y-2">
        {eventsTyped.map((event, idx) => (
          <EventCard
            key={event.id}
            event={event}
            canEdit={canEdit}
            tripId={tripId}
            isDragging={draggingIdx === idx}
            showDropIndicator={dragOverIdx === idx && draggingIdx !== idx}
            isFirst={idx === 0}
            isLast={idx === eventsTyped.length - 1}
            onEdit={() => setEditing(event)}
            onMoveUp={() => moveEvent(idx, -1)}
            onMoveDown={() => moveEvent(idx, 1)}
            onDragStart={() => { dragState.current = { idx }; setDraggingIdx(idx); }}
            onDragOver={() => setDragOverIdx(idx)}
            onDrop={() => handleReorderDrop(idx)}
          />
        ))}
      </div>

      {(creating || editing) && (
        <EventSheet
          tripId={tripId}
          competitionId={competitionId}
          event={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
        />
      )}
    </>
  );

  return (
    <div
      data-testid="events-panel"
      className="overflow-hidden rounded-xl"
      style={{ border: "1px solid var(--color-bt-border)" }}
    >
      {/* Section header */}
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span
            style={{ color: totalEvents > 0 ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)" }}
            aria-hidden
          >
            <Calendar size={16} />
          </span>
          <div>
            <p className="text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>
              Event Schedule
            </p>
            <p className="text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>
              {statusText}
            </p>
          </div>
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold"
            style={{
              background: "var(--color-bt-accent)",
              color: "var(--color-bt-base)",
            }}
          >
            <Plus size={12} />
            Event
          </button>
        )}
      </div>

      <div
        className="px-4 pb-4 pt-3"
        style={{ borderTop: "1px solid var(--color-bt-border)" }}
      >
        {body}
      </div>
    </div>
  );
}

// ── EventsEmptyState ────────────────────────────────────────────────────────

function EventsEmptyState({ canEdit }: { canEdit: boolean }) {
  return (
    <div className="px-2 py-6 text-center">
      <p
        className="text-xs leading-relaxed"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        No events yet.
        {canEdit
          ? " Tap + Event above to add the rounds and activities you'll compete in."
          : " Check back once the organizer adds rounds and activities."}
      </p>
    </div>
  );
}

export function AddEventButton({
  onClick,
  className,
}: {
  onClick: () => void;
  className?: string;
}) {
  // Matches the Lodging/Schedule "+ Item / + Property" affordance:
  // card-raised background, regular border, icon-then-Plus-then-noun.
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-medium transition-all ${
        className ?? ""
      }`}
      style={{
        background: "var(--color-bt-card-raised)",
        color: "var(--color-bt-text)",
        border: "1px solid var(--color-bt-border)",
      }}
    >
      <Flag size={15} />
      <Plus size={12} /> Event
    </button>
  );
}

// ── EventCard ───────────────────────────────────────────────────────────────

function EventCard({
  event,
  canEdit,
  tripId,
  isDragging,
  showDropIndicator,
  isFirst,
  isLast,
  onEdit,
  onMoveUp,
  onMoveDown,
  onDragStart,
  onDragOver,
  onDrop,
}: {
  event: EventRow;
  canEdit: boolean;
  tripId: string;
  isDragging: boolean;
  showDropIndicator: boolean;
  isFirst: boolean;
  isLast: boolean;
  onEdit: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDragStart: () => void;
  onDragOver: () => void;
  onDrop: () => void;
}) {
  const isGolf = event.type === "GOLF";

  const statusLine = describeStatus(event);

  // Per-place breakdown — small caption line under the title. Shown
  // only for non-practice events that have at least one place defined.
  const distSummary =
    !event.is_practice && (event.point_distributions?.length ?? 0) > 0
      ? event
          .point_distributions!.slice()
          .sort((a, b) => a.position - b.position)
          .map(
            (d) =>
              `${ordinalShort(d.position)}: ${d.points}`
          )
          .join(" · ")
      : null;

  return (
    <>
      {/* Drop insertion line */}
      {showDropIndicator && (
        <div
          className="mb-1 h-0.5 rounded-full"
          style={{ background: "var(--color-bt-accent)" }}
        />
      )}
      <div
        draggable={canEdit}
        onDragStart={canEdit ? (e) => {
          e.dataTransfer.setData(DND_EVENT_KEY, event.id);
          e.dataTransfer.effectAllowed = "move";
          onDragStart();
        } : undefined}
        onDragOver={canEdit ? (e) => {
          if (!e.dataTransfer.types.includes(DND_EVENT_KEY)) return;
          e.preventDefault();
          onDragOver();
        } : undefined}
        onDrop={canEdit ? (e) => {
          e.preventDefault();
          onDrop();
        } : undefined}
        onDragEnd={canEdit ? () => { /* cleanup handled by parent */ } : undefined}
        className={`flex items-start gap-3 rounded-xl px-3 py-3 ${
          canEdit ? "cursor-grab active:cursor-grabbing" : ""
        }`}
        style={{
          background: "var(--color-bt-card-raised)",
          border: "1px solid var(--color-bt-border)",
          opacity: isDragging ? 0.4 : event.is_practice ? 0.85 : 1,
        }}
        data-testid={`event-card-${event.id}`}
        data-event-card={event.id}
      >
        {canEdit && (
          <>
            <GripVertical
              size={16}
              className="mt-0.5 hidden flex-shrink-0 lg:block"
              strokeWidth={2}
              style={{ color: "var(--color-bt-text-dim)" }}
            />
            {/* Touch-friendly reorder arrows — shown on widths below lg
                where drag-drop is unreliable (most tablets / phones). */}
            <div className="flex flex-shrink-0 flex-col lg:hidden">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onMoveUp();
                }}
                disabled={isFirst}
                aria-label="Move event up"
                className="flex h-5 w-6 items-center justify-center rounded transition-opacity disabled:opacity-25"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                <ChevronUp size={14} strokeWidth={2.25} />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onMoveDown();
                }}
                disabled={isLast}
                aria-label="Move event down"
                className="flex h-5 w-6 items-center justify-center rounded transition-opacity disabled:opacity-25"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                <ChevronDown size={14} strokeWidth={2.25} />
              </button>
            </div>
          </>
        )}
        <div
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg"
          style={{
            background: "var(--color-bt-accent-faint)",
            color: "var(--color-bt-accent)",
          }}
        >
          {isGolf ? <Flag size={15} /> : <Star size={15} />}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <p className="text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>
              {event.title}
            </p>
            {!event.is_practice && event.points_available !== null && (
              <span
                className="text-[11px] font-semibold tabular-nums"
                style={{ color: "var(--color-bt-accent)" }}
              >
                {event.points_available} pt{event.points_available === 1 ? "" : "s"}
              </span>
            )}
            {isGolf && event.scoring_format && (
              <span
                className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase"
                style={{
                  background: "var(--color-bt-card)",
                  color: "var(--color-bt-text-dim)",
                  border: "1px solid var(--color-bt-border)",
                }}
              >
                {FORMAT_LABELS[event.scoring_format]}
              </span>
            )}
            {event.is_practice && (
              <span
                className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase"
                style={{
                  background: "var(--color-bt-warning-faint)",
                  color: "var(--color-bt-warning)",
                }}
              >
                Practice
              </span>
            )}
          </div>

          {distSummary && (
            <p
              className="mt-0.5 text-[10px] tabular-nums"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              {distSummary}
            </p>
          )}

          {statusLine && (
            <div
              className="mt-0.5 flex items-center gap-1 text-[11px]"
              style={{ color: statusLine.color }}
            >
              <statusLine.Icon size={11} />
              <span>{statusLine.text}</span>
            </div>
          )}
        </div>

        {canEdit && (
          <div className="flex flex-shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={onEdit}
              aria-label={`Edit ${event.title}`}
              className="flex h-7 w-7 items-center justify-center rounded-lg"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              <Pencil size={13} />
            </button>
          </div>
        )}
      </div>
    </>
  );
}

// ── DeleteEventConfirmModal ─────────────────────────────────────────────────

function DeleteEventConfirmModal({
  eventTitle,
  isPending,
  onCancel,
  onConfirm,
}: {
  eventTitle: string;
  isPending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      style={{ background: "var(--color-bt-overlay)" }}
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-t-2xl sm:rounded-2xl"
        style={{
          background: "var(--color-bt-card-float)",
          border: "1px solid var(--color-bt-border)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-5 pb-3 text-center sm:text-left">
          <div
            className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl sm:mx-0"
            style={{
              background: "var(--color-bt-danger-faint)",
              color: "var(--color-bt-danger)",
            }}
          >
            <Trash2 size={18} />
          </div>
          <h3
            className="mt-3 text-base font-bold"
            style={{ color: "var(--color-bt-text)" }}
          >
            Delete &ldquo;{eventTitle}&rdquo;?
          </h3>
          <p
            className="mt-1.5 text-sm leading-relaxed"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            Removes the event and its point distribution. Any agenda item it was
            linked to becomes unlinked.
          </p>
        </div>
        <div className="flex flex-col-reverse gap-2 px-5 pb-5 pt-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={isPending}
            className="rounded-xl px-4 py-2.5 text-sm font-medium disabled:opacity-50"
            style={{
              background: "transparent",
              color: "var(--color-bt-text-dim)",
              border: "0.5px solid var(--color-bt-border)",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isPending}
            className="rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: "var(--color-bt-danger)" }}
          >
            {isPending ? "Deleting…" : "Delete Event"}
          </button>
        </div>
      </div>
    </div>
  );
}

function describeStatus(
  event: EventRow
): { Icon: typeof Flag; text: string; color: string } | null {
  if (event.is_practice) {
    return {
      Icon: Info,
      text: "Practice · Not scored",
      color: "var(--color-bt-text-dim)",
    };
  }
  if (event.agenda_item) {
    const name = event.agenda_item.course_name ?? event.agenda_item.title;
    const date = event.agenda_item.scheduled_date
      ? formatShortDate(event.agenda_item.scheduled_date)
      : null;
    return {
      Icon: MapPin,
      text: date ? `${name} · ${date}` : name,
      color: "var(--color-bt-text-dim)",
    };
  }
  if (event.type === "GOLF") {
    return {
      Icon: AlertTriangle,
      text: "Not connected to a golf course yet — scorecard entry unavailable",
      color: "var(--color-bt-warning)",
    };
  }
  return null;
}

function formatShortDate(iso: string): string {
  // schedule_items.scheduled_date is a DATE (YYYY-MM-DD). Parse as
  // local date so a Friday doesn't roll back to Thursday in negative tz.
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

// ── EventSheet ──────────────────────────────────────────────────────────────

export function EventSheet({
  tripId,
  competitionId,
  event,
  onClose,
}: {
  tripId: string;
  competitionId: string;
  event: EventRow | null;
  onClose: () => void;
}) {
  const isEdit = !!event;
  const utils = trpc.useUtils();

  const [type, setType] = useState<EventType>(event?.type ?? "GOLF");
  const [title, setTitle] = useState(event?.title ?? "");
  const [description, setDescription] = useState(event?.description ?? "");
  const [scoringFormat, setScoringFormat] = useState<ScoringFormat>(
    event?.scoring_format ?? "scramble"
  );
  const [isPractice, setIsPractice] = useState(event?.is_practice ?? false);
  // Positions are the source of truth — total = sum of place points.
  // Seed with 1st place when there's nothing to load so the user sees
  // an input immediately instead of an empty section.
  const [positions, setPositions] = useState<PointDistribution[]>(() => {
    const existing = event?.point_distributions ?? [];
    if (existing.length > 0) return existing;
    return [{ position: 1, label: "1st Place", points: 0 }];
  });
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const showPoints = !isPractice;

  const create = trpc.events.create.useMutation();
  const update = trpc.events.update.useMutation();
  const remove = trpc.events.delete.useMutation({
    onSettled: () => utils.events.list.invalidate({ tripId, competitionId }),
    onSuccess: () => {
      setConfirmingDelete(false);
      onClose();
    },
  });
  const setDistributions = trpc.events.setPointDistributions.useMutation();

  async function handleSave() {
    setError(null);
    if (!title.trim()) return setError("Title is required");

    // Total points are derived from the distribution — no separate input.
    const totalFromPositions = positions.reduce(
      (sum, p) => sum + (p.points || 0),
      0
    );
    const pointsValue = totalFromPositions > 0 ? totalFromPositions : null;

    try {
      let savedId: string;

      if (isEdit && event) {
        const updated = await update.mutateAsync({
          tripId,
          eventId: event.id,
          title: title.trim(),
          description: description.trim() || null,
          scoringFormat: type === "GOLF" ? scoringFormat : null,
          isPractice,
          pointsAvailable: showPoints ? pointsValue : null,
        });
        savedId = updated.id;
      } else {
        const created = await create.mutateAsync({
          tripId,
          competitionId,
          type,
          title: title.trim(),
          description: description.trim() || undefined,
          scoringFormat: type === "GOLF" ? scoringFormat : undefined,
          isPractice,
          pointsAvailable: showPoints && pointsValue !== null ? pointsValue : undefined,
        });
        savedId = created.id;
      }

      // Save distributions (or clear them for practice rounds)
      if (showPoints) {
        await setDistributions.mutateAsync({
          tripId,
          eventId: savedId,
          positions: positions.map((p, i) => ({
            position: i + 1,
            label: `${ordinalShort(i + 1)} Place`,
            points: p.points,
          })),
        });
      } else if (isEdit) {
        await setDistributions.mutateAsync({
          tripId,
          eventId: savedId,
          positions: [],
        });
      }

      utils.events.list.invalidate({ tripId, competitionId });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save event");
    }
  }

  const totalDistPoints = Math.round(
    positions.reduce((sum, p) => sum + (p.points || 0), 0) * 1e9
  ) / 1e9;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      style={{ background: "var(--color-bt-overlay)" }}
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-md flex-col rounded-t-2xl sm:rounded-2xl"
        style={{
          background: "var(--color-bt-card-float)",
          border: "1px solid var(--color-bt-border)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: "1px solid var(--color-bt-border)" }}
        >
          <h3 className="text-base font-bold" style={{ color: "var(--color-bt-text)" }}>
            {isEdit ? "Edit Event" : "Add Event"}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-lg"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {/* Type picker (create only — switching after creation is messy) */}
          {!isEdit && (
            <div className="grid grid-cols-2 gap-2">
              <TypeChip
                active={type === "GOLF"}
                onClick={() => setType("GOLF")}
                icon={<Flag size={18} />}
                label="Golf Event"
              />
              <TypeChip
                active={type === "GENERIC"}
                onClick={() => setType("GENERIC")}
                icon={<Star size={18} />}
                label="Other Event"
              />
            </div>
          )}

          <Field label="Title" required>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={
                type === "GOLF"
                  ? "e.g. Day 1 Scramble, Practice Round"
                  : "e.g. Poker Night, Closest to the Pin"
              }
              maxLength={200}
              className="w-full rounded-lg px-3 py-2 text-sm outline-none"
              style={{
                background: "var(--color-bt-card-raised)",
                color: "var(--color-bt-text)",
                border: "1px solid var(--color-bt-border)",
              }}
            />
          </Field>

          <Field label="Description" optional>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Rules, notes, or anything the group needs to know"
              maxLength={2000}
              rows={3}
              className="w-full rounded-lg px-3 py-2 text-sm outline-none"
              style={{
                background: "var(--color-bt-card-raised)",
                color: "var(--color-bt-text)",
                border: "1px solid var(--color-bt-border)",
              }}
            />
          </Field>

          {type === "GOLF" && (
            <>
              <Field label="Format" required>
                <div className="flex flex-wrap gap-1.5">
                  {(Object.keys(FORMAT_LABELS) as ScoringFormat[]).map((f) => (
                    <Chip
                      key={f}
                      active={scoringFormat === f}
                      onClick={() => setScoringFormat(f)}
                    >
                      {FORMAT_LABELS[f]}
                    </Chip>
                  ))}
                </div>
              </Field>

              <Toggle
                label="Practice Round"
                helper={isPractice ? "Excluded from tournament points" : undefined}
                value={isPractice}
                onChange={setIsPractice}
              />
            </>
          )}

          {showPoints && (
            <Field label="Points Distribution">
              <div className="space-y-2">
                {positions.map((p, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <span
                      className="w-16 flex-shrink-0 text-xs font-semibold"
                      style={{ color: "var(--color-bt-text)" }}
                    >
                      {ordinalShort(i + 1)} place
                    </span>
                    <input
                      type="number"
                      min={0}
                      value={p.points || ""}
                      onChange={(e) => {
                        const next = [...positions];
                        next[i] = {
                          ...next[i],
                          points: parseFloat(e.target.value) || 0,
                        };
                        setPositions(next);
                      }}
                      placeholder="0"
                      className="w-20 rounded-lg px-2 py-1.5 text-sm outline-none"
                      style={{
                        background: "var(--color-bt-card-raised)",
                        color: "var(--color-bt-text)",
                        border: "1px solid var(--color-bt-border)",
                      }}
                    />
                    <span
                      className="text-[11px]"
                      style={{ color: "var(--color-bt-text-dim)" }}
                    >
                      pts
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setPositions(positions.filter((_, j) => j !== i))
                      }
                      aria-label={`Remove ${ordinalShort(i + 1)} place`}
                      className="ml-auto flex h-6 w-6 items-center justify-center rounded-md"
                      style={{ color: "var(--color-bt-text-dim)" }}
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}

                {/* Add next place — only once the previous row has pts */}
                {(positions.length === 0 ||
                  (positions[positions.length - 1]?.points ?? 0) > 0) && (
                  <button
                    type="button"
                    onClick={() =>
                      setPositions([
                        ...positions,
                        {
                          position: positions.length + 1,
                          label: `${ordinalShort(positions.length + 1)} Place`,
                          points: 0,
                        },
                      ])
                    }
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium"
                    style={{
                      background: "var(--color-bt-card-raised)",
                      color: "var(--color-bt-text)",
                      border: "1px solid var(--color-bt-border)",
                    }}
                  >
                    <Plus size={12} style={{ color: "var(--color-bt-accent)" }} />
                    Add {ordinalShort(positions.length + 1)} place
                  </button>
                )}

                {/* Running total — derived from the distribution above */}
                {positions.length > 0 && (
                  <div
                    className="mt-1 flex items-center justify-between pt-2"
                    style={{ borderTop: "1px solid var(--color-bt-border)" }}
                  >
                    <span
                      className="text-[11px] font-semibold uppercase tracking-wider"
                      style={{ color: "var(--color-bt-text-dim)" }}
                    >
                      Total available
                    </span>
                    <span
                      className="text-sm font-bold tabular-nums"
                      style={{
                        color:
                          totalDistPoints > 0
                            ? "var(--color-bt-accent)"
                            : "var(--color-bt-text-dim)",
                      }}
                    >
                      {totalDistPoints} pt{totalDistPoints === 1 ? "" : "s"}
                    </span>
                  </div>
                )}
              </div>
            </Field>
          )}

          {error && (
            <p className="text-xs" style={{ color: "var(--color-bt-danger)" }}>
              {error}
            </p>
          )}
        </div>

        <div
          className="flex items-center gap-2 border-t p-4"
          style={{ borderColor: "var(--color-bt-border)" }}
        >
          {isEdit && event && (
            // Secondary destructive action — sits to the left of Save
            // so it's reachable but doesn't compete with the primary CTA.
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              aria-label={`Delete ${event.title}`}
              className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl"
              style={{
                background: "transparent",
                color: "var(--color-bt-danger)",
                border: "1px solid var(--color-bt-border)",
              }}
            >
              <Trash2 size={15} />
            </button>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={create.isPending || update.isPending}
            className="flex-1 rounded-xl py-3 text-sm font-semibold disabled:opacity-50"
            style={{
              background: "var(--color-bt-accent)",
              color: "var(--color-bt-base)",
            }}
          >
            Save Event
          </button>
        </div>

        {confirmingDelete && event && (
          <DeleteEventConfirmModal
            eventTitle={event.title}
            isPending={remove.isPending}
            onCancel={() => setConfirmingDelete(false)}
            onConfirm={() => remove.mutate({ tripId, eventId: event.id })}
          />
        )}
      </div>
    </div>
  );
}

// ── Subcomponents ───────────────────────────────────────────────────────────

function TypeChip({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center gap-1.5 rounded-xl py-3 text-xs font-semibold"
      style={
        active
          ? {
              background: "var(--color-bt-accent-faint)",
              color: "var(--color-bt-accent)",
              border: "1.5px solid var(--color-bt-accent-border)",
            }
          : {
              background: "var(--color-bt-card-raised)",
              color: "var(--color-bt-text-dim)",
              border: "1px solid var(--color-bt-border)",
            }
      }
    >
      {icon}
      {label}
    </button>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full px-3 py-1.5 text-xs font-semibold"
      style={
        active
          ? {
              background: "var(--color-bt-accent)",
              color: "var(--color-bt-base)",
            }
          : {
              background: "var(--color-bt-card-raised)",
              color: "var(--color-bt-text)",
              border: "1px solid var(--color-bt-border)",
            }
      }
    >
      {children}
    </button>
  );
}

function Toggle({
  label,
  helper,
  value,
  onChange,
}: {
  label: string;
  helper?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left"
      style={{
        background: "var(--color-bt-card-raised)",
        border: "1px solid var(--color-bt-border)",
      }}
    >
      <div
        className="flex h-5 w-9 items-center rounded-full p-0.5 transition-colors"
        style={{
          background: value ? "var(--color-bt-accent)" : "var(--color-bt-border)",
        }}
      >
        <span
          className="h-4 w-4 rounded-full transition-transform"
          style={{
            background: "var(--color-bt-base)",
            transform: value ? "translateX(16px)" : "translateX(0)",
          }}
        />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>
          {label}
        </p>
        {helper && (
          <p className="text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>
            {helper}
          </p>
        )}
      </div>
    </button>
  );
}

function Field({
  label,
  required,
  optional,
  helper,
  children,
}: {
  label: string;
  required?: boolean;
  optional?: boolean;
  helper?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline gap-1.5">
        <label
          className="text-xs font-semibold uppercase tracking-wider"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          {label}
        </label>
        {required && (
          <span className="text-[10px]" style={{ color: "var(--color-bt-text-dim)" }}>
            required
          </span>
        )}
        {optional && (
          <span className="text-[10px]" style={{ color: "var(--color-bt-text-dim)" }}>
            optional
          </span>
        )}
      </div>
      {children}
      {helper && (
        <p className="mt-1 text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>
          {helper}
        </p>
      )}
    </div>
  );
}

function ordinalShort(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
