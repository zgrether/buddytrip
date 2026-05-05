"use client";

import { useState } from "react";
import {
  Calendar,
  ChevronDown,
  CircleDot,
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

interface EventRow {
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

export function EventsPanel({ competitionId, tripId, canEdit }: Props) {
  const [open, setOpen] = useState(true);
  const [editing, setEditing] = useState<EventRow | null>(null);
  const [creating, setCreating] = useState(false);

  const { data: events = [] } = trpc.events.list.useQuery(
    { tripId, competitionId },
    { enabled: !!competitionId }
  );

  // Venue linkage drives the per-card status line. The venues router is
  // optional — if it isn't loaded yet (cold cache) we just render the
  // "not assigned" warning, which matches the actual not-yet-linked state.
  const { data: venues = [] } = trpc.venues.list.useQuery(
    { tripId, competitionId },
    { enabled: !!competitionId }
  );

  const eventsTyped = events as EventRow[];
  const venuesTyped = venues as VenueLink[];

  const totalEvents = eventsTyped.length;
  const practiceCount = eventsTyped.filter((e) => e.is_practice).length;

  const statusText = totalEvents === 0
    ? "Not set up"
    : `${totalEvents} event${totalEvents === 1 ? "" : "s"}${
        practiceCount > 0 ? ` · ${practiceCount} practice` : ""
      }`;
  const headerState = totalEvents === 0 ? "todo" : "inProgress";

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
      <div className="space-y-3">
        {totalEvents === 0 && (
          <EventsEmptyState canEdit={canEdit} onAdd={() => setCreating(true)} />
        )}

        {eventsTyped.map((event) => (
          <EventCard
            key={event.id}
            event={event}
            venue={venuesTyped.find((v) => v.event_id === event.id) ?? null}
            canEdit={canEdit}
            tripId={tripId}
            onEdit={() => setEditing(event)}
          />
        ))}

        {totalEvents > 0 && canEdit && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-medium"
            style={{
              background: "transparent",
              color: "var(--color-bt-accent)",
              border: "1.5px dashed var(--color-bt-accent)",
            }}
          >
            <Plus size={14} />
            Add Event
          </button>
        )}
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
  const labelColor =
    state === "todo" ? "var(--color-bt-text-dim)" : "var(--color-bt-accent)";
  const borderColor =
    state === "todo" ? "var(--color-bt-border)" : "var(--color-bt-accent-border)";
  const bg = state === "done" ? "var(--color-bt-accent-faint)" : "var(--color-bt-card)";

  return (
    <div
      className="overflow-hidden rounded-xl"
      style={{
        background: bg,
        border: `1px solid ${borderColor}`,
        boxShadow: "var(--shadow-raised)",
      }}
      data-testid={testId}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
      >
        <span style={{ color: labelColor }}>{icon}</span>
        <div className="min-w-0 flex-1">
          <p
            className="text-sm font-semibold leading-tight"
            style={{ color: labelColor }}
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
          style={{ borderTop: `1px solid ${borderColor}` }}
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
    <div
      className="rounded-xl px-4 py-6 text-center"
      style={{
        background: "var(--color-bt-card-raised)",
        border: "1px solid var(--color-bt-border)",
      }}
    >
      <div
        className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl"
        style={{
          background: "var(--color-bt-accent-faint)",
          color: "var(--color-bt-accent)",
        }}
      >
        <Calendar size={20} />
      </div>
      <p
        className="mt-3 text-sm font-semibold"
        style={{ color: "var(--color-bt-text)" }}
      >
        No events yet
      </p>
      <p className="mt-1 text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
        Add the rounds and activities you&rsquo;ll compete in.
      </p>
      {canEdit && (
        <button
          type="button"
          onClick={onAdd}
          className="mx-auto mt-4 inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold"
          style={{
            background: "var(--color-bt-accent)",
            color: "var(--color-bt-base)",
          }}
        >
          <Plus size={15} />
          Add Event
        </button>
      )}
    </div>
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
  const isGolf = event.type === "GOLF";

  // Practice events aren't scored, so they're not eligible for venue
  // assignment — only non-practice cards advertise the drag affordance.
  const draggable = canEdit && !event.is_practice;

  const remove = trpc.events.delete.useMutation({
    onSettled: () => utils.events.list.invalidate(),
  });

  function handleDelete() {
    if (!confirm(`Delete "${event.title}"?`)) return;
    remove.mutate({ tripId, eventId: event.id });
  }

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
      className="flex items-start gap-3 rounded-xl px-3 py-3"
      style={{
        background: "var(--color-bt-card-raised)",
        border: "1px solid var(--color-bt-border)",
        opacity: event.is_practice ? 0.85 : 1,
      }}
      data-testid={`event-card-${event.id}`}
    >
      {/* Dedicated drag handle. Putting draggable on a small grip lets the
          rest of the card stay interactive — clicking Edit / Delete now
          never accidentally starts a drag. */}
      {draggable ? (
        <div
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(DND_EVENT_KEY, event.id);
            e.dataTransfer.effectAllowed = "move";
          }}
          aria-label={`Drag ${event.title}`}
          title="Drag to assign to a venue"
          className="-ml-1 flex h-9 w-5 flex-shrink-0 cursor-grab items-center justify-center active:cursor-grabbing"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          <GripVertical size={14} />
        </div>
      ) : (
        <div className="-ml-1 w-5 flex-shrink-0" />
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

        {/* Status line — links the event to its venue (or warns if none). */}
        <div
          className="mt-0.5 flex items-center gap-1 text-[11px]"
          style={{ color: statusLine.color }}
        >
          <statusLine.Icon size={11} />
          <span>{statusLine.text}</span>
        </div>

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
            onClick={handleDelete}
            aria-label={`Delete ${event.title}`}
            className="flex h-7 w-7 items-center justify-center rounded-lg"
            style={{ color: "var(--color-bt-danger)" }}
          >
            <Trash2 size={13} />
          </button>
        </div>
      )}
    </div>
  );
}

function describeStatus(
  event: EventRow,
  venue: VenueLink | null
): { Icon: typeof Flag; text: string; color: string } {
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
  return {
    Icon: CircleDot,
    text: "Not assigned",
    color: "var(--color-bt-warning)",
  };
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

function EventSheet({
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
