"use client";

import { useState, useMemo } from "react";
import {
  ChevronDown,
  Cloud,
  Hotel,
  MapPin,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { DND_EVENT_KEY, EventSheet, type EventRow } from "./EventsPanel";

// ── Optimistic mutation hook ────────────────────────────────────────────────
// All four drag drop targets (existing venue, anytime venue, anytime drop
// zone, unlinked schedule row) plus the inline × on a linked-event chip
// flow through the same venues.list cache. Centralizing the optimistic
// onMutate here means the chip moves the moment the user releases, not
// after the network round-trip.

interface OptimisticVenueRow {
  id: string;
  competition_id: string;
  schedule_item_id: string | null;
  event_id: string | null;
  is_anytime: boolean;
  name: string | null;
  location: string | null;
  venue_date: string | null;
  venue_time: string | null;
  schedule_item?: unknown;
}

function useVenueAssignmentMutations(tripId: string, competitionId: string) {
  const utils = trpc.useUtils();
  const queryKey = { tripId, competitionId };

  const assign = trpc.venues.assignEvent.useMutation({
    onMutate: async (vars) => {
      await utils.venues.list.cancel(queryKey);
      const previous = utils.venues.list.getData(queryKey);
      utils.venues.list.setData(queryKey, (old) => {
        const list = (old as OptimisticVenueRow[] | undefined) ?? [];
        return list.map((v) => {
          // Set new target
          if (v.id === vars.venueId) return { ...v, event_id: vars.eventId };
          // Detach this event from any prior venue (matches router behavior)
          if (v.event_id === vars.eventId) return { ...v, event_id: null };
          return v;
        }) as never;
      });
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) {
        utils.venues.list.setData(queryKey, ctx.previous);
      }
    },
    onSettled: () => utils.venues.list.invalidate(queryKey),
  });

  const unassign = trpc.venues.unassignEvent.useMutation({
    onMutate: async (vars) => {
      await utils.venues.list.cancel(queryKey);
      const previous = utils.venues.list.getData(queryKey);
      utils.venues.list.setData(queryKey, (old) => {
        const list = (old as OptimisticVenueRow[] | undefined) ?? [];
        return list.map((v) =>
          v.id === vars.venueId
            ? { ...v, event_id: null, is_anytime: false }
            : v
        ) as never;
      });
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) {
        utils.venues.list.setData(queryKey, ctx.previous);
      }
    },
    onSettled: () => utils.venues.list.invalidate(queryKey),
  });

  const remove = trpc.venues.delete.useMutation({
    onMutate: async (vars) => {
      await utils.venues.list.cancel(queryKey);
      const previous = utils.venues.list.getData(queryKey);
      utils.venues.list.setData(queryKey, (old) => {
        const list = (old as OptimisticVenueRow[] | undefined) ?? [];
        return list.filter((v) => v.id !== vars.venueId) as never;
      });
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) {
        utils.venues.list.setData(queryKey, ctx.previous);
      }
    },
    onSettled: () => utils.venues.list.invalidate(queryKey),
  });

  return { assign, unassign, remove };
}

