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
import { DND_EVENT_KEY } from "./EventsPanel";

interface Props {
  competitionId: string;
  tripId: string;
  canEdit: boolean;
}

interface VenueRow {
  id: string;
  competition_id: string;
  schedule_item_id: string | null;
  event_id: string | null;
  name: string | null;
  location: string | null;
  venue_date: string | null;
  venue_time: string | null;
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
  is_confirmed: boolean;
}

interface EventRow {
  id: string;
  type: "GOLF" | "GENERIC";
  title: string;
  is_practice: boolean;
  points_available: number | null;
}

// ── VenuesPanel ─────────────────────────────────────────────────────────────

export function VenuesPanel({ competitionId, tripId, canEdit }: Props) {
  const [open, setOpen] = useState(true);
  const [creatingManual, setCreatingManual] = useState(false);

  const { data: venues = [] } = trpc.venues.list.useQuery(
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

  const venuesTyped = venues as VenueRow[];
  const golfTyped = golfItems as ScheduleItemRow[];
  const eventsTyped = events as EventRow[];

  const scheduledVenues = venuesTyped.filter((v) => !v.is_anytime);
  const anytimeVenues = venuesTyped.filter((v) => v.is_anytime);

  // For each golf schedule item, find the venue (if any) that links to it.
  const venueByScheduleItem = useMemo(() => {
    const map = new Map<string, VenueRow>();
    for (const v of scheduledVenues) {
      if (v.schedule_item_id) map.set(v.schedule_item_id, v);
    }
    return map;
  }, [scheduledVenues]);

  // Manual scheduled venues (no schedule_item_id but not anytime).
  const manualScheduledVenues = scheduledVenues.filter(
    (v) => !v.schedule_item_id
  );

  // Non-practice events that aren't pinned to any venue yet.
  const unassignedEvents = eventsTyped.filter(
    (e) => !e.is_practice && !venuesTyped.some((v) => v.event_id === e.id)
  );

  const totalScheduledItems = golfTyped.length + manualScheduledVenues.length;
  const linkedCount = venuesTyped.filter((v) => v.event_id).length;
  const allLinked =
    totalScheduledItems > 0 &&
    linkedCount === totalScheduledItems &&
    unassignedEvents.length === 0;

  const totalPanels = venuesTyped.length + golfTyped.length;
  const headerState =
    totalPanels === 0 ? "todo" : allLinked ? "done" : "inProgress";
  const statusText =
    totalPanels === 0
      ? "Not set up"
      : `${linkedCount} of ${venuesTyped.length} venue${venuesTyped.length === 1 ? "" : "s"} linked`;

  return (
    <CollapsiblePanel
      icon={<MapPin size={16} />}
      label="Venues"
      note={statusText}
      state={headerState}
      open={open}
      onToggle={() => setOpen((v) => !v)}
      testId="venues-panel"
    >
      <div className="space-y-5">
        {totalPanels === 0 && (
          <VenuesEmptyState
            canEdit={canEdit}
            onAddManual={() => setCreatingManual(true)}
          />
        )}

        {totalPanels > 0 && (
          <ScheduledSection
            tripId={tripId}
            competitionId={competitionId}
            golfItems={golfTyped}
            venueByScheduleItem={venueByScheduleItem}
            manualScheduledVenues={manualScheduledVenues}
            events={eventsTyped}
            venuesTyped={venuesTyped}
            canEdit={canEdit}
          />
        )}

        {totalPanels > 0 && (
          <AnytimeSection
            tripId={tripId}
            competitionId={competitionId}
            anytimeVenues={anytimeVenues}
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
            Add Venue Manually
          </button>
        )}
      </div>

      {creatingManual && (
        <ManualVenueSheet
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

// ── VenuesEmptyState ────────────────────────────────────────────────────────

function VenuesEmptyState({
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
        No venues yet
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
          Add Venue
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
  venueByScheduleItem,
  manualScheduledVenues,
  events,
  venuesTyped,
  canEdit,
}: {
  tripId: string;
  competitionId: string;
  golfItems: ScheduleItemRow[];
  venueByScheduleItem: Map<string, VenueRow>;
  manualScheduledVenues: VenueRow[];
  events: EventRow[];
  venuesTyped: VenueRow[];
  canEdit: boolean;
}) {
  return (
    <section>
      <SectionLabel>Confirmed Venues</SectionLabel>

      {golfItems.length === 0 && manualScheduledVenues.length === 0 && (
        <p
          className="mt-2 text-[11px]"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          No confirmed golf tee times yet. Confirm them in the Schedule tab to
          link them as venues.
        </p>
      )}

      <div className="mt-2 space-y-2">
        {golfItems.map((item) => {
          const venue = venueByScheduleItem.get(item.id);
          if (venue) {
            return (
              <VenueRowView
                key={`item-${item.id}`}
                venue={venue}
                events={events}
                venuesTyped={venuesTyped}
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

        {manualScheduledVenues.map((venue) => (
          <VenueRowView
            key={`venue-${venue.id}`}
            venue={venue}
            events={events}
            venuesTyped={venuesTyped}
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
  const [dragOver, setDragOver] = useState(false);
  const create = trpc.venues.create.useMutation({
    onSettled: () => utils.venues.list.invalidate({ tripId, competitionId }),
  });
  const assign = trpc.venues.assignEvent.useMutation({
    onSettled: () => utils.venues.list.invalidate({ tripId, competitionId }),
  });

  // Only confirmed schedule items reach this row — schedule.listGolf
  // already filters on is_confirmed=true. The router's create mutation
  // re-checks server-side as defense in depth.

  // Drop target — drop creates the venue from this schedule row AND
  // assigns the dragged event in a single chain, so the user doesn't
  // need to click "+ Add to Competition" first.
  async function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (!canEdit) return;
    const eventId = e.dataTransfer.getData(DND_EVENT_KEY);
    if (!eventId) return;
    const venue = await create.mutateAsync({
      tripId,
      competitionId,
      scheduleItemId: item.id,
    });
    await assign.mutateAsync({
      tripId,
      venueId: venue.id,
      eventId,
    });
  }

  return (
    <div
      className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors"
      style={{
        background: "var(--color-bt-card-raised)",
        border: `${dragOver ? "1.5px" : "1px"} dashed ${
          dragOver ? "var(--color-bt-accent)" : "var(--color-bt-border)"
        }`,
        opacity: dragOver ? 1 : 0.85,
      }}
      onDragOver={
        canEdit
          ? (e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              setDragOver(true);
            }
          : undefined
      }
      onDragLeave={canEdit ? () => setDragOver(false) : undefined}
      onDrop={canEdit ? handleDrop : undefined}
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
          disabled={create.isPending || assign.isPending}
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

// ── VenueRowView (linked venue, optionally with an event) ───────────────────

function VenueRowView({
  venue,
  events,
  venuesTyped,
  tripId,
  competitionId,
  canEdit,
}: {
  venue: VenueRow;
  events: EventRow[];
  venuesTyped: VenueRow[];
  tripId: string;
  competitionId: string;
  canEdit: boolean;
}) {
  const utils = trpc.useUtils();
  const [dragOver, setDragOver] = useState(false);
  const linkedEvent = events.find((e) => e.id === venue.event_id) ?? null;
  const titleSource =
    venue.schedule_item?.course_name ??
    venue.schedule_item?.title ??
    venue.name ??
    "Venue";
  const dateTime = venue.schedule_item
    ? formatDateTime(
        venue.schedule_item.scheduled_date,
        venue.schedule_item.scheduled_time
      )
    : formatDateTime(venue.venue_date, venue.venue_time);

  // Drag-from-EventsPanel target. assignEvent on the router detaches the
  // event from any prior venue, so dropping a linked event reassigns
  // cleanly without a CONFLICT.
  const dropAssign = trpc.venues.assignEvent.useMutation({
    onSettled: () => utils.venues.list.invalidate({ tripId, competitionId }),
  });

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (!canEdit) return;
    const eventId = e.dataTransfer.getData(DND_EVENT_KEY);
    if (!eventId) return;
    if (eventId === venue.event_id) return; // already here
    dropAssign.mutate({ tripId, venueId: venue.id, eventId });
  }

  return (
    <div
      className="rounded-xl px-3 py-2.5 transition-colors"
      style={{
        background: "var(--color-bt-card-raised)",
        border: `${dragOver ? "1.5px" : "1px"} ${dragOver ? "dashed" : "solid"} ${
          dragOver ? "var(--color-bt-accent)" : "var(--color-bt-border)"
        }`,
      }}
      onDragOver={
        canEdit
          ? (e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              setDragOver(true);
            }
          : undefined
      }
      onDragLeave={canEdit ? () => setDragOver(false) : undefined}
      onDrop={canEdit ? handleDrop : undefined}
      data-testid={`venue-${venue.id}`}
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
            venueId={venue.id}
            tripId={tripId}
            competitionId={competitionId}
            events={events}
            venuesTyped={venuesTyped}
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
              venueId={venue.id}
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
  venueId,
  tripId,
  competitionId,
  events,
  venuesTyped,
}: {
  venueId: string;
  tripId: string;
  competitionId: string;
  events: EventRow[];
  venuesTyped: VenueRow[];
}) {
  const utils = trpc.useUtils();
  const assign = trpc.venues.assignEvent.useMutation({
    onSettled: () => utils.venues.list.invalidate({ tripId, competitionId }),
  });

  const assignableEvents = events.filter(
    (e) => !e.is_practice && !venuesTyped.some((v) => v.event_id === e.id)
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
        assign.mutate({ tripId, venueId, eventId: e.target.value });
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
  venueId,
  tripId,
  competitionId,
}: {
  venueId: string;
  tripId: string;
  competitionId: string;
}) {
  const utils = trpc.useUtils();
  const unassign = trpc.venues.unassignEvent.useMutation({
    onSettled: () => utils.venues.list.invalidate({ tripId, competitionId }),
  });
  return (
    <button
      type="button"
      onClick={() => unassign.mutate({ tripId, venueId })}
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
  anytimeVenues,
  events,
  unassignedEvents,
  canEdit,
}: {
  tripId: string;
  competitionId: string;
  anytimeVenues: VenueRow[];
  events: EventRow[];
  unassignedEvents: EventRow[];
  canEdit: boolean;
}) {
  // Each AnytimeVenueRow owns its own delete + assign mutations now that
  // it doubles as a drop target — the section itself just composes the
  // children + the suggestion list below.

  // "Anytime" suggestion only shows non-practice events that have no
  // venue at all — once an event is in an Anytime venue we don't repeat
  // the suggestion below.
  const suggestable = unassignedEvents;

  if (anytimeVenues.length === 0 && suggestable.length === 0) return null;

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
        {anytimeVenues.map((venue) => (
          <AnytimeVenueRow
            key={venue.id}
            venue={venue}
            events={events}
            tripId={tripId}
            competitionId={competitionId}
            canEdit={canEdit}
          />
        ))}

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

function AnytimeVenueRow({
  venue,
  events,
  tripId,
  competitionId,
  canEdit,
}: {
  venue: VenueRow;
  events: EventRow[];
  tripId: string;
  competitionId: string;
  canEdit: boolean;
}) {
  const utils = trpc.useUtils();
  const [dragOver, setDragOver] = useState(false);
  const linkedEvent = events.find((e) => e.id === venue.event_id);
  const label = linkedEvent?.title ?? venue.name ?? "Anytime";
  const pts = linkedEvent?.points_available;

  const remove = trpc.venues.delete.useMutation({
    onSettled: () => utils.venues.list.invalidate({ tripId, competitionId }),
  });
  const assign = trpc.venues.assignEvent.useMutation({
    onSettled: () => utils.venues.list.invalidate({ tripId, competitionId }),
  });

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (!canEdit) return;
    const eventId = e.dataTransfer.getData(DND_EVENT_KEY);
    if (!eventId) return;
    if (eventId === venue.event_id) return;
    assign.mutate({ tripId, venueId: venue.id, eventId });
  }

  return (
    <div
      className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors"
      style={{
        background: "var(--color-bt-card-raised)",
        border: `${dragOver ? "1.5px" : "1px"} ${dragOver ? "dashed" : "solid"} ${
          dragOver ? "var(--color-bt-accent)" : "var(--color-bt-border)"
        }`,
      }}
      onDragOver={
        canEdit
          ? (e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              setDragOver(true);
            }
          : undefined
      }
      onDragLeave={canEdit ? () => setDragOver(false) : undefined}
      onDrop={canEdit ? handleDrop : undefined}
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
          onClick={() => remove.mutate({ tripId, venueId: venue.id })}
          aria-label="Remove venue"
          className="flex h-6 w-6 items-center justify-center rounded-md"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          <X size={13} />
        </button>
      )}
    </div>
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
  const create = trpc.venues.create.useMutation();
  const assign = trpc.venues.assignEvent.useMutation({
    onSettled: () => utils.venues.list.invalidate({ tripId, competitionId }),
  });

  async function markAnytime() {
    const venue = await create.mutateAsync({
      tripId,
      competitionId,
      name: event.title,
      isAnytime: true,
    });
    await assign.mutateAsync({
      tripId,
      venueId: venue.id,
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

// ── ManualVenueSheet ────────────────────────────────────────────────────────

function ManualVenueSheet({
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

  const create = trpc.venues.create.useMutation({
    onSettled: () => utils.venues.list.invalidate({ tripId, competitionId }),
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
        venueDate: date || undefined,
        venueTime: time.trim() || undefined,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add venue");
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
            Add Venue
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
            Add Venue
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
  // venues.venue_time is free text. Try to parse the structured form first.
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
