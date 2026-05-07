"use client";

import { useState } from "react";
import {
  Calendar,
  ChevronDown,
  Cloud,
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
  /**
   * When true, render just the body (cards + add button + sheet) without
   * the collapsible chrome. MatchupPanel uses this so a single outer
   * collapsible owns the open/close state for both columns.
   */
  bare?: boolean;
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

export interface EventRow {
  id: string;
  competition_id: string;
  type: EventType;
  title: string;
  description: string | null;
  scoring_format: ScoringFormat | null;
  is_practice: boolean;
  points_available: number | null;
  status: "upcoming" | "active" | "completed";
  point_distributions?: PointDistribution[];
}

interface VenueLink {
  event_id: string | null;
  is_anytime: boolean;
  // Joined schedule_items (when venue is scheduled) — see VenuesPanel
  // for the full shape; we only need the display fields here.
  schedule_item?: {
    course_name?: string | null;
    scheduled_date?: string | null;
  } | null;
  name?: string | null;
}

// Shared dataTransfer key — VenuesPanel reads the same string when an
// event is dropped onto an unlinked venue row.
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

export function EventsPanel({ competitionId, tripId, canEdit, bare }: Props) {
  const [open, setOpen] = useState(true);
  const [editing, setEditing] = useState<EventRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const utils = trpc.useUtils();
  const { data: events = [] } = trpc.events.list.useQuery(
    { tripId, competitionId },
    { enabled: !!competitionId }
  );

  // Drop-to-unassign: a LinkedEventDetails chip dragged out of a venue
  // card lands here and we look up which venue currently holds it, then
  // call venues.unassignEvent. Mirrors the crew column's unassign drop.
  const unassign = trpc.venues.unassignEvent.useMutation({
    onMutate: async (vars) => {
      await utils.venues.list.cancel({ tripId, competitionId });
      const previous = utils.venues.list.getData({ tripId, competitionId });
      utils.venues.list.setData({ tripId, competitionId }, (old) => {
        const list = (old as Array<{ id: string; event_id: string | null; is_anytime: boolean }> | undefined) ?? [];
        return list.map((v) =>
          v.id === vars.venueId ? { ...v, event_id: null, is_anytime: false } : v
        ) as never;
      });
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) {
        utils.venues.list.setData({ tripId, competitionId }, ctx.previous);
      }
    },
    onSettled: () => utils.venues.list.invalidate({ tripId, competitionId }),
  });

  // Venue linkage drives the per-card status line. The venues router is
  // optional — if it isn't loaded yet (cold cache) we just render the
  // "not assigned" warning, which matches the actual not-yet-linked state.
  const { data: venues = [] } = trpc.venues.list.useQuery(
    { tripId, competitionId },
    { enabled: !!competitionId }
  );

  const eventsTyped = events as EventRow[];
  const venuesTyped = venues as VenueLink[];

  // When rendered inside MatchupPanel, this column shows ONLY events
  // that haven't been pinned to a venue yet — assigned events render
  // inside their venue card on the right column. Standalone (non-bare)
  // mode still shows everything for discoverability.
  const visibleEvents = bare
    ? eventsTyped.filter(
        (e) => !venuesTyped.some((v) => v.event_id === e.id)
      )
    : eventsTyped;

  const totalEvents = eventsTyped.length;
  const practiceCount = eventsTyped.filter((e) => e.is_practice).length;

  const statusText = totalEvents === 0
    ? "Not set up"
    : `${totalEvents} event${totalEvents === 1 ? "" : "s"}${
        practiceCount > 0 ? ` · ${practiceCount} practice` : ""
      }`;
  const headerState = totalEvents === 0 ? "todo" : "inProgress";

  // The bare-mode column itself acts as a drop target so an event chip
  // dragged off a venue card can be returned to the unassigned pool.
  const handleUnassignDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const eventId = e.dataTransfer.getData(DND_EVENT_KEY);
    if (!eventId) return;
    const venue = venuesTyped.find((v) => v.event_id === eventId) as
      | { id?: string }
      | undefined;
    if (!venue?.id) return;
    unassign.mutate({ tripId, venueId: venue.id });
  };

  const allAssigned =
    bare && eventsTyped.length > 0 && visibleEvents.length === 0;

  // In bare mode the events column is always a card-shaped drop target —
  // mirrors the crew column treatment so the "drop here to unassign"
  // affordance is visually consistent across the comp tab.
  const bareDropStyle: React.CSSProperties | undefined = bare
    ? {
        background: "transparent",
        border: `${dragOver ? "1.5px" : "1px"} dashed ${
          dragOver ? "var(--color-bt-accent)" : "var(--color-bt-border)"
        }`,
      }
    : undefined;

  const inner = (
    <>
      {visibleEvents.length === 0 && !allAssigned && !bare && (
        <EventsEmptyState
          canEdit={canEdit && !bare}
          onAdd={() => setCreating(true)}
        />
      )}

      {bare && visibleEvents.length === 0 && (
        <p
          className="text-[11px]"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          {allAssigned
            ? canEdit
              ? "All events assigned to venues. Drop here to unassign."
              : "All events assigned to venues."
            : canEdit
              ? "No unassigned events. Drop here to unassign."
              : "No unassigned events."}
        </p>
      )}

      {visibleEvents.map((event) => (
        <EventCard
          key={event.id}
          event={event}
          venue={venuesTyped.find((v) => v.event_id === event.id) ?? null}
          canEdit={canEdit}
          tripId={tripId}
          onEdit={() => setEditing(event)}
        />
      ))}

      {/* Bottom Add Event button is hidden in bare mode — the +Event
          affordance lives in CompetitionHeader's action bar now. */}
      {!bare && visibleEvents.length > 0 && canEdit && (
        <AddEventButton onClick={() => setCreating(true)} />
      )}
    </>
  );

  const body = (
    <>
      <div
        className={`${bare ? "rounded-xl p-3" : ""} space-y-2 transition-colors`}
        style={bareDropStyle}
        onDragOver={
          bare && canEdit
            ? (e) => {
                if (!e.dataTransfer.types.includes(DND_EVENT_KEY)) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setDragOver(true);
              }
            : undefined
        }
        onDragLeave={bare && canEdit ? () => setDragOver(false) : undefined}
        onDrop={bare && canEdit ? handleUnassignDrop : undefined}
      >
        {inner}
      </div>

      {(creating || editing) && (
        <EventSheet
          tripId={tripId}
          competitionId={competitionId}
          event={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </>
  );

  if (bare) return body;

  return (
    <CollapsiblePanel
      icon={<Calendar size={16} />}
      label="Events"
      note={statusText}
      state={headerState}
      open={open}
      onToggle={() => setOpen((v) => !v)}
      testId="events-panel"
    >
      {body}
    </CollapsiblePanel>
  );
}

// ── CollapsiblePanel ────────────────────────────────────────────────────────

function CollapsiblePanel({
  icon,
  label,
  note,
  state,
  open,
  onToggle,
  testId,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  note: string;
  state: "done" | "inProgress" | "todo";
  open: boolean;
  onToggle: () => void;
  testId?: string;
  children: React.ReactNode;
}) {
  // Neutral panel chrome — icon picks up accent color once progress is made.
  const iconColor =
    state !== "todo" ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)";

  return (
    <div
      className="overflow-hidden rounded-xl"
      style={{
        background: "var(--color-bt-card)",
        border: "1px solid var(--color-bt-border)",
        boxShadow: "var(--shadow-raised)",
      }}
      data-testid={testId}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
      >
        <span style={{ color: iconColor }}>{icon}</span>
        <div className="min-w-0 flex-1">
          <p
            className="text-sm font-semibold leading-tight"
            style={{ color: "var(--color-bt-text)" }}
          >
            {label}
          </p>
          <p className="mt-0.5 text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
            {note}
          </p>
        </div>
        <ChevronDown
          size={15}
          style={{
            color: "var(--color-bt-text-dim)",
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 200ms",
          }}
        />
      </button>
      {open && (
        <div
          className="px-4 pb-4 pt-3"
          style={{ borderTop: "1px solid var(--color-bt-border)" }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

// ── EventsEmptyState ────────────────────────────────────────────────────────

function EventsEmptyState({
  canEdit,
  onAdd,
}: {
  canEdit: boolean;
  onAdd: () => void;
}) {
  return (
    <div className="py-2 text-center">
      <p className="text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
        No events yet. Add the rounds and activities you&rsquo;ll compete in.
      </p>
      {canEdit && <AddEventButton onClick={onAdd} className="mx-auto mt-3" />}
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
  venue,
  canEdit,
  tripId,
  onEdit,
}: {
  event: EventRow;
  venue: VenueLink | null;
  canEdit: boolean;
  tripId: string;
  onEdit: () => void;
}) {
  const utils = trpc.useUtils();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const isGolf = event.type === "GOLF";

  // Practice rounds still happen at real venues (a tee time at a
  // course) — they just don't count toward points. Both practice and
  // scored events advertise the drag affordance so every card has a
  // grip when canEdit.
  const draggable = canEdit;

  const remove = trpc.events.delete.useMutation({
    onSettled: () => utils.events.list.invalidate(),
    onSuccess: () => setConfirmingDelete(false),
  });

  const distributions = event.point_distributions ?? [];
  const distSummary = distributions.length > 0
    ? distributions
        .slice(0, 3)
        .map((d) => `${ordinalShort(d.position)}: ${d.points}pt${d.points === 1 ? "" : "s"}`)
        .join(" · ")
    : null;

  const statusLine = describeStatus(event, venue);

  return (
    <div
      // Whole-card drag, matching the Schedule tab pattern. The
      // GripVertical inside is just a visual indicator. Buttons inside
      // (Edit / Delete) still receive clicks because the browser only
      // initiates a drag on actual mouse movement.
      draggable={draggable}
      onDragStart={
        draggable
          ? (e) => {
              e.dataTransfer.setData(DND_EVENT_KEY, event.id);
              e.dataTransfer.effectAllowed = "move";
            }
          : undefined
      }
      className={`flex items-start gap-3 rounded-xl px-3 py-3 ${
        draggable ? "cursor-grab active:cursor-grabbing" : ""
      }`}
      style={{
        background: "var(--color-bt-card-raised)",
        border: "1px solid var(--color-bt-border)",
        opacity: event.is_practice ? 0.85 : 1,
      }}
      data-testid={`event-card-${event.id}`}
    >
      {draggable && (
        <GripVertical
          size={16}
          className="mt-0.5 hidden flex-shrink-0 lg:block"
          strokeWidth={2}
          style={{ color: "var(--color-bt-text-dim)" }}
        />
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

        {/* Status line — only shown when there's something useful to say
            (linked venue, anytime, or "Practice · Not scored"). An
            unassigned non-practice event renders no status line. */}
        {statusLine && (
          <div
            className="mt-0.5 flex items-center gap-1 text-[11px]"
            style={{ color: statusLine.color }}
          >
            <statusLine.Icon size={11} />
            <span>{statusLine.text}</span>
          </div>
        )}

        {!event.is_practice && distSummary && (
          <p className="mt-1 text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>
            {distSummary}
            {event.points_available !== null && ` · ${event.points_available}pt total`}
          </p>
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
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            aria-label={`Delete ${event.title}`}
            className="flex h-7 w-7 items-center justify-center rounded-lg"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            <Trash2 size={13} />
          </button>
        </div>
      )}

      {confirmingDelete && (
        <DeleteEventConfirmModal
          eventTitle={event.title}
          isPending={remove.isPending}
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={() => remove.mutate({ tripId, eventId: event.id })}
        />
      )}
    </div>
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
            Removes the event and its point distribution. Any venue it was
            assigned to becomes unlinked.
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
  event: EventRow,
  venue: VenueLink | null
): { Icon: typeof Flag; text: string; color: string } | null {
  if (event.is_practice) {
    return {
      Icon: Info,
      text: "Practice · Not scored",
      color: "var(--color-bt-text-dim)",
    };
  }
  if (venue?.is_anytime) {
    return {
      Icon: Cloud,
      text: "Anytime",
      color: "var(--color-bt-text-dim)",
    };
  }
  if (venue?.schedule_item) {
    const courseName = venue.schedule_item.course_name ?? venue.name ?? "Scheduled";
    const date = venue.schedule_item.scheduled_date
      ? formatShortDate(venue.schedule_item.scheduled_date)
      : null;
    return {
      Icon: MapPin,
      text: date ? `${courseName} · ${date}` : courseName,
      color: "var(--color-bt-text-dim)",
    };
  }
  if (venue?.name) {
    return {
      Icon: MapPin,
      text: venue.name,
      color: "var(--color-bt-text-dim)",
    };
  }
  // Unassigned non-practice event — that's an OK resting state (the user
  // might keep extra events around in case something gets cut from the
  // schedule). Don't render the status line at all rather than nag with
  // a warning.
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
  const [pointsAvailable, setPointsAvailable] = useState<string>(
    event?.points_available?.toString() ?? ""
  );
  const [positions, setPositions] = useState<PointDistribution[]>(
    event?.point_distributions ?? []
  );
  const [error, setError] = useState<string | null>(null);

  const create = trpc.events.create.useMutation();
  const update = trpc.events.update.useMutation();
  const setDistributions = trpc.events.setPointDistributions.useMutation();

  const showPoints = !isPractice;

  async function handleSave() {
    setError(null);
    if (!title.trim()) return setError("Title is required");

    const pointsValue = pointsAvailable.trim()
      ? parseFloat(pointsAvailable)
      : null;

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
            position: p.position || i + 1,
            label: p.label,
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

  const totalDistPoints = positions.reduce((sum, p) => sum + (p.points || 0), 0);
  const remainingPoints = (parseFloat(pointsAvailable) || 0) - totalDistPoints;

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
            <>
              <Field label="Total Points" required>
                <input
                  type="number"
                  min={0}
                  value={pointsAvailable}
                  onChange={(e) => setPointsAvailable(e.target.value)}
                  className="w-32 rounded-lg px-3 py-2 text-sm outline-none"
                  style={{
                    background: "var(--color-bt-card-raised)",
                    color: "var(--color-bt-text)",
                    border: "1px solid var(--color-bt-border)",
                  }}
                />
              </Field>

              <Field
                label="Points Distribution"
                helper="Add finishing positions and assign points to each."
              >
                <div className="space-y-1.5">
                  {positions.map((p, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input
                        value={p.label}
                        onChange={(e) => {
                          const next = [...positions];
                          next[i] = { ...next[i], label: e.target.value };
                          setPositions(next);
                        }}
                        placeholder={`${ordinalShort(i + 1)} place`}
                        className="flex-1 rounded-lg px-2 py-1.5 text-sm outline-none"
                        style={{
                          background: "var(--color-bt-card-raised)",
                          color: "var(--color-bt-text)",
                          border: "1px solid var(--color-bt-border)",
                        }}
                      />
                      <input
                        type="number"
                        min={0}
                        max={99}
                        value={p.points}
                        onChange={(e) => {
                          const next = [...positions];
                          next[i] = {
                            ...next[i],
                            points: parseFloat(e.target.value) || 0,
                          };
                          setPositions(next);
                        }}
                        className="w-16 rounded-lg px-2 py-1.5 text-sm outline-none"
                        style={{
                          background: "var(--color-bt-card-raised)",
                          color: "var(--color-bt-text)",
                          border: "1px solid var(--color-bt-border)",
                        }}
                      />
                      <span
                        className="text-[10px]"
                        style={{ color: "var(--color-bt-text-dim)" }}
                      >
                        pts
                      </span>
                      <button
                        type="button"
                        onClick={() => setPositions(positions.filter((_, j) => j !== i))}
                        aria-label={`Remove position ${i + 1}`}
                        className="flex h-7 w-7 items-center justify-center rounded-lg"
                        style={{ color: "var(--color-bt-text-dim)" }}
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ))}
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
                    className="flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-medium"
                    style={{
                      background: "transparent",
                      color: "var(--color-bt-accent)",
                      border: "1.5px dashed var(--color-bt-accent)",
                    }}
                  >
                    <Plus size={12} />
                    Add Position
                  </button>
                </div>
                {pointsAvailable && (
                  <p
                    className="mt-2 text-[11px]"
                    style={{
                      color:
                        remainingPoints < 0
                          ? "var(--color-bt-danger)"
                          : "var(--color-bt-text-dim)",
                    }}
                  >
                    Points remaining: {remainingPoints}
                  </p>
                )}
              </Field>
            </>
          )}

          {error && (
            <p className="text-xs" style={{ color: "var(--color-bt-danger)" }}>
              {error}
            </p>
          )}
        </div>

        <div className="border-t p-4" style={{ borderColor: "var(--color-bt-border)" }}>
          <button
            type="button"
            onClick={handleSave}
            disabled={create.isPending || update.isPending}
            className="w-full rounded-xl py-3 text-sm font-semibold disabled:opacity-50"
            style={{
              background: "var(--color-bt-accent)",
              color: "var(--color-bt-base)",
            }}
          >
            Save Event
          </button>
        </div>
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