interface Props {
  competitionId: string;
  tripId: string;
  canEdit: boolean;
  /** When true, render just the body — see EventsPanel for the rationale. */
  bare?: boolean;
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

// EventRow shape comes from EventsPanel — re-exported there so the same
// type drives the linked-event chip rendered inside venue cards. We
// only need a subset of its fields here.

// ── VenuesPanel ─────────────────────────────────────────────────────────────

export function VenuesPanel({ competitionId, tripId, canEdit, bare }: Props) {
  const [open, setOpen] = useState(true);
  const [creatingManual, setCreatingManual] = useState(false);
  const [editingEvent, setEditingEvent] = useState<EventRow | null>(null);

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

  const body = (
    <>
      <div className="space-y-5">
        {totalPanels === 0 && (
          <VenuesEmptyState
            canEdit={canEdit}
            onAddManual={() => setCreatingManual(true)}
            showButton={!bare}
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
            onEditLinkedEvent={setEditingEvent}
            onAddManual={() => setCreatingManual(true)}
            showAddButton={!bare}
          />
        )}

        {totalPanels > 0 && (
          <AnytimeSection
            tripId={tripId}
            competitionId={competitionId}
            anytimeVenues={anytimeVenues}
            events={eventsTyped}
            canEdit={canEdit}
            onEditLinkedEvent={setEditingEvent}
          />
        )}
      </div>

      {creatingManual && (
        <ManualVenueSheet
          tripId={tripId}
          competitionId={competitionId}
          onClose={() => setCreatingManual(false)}
        />
      )}
      {editingEvent && (
        <EventSheet
          tripId={tripId}
          competitionId={competitionId}
          event={editingEvent}
          onClose={() => setEditingEvent(null)}
        />
      )}
    </>
  );

  if (bare) return body;

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

// ── VenuesEmptyState ────────────────────────────────────────────────────────

function VenuesEmptyState({
  canEdit,
  onAddManual,
  showButton,
}: {
  canEdit: boolean;
  onAddManual: () => void;
  /** When false (bare mode), the inline button is suppressed because
   *  the parent (MatchupPanel) renders its own above the column. */
  showButton: boolean;
}) {
  return (
    <div className="py-2 text-center">
      <p className="text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
        {showButton
          ? "No venues yet. Add tee times in Schedule, or use the button below."
          : "No venues yet. Add tee times in Schedule, or use Add Venue above."}
      </p>
      {canEdit && showButton && (
        <div className="mx-auto mt-3 max-w-xs">
          <AddVenueButton onClick={onAddManual} />
        </div>
      )}
    </div>
  );
}

export function AddVenueButton({
  onClick,
  className,
}: {
  onClick: () => void;
  className?: string;
}) {
  // Matches the Lodging/Schedule "+ Property / + Item" affordance:
  // card-raised background, regular border, icon-then-Plus-then-noun.
  // Re-exported so MatchupPanel can render its own copy above the
  // Confirmed Venues column header.
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
      <MapPin size={15} />
      <Plus size={12} /> Venue
    </button>
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
  onEditLinkedEvent,
  onAddManual,
  showAddButton,
}: {
  tripId: string;
  competitionId: string;
  golfItems: ScheduleItemRow[];
  venueByScheduleItem: Map<string, VenueRow>;
  manualScheduledVenues: VenueRow[];
  events: EventRow[];
  venuesTyped: VenueRow[];
  canEdit: boolean;
  onEditLinkedEvent: (event: EventRow) => void;
  onAddManual: () => void;
  /** Hidden in bare mode — MatchupPanel owns the above-column copy. */
  showAddButton: boolean;
}) {
  // Section label removed — the column header in MatchupPanel already
  // reads "Confirmed Venues", so this would be the third level of
  // header on the screen.
  return (
    <section>
      {golfItems.length === 0 && manualScheduledVenues.length === 0 && (
        <p
          className="text-[11px]"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          No confirmed golf tee times yet. Confirm them in the Schedule tab to
          link them as venues.
        </p>
      )}

      <div className="space-y-2">
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
                onEditLinkedEvent={onEditLinkedEvent}
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
            onEditLinkedEvent={onEditLinkedEvent}
          />
        ))}

        {canEdit && showAddButton && <AddVenueButton onClick={onAddManual} />}
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
      <MapPin size={14} style={{ color: "var(--color-bt-text-dim)" }} />
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
  onEditLinkedEvent,
}: {
  venue: VenueRow;
  events: EventRow[];
  venuesTyped: VenueRow[];
  tripId: string;
  competitionId: string;
  canEdit: boolean;
  onEditLinkedEvent: (event: EventRow) => void;
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
  // cleanly without a CONFLICT. Optimistic via the shared hook so the
  // chip lands the moment the user releases.
  const { assign: dropAssign, remove } = useVenueAssignmentMutations(
    tripId,
    competitionId
  );

  // Manual venues (no schedule_item linkage) can be deleted from this
  // row — they aren't tied to anything in Schedule, so removing them is
  // a no-collateral action. Schedule-linked venues are unlinked instead
  // by toggling the schedule item's confirmation in the Schedule tab.
  const isManual = !venue.schedule_item_id && !venue.is_anytime;
  const [confirmingDelete, setConfirmingDelete] = useState(false);

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
        {/* Manual venues (no schedule_item linkage) get the lodging icon
            so they read as "venue we typed in by hand" rather than a
            tee-time-derived row. */}
        {venue.schedule_item_id ? (
          <MapPin size={14} style={{ color: "var(--color-bt-accent)" }} />
        ) : (
          <Hotel size={14} style={{ color: "var(--color-bt-accent)" }} />
        )}
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
        {isManual && canEdit && (
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            aria-label={`Delete ${titleSource}`}
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>

      {confirmingDelete && (
        <DeleteVenueConfirm
          venueName={titleSource}
          isPending={remove.isPending}
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={() => {
            remove.mutate({ tripId, venueId: venue.id });
            setConfirmingDelete(false);
          }}
        />
      )}

      {linkedEvent && (
        <LinkedEventDetails
          event={linkedEvent}
          venueId={venue.id}
          tripId={tripId}
          competitionId={competitionId}
          canEdit={canEdit}
          onEdit={() => onEditLinkedEvent(linkedEvent)}
        />
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
  const { assign } = useVenueAssignmentMutations(tripId, competitionId);

  const assignableEvents = events.filter(
    (e) => !e.is_practice && !venuesTyped.some((v) => v.event_id === e.id)
  );

  if (assignableEvents.length === 0) {
    return (
      <span
        className="text-[11px] lg:hidden"
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
      className="rounded-md px-2 py-1 text-xs lg:hidden"
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
  const { unassign } = useVenueAssignmentMutations(tripId, competitionId);
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

// ── LinkedEventDetails ──────────────────────────────────────────────────────
//
// Shown inside a venue card once an event has been pinned. Replaces the
// EventCard in the Unassigned column (the event filters out of there
// once linked), so this needs to carry enough info to manage the event
// in place: format chip, practice badge, points distribution summary,
// description preview, plus pencil-edit + × unassign buttons.

const FORMAT_LABELS: Record<string, string> = {
  scramble: "Scramble",
  stableford: "Stableford",
  skins: "Skins",
  match_play: "Match Play",
  singles: "Singles",
  sabotage: "Sabotage",
  other: "Other",
};

function LinkedEventDetails({
  event,
  venueId,
  tripId,
  competitionId,
  canEdit,
  onEdit,
}: {
  event: EventRow;
  venueId: string;
  tripId: string;
  competitionId: string;
  canEdit: boolean;
  onEdit: () => void;
}) {
  const { unassign } = useVenueAssignmentMutations(tripId, competitionId);

  const isGolf = event.type === "GOLF";
  const formatLabel = event.scoring_format
    ? FORMAT_LABELS[event.scoring_format] ?? event.scoring_format
    : null;
  const dist = event.point_distributions ?? [];
  const distSummary = dist.length > 0
    ? dist
        .slice(0, 3)
        .map((d) => `${ordinalShort(d.position)}: ${d.points}pt${d.points === 1 ? "" : "s"}`)
        .join(" · ")
    : null;

  return (
    <div
      className={`mt-2 rounded-lg px-2.5 py-2 ${
        canEdit ? "cursor-grab active:cursor-grabbing" : ""
      }`}
      style={{
        background: "var(--color-bt-accent-faint)",
        border: "1px solid var(--color-bt-accent-border)",
      }}
      draggable={canEdit}
      onDragStart={
        canEdit
          ? (e) => {
              e.dataTransfer.setData(DND_EVENT_KEY, event.id);
              e.dataTransfer.effectAllowed = "move";
            }
          : undefined
      }
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-1.5">
            <span
              className="text-xs font-semibold"
              style={{ color: "var(--color-bt-accent)" }}
            >
              {event.title}
            </span>
            {isGolf && formatLabel && (
              <span
                className="rounded px-1 py-0 text-[9px] font-bold uppercase"
                style={{
                  background: "var(--color-bt-card)",
                  color: "var(--color-bt-text-dim)",
                  border: "1px solid var(--color-bt-border)",
                }}
              >
                {formatLabel}
              </span>
            )}
            {event.is_practice && (
              <span
                className="rounded px-1 py-0 text-[9px] font-bold uppercase"
                style={{
                  background: "var(--color-bt-warning-faint)",
                  color: "var(--color-bt-warning)",
                }}
              >
                Practice
              </span>
            )}
            {event.points_available !== null && (
              <span
                className="text-[10px]"
                style={{ color: "var(--color-bt-accent)" }}
              >
                · {event.points_available}pt{event.points_available === 1 ? "" : "s"}
              </span>
            )}
          </div>
          {distSummary && (
            <p
              className="mt-0.5 text-[10px]"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              {distSummary}
            </p>
          )}
          {event.description && (
            <p
              className="mt-0.5 line-clamp-2 text-[10px]"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              {event.description}
            </p>
          )}
        </div>
        {canEdit && (
          <div className="flex flex-shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={onEdit}
              aria-label={`Edit ${event.title}`}
              className="flex h-5 w-5 items-center justify-center rounded"
              style={{ color: "var(--color-bt-accent)" }}
            >
              <Pencil size={11} />
            </button>
            <button
              type="button"
              onClick={() => unassign.mutate({ tripId, venueId })}
              disabled={unassign.isPending}
              aria-label="Unassign event"
              className="flex h-5 w-5 items-center justify-center rounded"
              style={{ color: "var(--color-bt-accent)" }}
            >
              <X size={11} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ordinalShort(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// ── AnytimeSection ──────────────────────────────────────────────────────────

function AnytimeSection({
  tripId,
  competitionId,
  anytimeVenues,
  events,
  canEdit,
  onEditLinkedEvent,
}: {
  tripId: string;
  competitionId: string;
  anytimeVenues: VenueRow[];
  events: EventRow[];
  canEdit: boolean;
  onEditLinkedEvent: (event: EventRow) => void;
}) {
  // Always render the section so the drop zone is reachable even when
  // no anytime venues exist yet — that's how the user creates one in
  // the new flow (drag an event onto the dashed Anytime box).
  return (
    <section>
      <SectionLabel>Anytime</SectionLabel>

      <AnytimeDropZone
        tripId={tripId}
        competitionId={competitionId}
        events={events}
        canEdit={canEdit}
      />

      {anytimeVenues.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {anytimeVenues.map((venue) => (
            <AnytimeVenueRow
              key={venue.id}
              venue={venue}
              events={events}
              tripId={tripId}
              competitionId={competitionId}
              canEdit={canEdit}
              onEditLinkedEvent={onEditLinkedEvent}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function AnytimeDropZone({
  tripId,
  competitionId,
  events,
  canEdit,
}: {
  tripId: string;
  competitionId: string;
  events: EventRow[];
  canEdit: boolean;
}) {
  const utils = trpc.useUtils();
  const [dragOver, setDragOver] = useState(false);
  const create = trpc.venues.create.useMutation();
  const assign = trpc.venues.assignEvent.useMutation();

  // The chain (create → assign) doesn't fit the single-mutation
  // optimistic pattern in useVenueAssignmentMutations, so we do it
  // inline. Insert a temp anytime venue with the event already
  // attached, run both mutations, then invalidate to swap the temp
  // row with the real id. Rolls back to the snapshot on error.
  async function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (!canEdit) return;
    const eventId = e.dataTransfer.getData(DND_EVENT_KEY);
    if (!eventId) return;
    const event = events.find((ev) => ev.id === eventId);
    if (!event) return;

    const queryKey = { tripId, competitionId };
    const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const previous = utils.venues.list.getData(queryKey);

    utils.venues.list.setData(queryKey, (old) => {
      const list = (old as OptimisticVenueRow[] | undefined) ?? [];
      // Detach this event from any prior venue (move semantics).
      const cleaned = list.map((v) =>
        v.event_id === eventId ? { ...v, event_id: null } : v
      );
      const tempVenue: OptimisticVenueRow = {
        id: tempId,
        competition_id: competitionId,
        schedule_item_id: null,
        event_id: eventId,
        is_anytime: true,
        name: event.title,
        location: null,
        venue_date: null,
        venue_time: null,
        schedule_item: null,
      };
      return [...cleaned, tempVenue] as never;
    });

    try {
      const venue = await create.mutateAsync({
        tripId,
        competitionId,
        name: event.title,
        isAnytime: true,
      });
      await assign.mutateAsync({
        tripId,
        venueId: venue.id,
        eventId,
      });
      utils.venues.list.invalidate(queryKey);
    } catch (err) {
      utils.venues.list.setData(queryKey, previous);
      throw err;
    }
  }

  // Sized to match a Confirmed Venues row (px-3 py-2.5 with title + dim
  // subtext) so the drop zone reads as a peer surface, not an
  // afterthought tucked under the section.
  return (
    <div
      className="mt-1.5 flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors"
      style={{
        background: dragOver
          ? "var(--color-bt-accent-faint)"
          : "transparent",
        border: `1.5px dashed ${
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
      data-testid="anytime-dropzone"
    >
      <Cloud
        size={14}
        style={{
          color: dragOver
            ? "var(--color-bt-accent)"
            : "var(--color-bt-text-dim)",
          flexShrink: 0,
        }}
      />
      <div className="min-w-0 flex-1">
        <p
          className="text-sm font-medium"
          style={{
            color: dragOver
              ? "var(--color-bt-accent)"
              : "var(--color-bt-text)",
          }}
        >
          {canEdit ? "Drop here for Anytime" : "Anytime events"}
        </p>
        <p
          className="text-[11px]"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          No fixed time or place
        </p>
      </div>
    </div>
  );
}

function AnytimeVenueRow({
  venue,
  events,
  tripId,
  competitionId,
  canEdit,
  onEditLinkedEvent,
}: {
  venue: VenueRow;
  events: EventRow[];
  tripId: string;
  competitionId: string;
  canEdit: boolean;
  onEditLinkedEvent: (event: EventRow) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const linkedEvent = events.find((e) => e.id === venue.event_id);
  const label = linkedEvent?.title ?? venue.name ?? "Anytime";
  const pts = linkedEvent?.points_available;

  // Both remove + assign go through the optimistic hook now so the chip
  // either disappears (or moves) the moment the user releases.
  const { assign, remove } = useVenueAssignmentMutations(tripId, competitionId);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (!canEdit) return;
    const eventId = e.dataTransfer.getData(DND_EVENT_KEY);
    if (!eventId) return;
    if (eventId === venue.event_id) return;
    assign.mutate({ tripId, venueId: venue.id, eventId });
  }

  // Compact row — anytime venues are mostly metadata, no need for the
  // tall Confirmed-Venues-style card. The linked event still gets edit
  // + unassign affordances inline.
  return (
    <div
      className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 transition-colors"
      style={{
        background: "var(--color-bt-card-raised)",
        border: `1px ${dragOver ? "dashed" : "solid"} ${
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
      <Cloud size={12} style={{ color: "var(--color-bt-text-dim)" }} />
      <span
        className="flex-1 truncate text-xs font-medium"
        style={{ color: "var(--color-bt-text)" }}
      >
        {label}
        {pts !== undefined && pts !== null && (
          <span
            className="ml-1.5 text-[10px]"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            · {pts}pt{pts === 1 ? "" : "s"}
          </span>
        )}
      </span>
      {canEdit && linkedEvent && (
        <button
          type="button"
          onClick={() => onEditLinkedEvent(linkedEvent)}
          aria-label={`Edit ${linkedEvent.title}`}
          className="flex h-5 w-5 items-center justify-center rounded"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          <Pencil size={10} />
        </button>
      )}
      {canEdit && (
        <button
          type="button"
          onClick={() => remove.mutate({ tripId, venueId: venue.id })}
          aria-label="Remove venue"
          className="flex h-5 w-5 items-center justify-center rounded"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          <X size={11} />
        </button>
      )}
    </div>
  );
}

// (UnassignedEventPrompt was retired — replaced by AnytimeDropZone.)

// ── DeleteVenueConfirm ──────────────────────────────────────────────────────

function DeleteVenueConfirm({
  venueName,
  isPending,
  onCancel,
  onConfirm,
}: {
  venueName: string;
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
            Delete &ldquo;{venueName}&rdquo;?
          </h3>
          <p
            className="mt-1.5 text-sm leading-relaxed"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            This venue isn&rsquo;t tied to anything in Schedule or Lodging —
            removing it just clears it from the competition. Any linked
            event becomes unassigned.
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
            {isPending ? "Deleting…" : "Delete Venue"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── ManualVenueSheet ────────────────────────────────────────────────────────

export function ManualVenueSheet({
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
