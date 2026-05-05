"use client";

import { useState, useMemo } from "react";
import {
  ChevronDown,
  Cloud,
  Flag,
  MapPin,
  Plus,
  X,
} from "lucide-react";
import { trpc } from "@/lib/trpc-client";

interface Props {
  competitionId: string;
  tripId: string;
  canEdit: boolean;
}

interface ArenaRow {
  id: string;
  competition_id: string;
  schedule_item_id: string | null;
  event_id: string | null;
  name: string | null;
  location: string | null;
  arena_date: string | null;
  arena_time: string | null;
  is_anytime: boolean;
  schedule_item?: ScheduleItemRow | null;
}

interface ScheduleItemRow {
  id: string;
  trip_id: string;
  title: string;
  course_name: string | null;
  course_location: string | null;
  scheduled_date: string | null;
  scheduled_time: string | null;
}

interface EventRow {
  id: string;
  type: "GOLF" | "GENERIC";
  title: string;
  is_practice: boolean;
  points_available: number | null;
}

// ── ArenasPanel ─────────────────────────────────────────────────────────────

export function ArenasPanel({ competitionId, tripId, canEdit }: Props) {
  const [open, setOpen] = useState(true);
  const [creatingManual, setCreatingManual] = useState(false);

  const { data: arenas = [] } = trpc.arenas.list.useQuery(
    { tripId, competitionId },
    { enabled: !!competitionId }
  );
  const { data: golfItems = [] } = trpc.schedule.listGolf.useQuery(
    { tripId },
    { enabled: !!competitionId }
  );
  const { data: events = [] } = trpc.events.list.useQuery(
    { tripId, competitionId },
    { enabled: !!competitionId }
  );

  const arenasTyped = arenas as ArenaRow[];
  const golfTyped = golfItems as ScheduleItemRow[];
  const eventsTyped = events as EventRow[];

  const scheduledArenas = arenasTyped.filter((a) => !a.is_anytime);
  const anytimeArenas = arenasTyped.filter((a) => a.is_anytime);

  // For each golf schedule item, find the arena (if any) that links to it.
  const arenaByScheduleItem = useMemo(() => {
    const map = new Map<string, ArenaRow>();
    for (const a of scheduledArenas) {
      if (a.schedule_item_id) map.set(a.schedule_item_id, a);
    }
    return map;
  }, [scheduledArenas]);

  // Manual scheduled arenas (no schedule_item_id but not anytime).
  const manualScheduledArenas = scheduledArenas.filter(
    (a) => !a.schedule_item_id
  );

  // Non-practice events that aren't pinned to any arena yet.
  const unassignedEvents = eventsTyped.filter(
    (e) => !e.is_practice && !arenasTyped.some((a) => a.event_id === e.id)
  );

  const totalScheduledItems = golfTyped.length + manualScheduledArenas.length;
  const linkedCount = arenasTyped.filter((a) => a.event_id).length;
  const allLinked =
    totalScheduledItems > 0 &&
    linkedCount === totalScheduledItems &&
    unassignedEvents.length === 0;

  const totalPanels = arenasTyped.length + golfTyped.length;
  const headerState =
    totalPanels === 0 ? "todo" : allLinked ? "done" : "inProgress";
  const statusText =
    totalPanels === 0
      ? "Not set up"
      : `${linkedCount} of ${arenasTyped.length} arena${arenasTyped.length === 1 ? "" : "s"} linked`;

  return (
    <CollapsiblePanel
      icon={<MapPin size={16} />}
      label="Arenas"
      note={statusText}
      state={headerState}
      open={open}
      onToggle={() => setOpen((v) => !v)}
      testId="arenas-panel"
    >
      <div className="space-y-5">
        {totalPanels === 0 && (
          <ArenasEmptyState
            canEdit={canEdit}
            onAddManual={() => setCreatingManual(true)}
          />
        )}

        {totalPanels > 0 && (
          <ScheduledSection
            tripId={tripId}
            competitionId={competitionId}
            golfItems={golfTyped}
            arenaByScheduleItem={arenaByScheduleItem}
            manualScheduledArenas={manualScheduledArenas}
            events={eventsTyped}
            arenasTyped={arenasTyped}
            canEdit={canEdit}
          />
        )}

        {totalPanels > 0 && (
          <AnytimeSection
            tripId={tripId}
            competitionId={competitionId}
            anytimeArenas={anytimeArenas}
            events={eventsTyped}
            unassignedEvents={unassignedEvents}
            canEdit={canEdit}
          />
        )}

        {totalPanels > 0 && canEdit && (
          <button
            type="button"
            onClick={() => setCreatingManual(true)}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-medium"
            style={{
              background: "transparent",
              color: "var(--color-bt-accent)",
              border: "1.5px dashed var(--color-bt-accent)",
            }}
          >
            <Plus size={14} />
            Add Arena Manually
          </button>
        )}
      </div>

      {creatingManual && (
        <ManualArenaSheet
          tripId={tripId}
          competitionId={competitionId}
          onClose={() => setCreatingManual(false)}
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

// ── ArenasEmptyState ────────────────────────────────────────────────────────

function ArenasEmptyState({
  canEdit,
  onAddManual,
}: {
  canEdit: boolean;
  onAddManual: () => void;
}) {
  return (
    <div
      className="rounded-xl px-4 py-6 text-center"
      style={{
        background: "var(--color-bt-surface-invitation)",
        border: "1.5px dashed var(--color-bt-border)",
      }}
    >
      <div
        className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl"
        style={{
          background: "var(--color-bt-accent-faint)",
          color: "var(--color-bt-accent)",
        }}
      >
        <MapPin size={20} />
      </div>
      <p
        className="mt-3 text-sm font-semibold"
        style={{ color: "var(--color-bt-text)" }}
      >
        No arenas yet
      </p>
      <p className="mt-1 text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
        Add tee times in the Schedule tab, or add a venue manually.
      </p>
      {canEdit && (
        <button
          type="button"
          onClick={onAddManual}
          className="mx-auto mt-4 inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-medium"
          style={{
            background: "transparent",
            color: "var(--color-bt-accent)",
            border: "1.5px dashed var(--color-bt-accent)",
          }}
        >
          <Plus size={14} />
          Add Arena
        </button>
      )}
    </div>
  );
}

// ── ScheduledSection ────────────────────────────────────────────────────────

function ScheduledSection({
  tripId,
  competitionId,
  golfItems,
  arenaByScheduleItem,
  manualScheduledArenas,
  events,
  arenasTyped,
  canEdit,
}: {
  tripId: string;
  competitionId: string;
  golfItems: ScheduleItemRow[];
  arenaByScheduleItem: Map<string, ArenaRow>;
  manualScheduledArenas: ArenaRow[];
  events: EventRow[];
  arenasTyped: ArenaRow[];
  canEdit: boolean;
}) {
  return (
    <section>
      <SectionLabel>Scheduled</SectionLabel>

      {golfItems.length === 0 && manualScheduledArenas.length === 0 && (
        <p
          className="mt-2 text-[11px]"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          No golf tee times in Schedule yet. Add them in the Schedule tab first.
        </p>
      )}

      <div className="mt-2 space-y-2">
        {golfItems.map((item) => {
          const arena = arenaByScheduleItem.get(item.id);
          if (arena) {
            return (
              <ArenaRowView
                key={`item-${item.id}`}
                arena={arena}
                events={events}
                arenasTyped={arenasTyped}
                tripId={tripId}
                competitionId={competitionId}
                canEdit={canEdit}
              />
            );
          }
          return (
            <UnlinkedScheduleRow
              key={`item-${item.id}`}
              item={item}
              tripId={tripId}
              competitionId={competitionId}
              canEdit={canEdit}
            />
          );
        })}

        {manualScheduledArenas.map((arena) => (
          <ArenaRowView
            key={`arena-${arena.id}`}
            arena={arena}
            events={events}
            arenasTyped={arenasTyped}
            tripId={tripId}
            competitionId={competitionId}
            canEdit={canEdit}
          />
        ))}
      </div>
    </section>
  );
}

function UnlinkedScheduleRow({
  item,
  tripId,
  competitionId,
  canEdit,
}: {
  item: ScheduleItemRow;
  tripId: string;
  competitionId: string;
  canEdit: boolean;
}) {
  const utils = trpc.useUtils();
  const create = trpc.arenas.create.useMutation({
    onSettled: () => utils.arenas.list.invalidate({ tripId, competitionId }),
  });

  return (
    <div
      className="flex items-center gap-3 rounded-xl px-3 py-2.5"
      style={{
        background: "var(--color-bt-card-raised)",
        border: "1px dashed var(--color-bt-border)",
        opacity: 0.85,
      }}
      data-testid={`unlinked-schedule-${item.id}`}
    >
      <Flag size={14} style={{ color: "var(--color-bt-text-dim)" }} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>
          {item.course_name ?? item.title}
        </p>
        <p className="text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>
          {formatDateTime(item.scheduled_date, item.scheduled_time)}
        </p>
      </div>
      {canEdit && (
        <button
          type="button"
          onClick={() =>
            create.mutate({
              tripId,
              competitionId,
              scheduleItemId: item.id,
            })
          }
          disabled={create.isPending}
          className="rounded-lg px-2.5 py-1 text-[11px] font-semibold disabled:opacity-50"
          style={{
            background: "transparent",
            color: "var(--color-bt-accent)",
            border: "1px dashed var(--color-bt-accent)",
          }}
        >
          + Add to Competition
        </button>
      )}
    </div>
  );
}

// ── ArenaRowView (linked arena, optionally with an event) ───────────────────

function ArenaRowView({
  arena,
  events,
  arenasTyped,
  tripId,
  competitionId,
  canEdit,
}: {
  arena: ArenaRow;
  events: EventRow[];
  arenasTyped: ArenaRow[];
  tripId: string;
  competitionId: string;
  canEdit: boolean;
}) {
  const linkedEvent = events.find((e) => e.id === arena.event_id) ?? null;
  const titleSource =
    arena.schedule_item?.course_name ??
    arena.schedule_item?.title ??
    arena.name ??
    "Arena";
  const dateTime = arena.schedule_item
    ? formatDateTime(
        arena.schedule_item.scheduled_date,
        arena.schedule_item.scheduled_time
      )
    : formatDateTime(arena.arena_date, arena.arena_time);

  return (
    <div
      className="rounded-xl px-3 py-2.5"
      style={{
        background: "var(--color-bt-card-raised)",
        border: "1px solid var(--color-bt-border)",
      }}
      data-testid={`arena-${arena.id}`}
    >
      <div className="flex items-center gap-3">
        <Flag size={14} style={{ color: "var(--color-bt-accent)" }} />
        <div className="min-w-0 flex-1">
          <p
            className="truncate text-sm font-medium"
            style={{ color: "var(--color-bt-text)" }}
          >
            {titleSource}
          </p>
          {dateTime && (
            <p className="text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>
              {dateTime}
            </p>
          )}
        </div>
        {!linkedEvent && canEdit && (
          <AssignEventControl
            arenaId={arena.id}
            tripId={tripId}
            competitionId={competitionId}
            events={events}
            arenasTyped={arenasTyped}
          />
        )}
      </div>

      {linkedEvent && (
        <div
          className="mt-2 flex items-center gap-2 rounded-lg px-2 py-1.5"
          style={{
            background: "var(--color-bt-accent-faint)",
            border: "1px solid var(--color-bt-accent-border)",
          }}
        >
          <span
            className="text-xs font-semibold"
            style={{ color: "var(--color-bt-accent)" }}
          >
            {linkedEvent.title}
          </span>
          {linkedEvent.points_available !== null && (
            <span
              className="text-[11px]"
              style={{ color: "var(--color-bt-accent)" }}
            >
              · {linkedEvent.points_available} pts
            </span>
          )}
          {canEdit && (
            <UnassignButton
              arenaId={arena.id}
              tripId={tripId}
              competitionId={competitionId}
            />
          )}
        </div>
      )}

      {!linkedEvent && (
        <p
          className="mt-1 text-[11px]"
          style={{ color: "var(--color-bt-warning)" }}
        >
          No event assigned
        </p>
      )}
    </div>
  );
}

function AssignEventControl({
  arenaId,
  tripId,
  competitionId,
  events,
  arenasTyped,
}: {
  arenaId: string;
  tripId: string;
  competitionId: string;
  events: EventRow[];
  arenasTyped: ArenaRow[];
}) {
  const utils = trpc.useUtils();
  const assign = trpc.arenas.assignEvent.useMutation({
    onSettled: () => utils.arenas.list.invalidate({ tripId, competitionId }),
  });

  const assignableEvents = events.filter(
    (e) => !e.is_practice && !arenasTyped.some((a) => a.event_id === e.id)
  );

  if (assignableEvents.length === 0) {
    return (
      <span
        className="text-[11px]"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        No events available
      </span>
    );
  }

  return (
    <select
      value=""
      disabled={assign.isPending}
      onChange={(e) => {
        if (!e.target.value) return;
        assign.mutate({ tripId, arenaId, eventId: e.target.value });
      }}
      className="rounded-md px-2 py-1 text-xs"
      style={{
        background: "var(--color-bt-card)",
        color: "var(--color-bt-accent)",
        border: "1px solid var(--color-bt-accent-border)",
      }}
      aria-label="Assign event"
    >
      <option value="">Assign event…</option>
      {assignableEvents.map((e) => (
        <option key={e.id} value={e.id}>
          {e.title}
        </option>
      ))}
    </select>
  );
}

function UnassignButton({
  arenaId,
  tripId,
  competitionId,
}: {
  arenaId: string;
  tripId: string;
  competitionId: string;
}) {
  const utils = trpc.useUtils();
  const unassign = trpc.arenas.unassignEvent.useMutation({
    onSettled: () => utils.arenas.list.invalidate({ tripId, competitionId }),
  });
  return (
    <button
      type="button"
      onClick={() => unassign.mutate({ tripId, arenaId })}
      disabled={unassign.isPending}
      aria-label="Unassign event"
      className="ml-auto flex h-5 w-5 items-center justify-center rounded-full"
      style={{ color: "var(--color-bt-accent)" }}
    >
      <X size={10} />
    </button>
  );
}

// ── AnytimeSection ──────────────────────────────────────────────────────────

function AnytimeSection({
  tripId,
  competitionId,
  anytimeArenas,
  events,
  unassignedEvents,
  canEdit,
}: {
  tripId: string;
  competitionId: string;
  anytimeArenas: ArenaRow[];
  events: EventRow[];
  unassignedEvents: EventRow[];
  canEdit: boolean;
}) {
  const utils = trpc.useUtils();
  const remove = trpc.arenas.delete.useMutation({
    onSettled: () => utils.arenas.list.invalidate({ tripId, competitionId }),
  });

  // "Anytime" suggestion only shows non-practice events that have no
  // arena at all — once an event is in an Anytime arena we don't repeat
  // the suggestion below.
  const suggestable = unassignedEvents;

  if (anytimeArenas.length === 0 && suggestable.length === 0) return null;

  return (
    <section>
      <SectionLabel>Anytime</SectionLabel>
      <p
        className="mt-1 text-[11px] italic"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        These happen during the trip without a fixed time or place.
      </p>

      <div className="mt-2 space-y-2">
        {anytimeArenas.map((arena) => {
          const linkedEvent = events.find((e) => e.id === arena.event_id);
          const label =
            linkedEvent?.title ?? arena.name ?? "Anytime";
          const pts = linkedEvent?.points_available;
          return (
            <div
              key={arena.id}
              className="flex items-center gap-3 rounded-xl px-3 py-2.5"
              style={{
                background: "var(--color-bt-card-raised)",
                border: "1px solid var(--color-bt-border)",
              }}
            >
              <Cloud size={14} style={{ color: "var(--color-bt-text-dim)" }} />
              <span
                className="flex-1 text-sm font-medium"
                style={{ color: "var(--color-bt-text)" }}
              >
                {label}
                {pts !== undefined && pts !== null && (
                  <span
                    className="ml-2 text-[11px]"
                    style={{ color: "var(--color-bt-text-dim)" }}
                  >
                    · {pts} pts
                  </span>
                )}
              </span>
              {canEdit && (
                <button
                  type="button"
                  onClick={() =>
                    remove.mutate({ tripId, arenaId: arena.id })
                  }
                  aria-label="Remove arena"
                  className="flex h-6 w-6 items-center justify-center rounded-md"
                  style={{ color: "var(--color-bt-text-dim)" }}
                >
                  <X size={13} />
                </button>
              )}
            </div>
          );
        })}

        {suggestable.length > 0 && canEdit && (
          <div
            className="rounded-xl px-3 py-2.5"
            style={{
              background: "var(--color-bt-card)",
              border: "1px dashed var(--color-bt-border)",
            }}
          >
            {suggestable.map((event) => (
              <UnassignedEventPrompt
                key={event.id}
                event={event}
                tripId={tripId}
                competitionId={competitionId}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function UnassignedEventPrompt({
  event,
  tripId,
  competitionId,
}: {
  event: EventRow;
  tripId: string;
  competitionId: string;
}) {
  const utils = trpc.useUtils();
  const create = trpc.arenas.create.useMutation();
  const assign = trpc.arenas.assignEvent.useMutation({
    onSettled: () => utils.arenas.list.invalidate({ tripId, competitionId }),
  });

  async function markAnytime() {
    const arena = await create.mutateAsync({
      tripId,
      competitionId,
      name: event.title,
      isAnytime: true,
    });
    await assign.mutateAsync({
      tripId,
      arenaId: arena.id,
      eventId: event.id,
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 py-1">
      <span className="text-xs" style={{ color: "var(--color-bt-text)" }}>
        &ldquo;{event.title}&rdquo; isn&rsquo;t assigned yet.
      </span>
      <button
        type="button"
        onClick={markAnytime}
        disabled={create.isPending || assign.isPending}
        className="rounded-md px-2 py-0.5 text-[11px] font-semibold disabled:opacity-50"
        style={{
          background: "transparent",
          color: "var(--color-bt-accent)",
          border: "1px dashed var(--color-bt-accent)",
        }}
      >
        Mark as Anytime
      </button>
    </div>
  );
}

// ── ManualArenaSheet ────────────────────────────────────────────────────────

function ManualArenaSheet({
  tripId,
  competitionId,
  onClose,
}: {
  tripId: string;
  competitionId: string;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [error, setError] = useState<string | null>(null);

  const create = trpc.arenas.create.useMutation({
    onSettled: () => utils.arenas.list.invalidate({ tripId, competitionId }),
  });

  async function handleSave() {
    setError(null);
    if (!name.trim()) return setError("Name is required");
    try {
      await create.mutateAsync({
        tripId,
        competitionId,
        name: name.trim(),
        location: location.trim() || undefined,
        arenaDate: date || undefined,
        arenaTime: time.trim() || undefined,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add arena");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      style={{ background: "var(--color-bt-overlay)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-t-2xl sm:rounded-2xl"
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
            Add Arena
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

        <div className="space-y-4 p-4">
          <Field label="Name" required>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Poker at the house, Putting green"
              maxLength={200}
              className="w-full rounded-lg px-3 py-2 text-sm outline-none"
              style={{
                background: "var(--color-bt-card-raised)",
                color: "var(--color-bt-text)",
                border: "1px solid var(--color-bt-border)",
              }}
            />
          </Field>

          <Field label="Location" optional>
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Optional"
              maxLength={500}
              className="w-full rounded-lg px-3 py-2 text-sm outline-none"
              style={{
                background: "var(--color-bt-card-raised)",
                color: "var(--color-bt-text)",
                border: "1px solid var(--color-bt-border)",
              }}
            />
          </Field>

          <div className="flex gap-3">
            <Field label="Date" optional>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="rounded-lg px-3 py-2 text-sm outline-none"
                style={{
                  background: "var(--color-bt-card-raised)",
                  color: "var(--color-bt-text)",
                  border: "1px solid var(--color-bt-border)",
                }}
              />
            </Field>
            <Field label="Time" optional>
              <input
                value={time}
                onChange={(e) => setTime(e.target.value)}
                placeholder="7:00 PM"
                maxLength={40}
                className="w-32 rounded-lg px-3 py-2 text-sm outline-none"
                style={{
                  background: "var(--color-bt-card-raised)",
                  color: "var(--color-bt-text)",
                  border: "1px solid var(--color-bt-border)",
                }}
              />
            </Field>
          </div>

          {error && (
            <p className="text-xs" style={{ color: "var(--color-bt-danger)" }}>
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={handleSave}
            disabled={create.isPending}
            className="w-full rounded-xl py-3 text-sm font-semibold disabled:opacity-50"
            style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
          >
            Add Arena
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="text-[11px] font-semibold uppercase tracking-wider"
      style={{ color: "var(--color-bt-text-dim)" }}
    >
      {children}
    </p>
  );
}

function formatDateTime(date: string | null, time: string | null): string {
  const datePart = date ? formatShortDate(date) : null;
  const timePart = time ? formatTime(time) : null;
  return [datePart, timePart].filter(Boolean).join(" · ");
}

function formatShortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatTime(time: string): string {
  // schedule_items.scheduled_time is `HH:MM:SS` from Postgres time type;
  // arenas.arena_time is free text. Try to parse the structured form first.
  const match = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!match) return time;
  const hour = parseInt(match[1], 10);
  const minute = match[2];
  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${displayHour}:${minute} ${suffix}`;
}

// ── Field ───────────────────────────────────────────────────────────────────

function Field({
  label,
  required,
  optional,
  children,
}: {
  label: string;
  required?: boolean;
  optional?: boolean;
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
    </div>
  );
}

