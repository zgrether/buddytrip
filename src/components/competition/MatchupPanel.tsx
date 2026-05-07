"use client";

import { useState } from "react";
import { ArrowRight, ChevronDown, Flag, MapPin, Plus } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { EventSheet, EventsPanel } from "./EventsPanel";
import { ManualVenueSheet, VenuesPanel } from "./VenuesPanel";

interface Props {
  competitionId: string;
  tripId: string;
  canEdit: boolean;
  /** When provided, the parent (CompTab) drives the +Event / +Venue
   *  create state via CompetitionHeader's action bar. Local state is
   *  used as a fallback so this panel still works standalone. */
  creatingEvent?: boolean;
  onCreatingEventChange?: (v: boolean) => void;
  creatingManualVenue?: boolean;
  onCreatingManualVenueChange?: (v: boolean) => void;
}

/**
 * MatchupPanel — single collapsible owning Events on the left and Venues
 * on the right. Drag the grip handle on an event onto a venue card to
 * assign; both columns are always visible while the panel is open so
 * the drop target can't get hidden by an unrelated collapse state.
 *
 * The two child components render in `bare` mode — their internal
 * collapsibles are skipped and we own the outer chrome here. The data
 * queries inside each are still independent (and TanStack Query
 * dedupes them across renders), so there's no extra fetch overhead.
 */
export function MatchupPanel({
  competitionId,
  tripId,
  canEdit,
  creatingEvent: creatingEventProp,
  onCreatingEventChange,
  creatingManualVenue: creatingManualVenueProp,
  onCreatingManualVenueChange,
}: Props) {
  const [open, setOpen] = useState(true);
  // The +Event / +Venue affordances live in CompetitionHeader's action
  // bar now — this panel just consumes the create state via props.
  // Local state stays as a standalone-mode fallback.
  const [creatingEventLocal, setCreatingEventLocal] = useState(false);
  const [creatingManualVenueLocal, setCreatingManualVenueLocal] = useState(false);
  const creatingEvent = creatingEventProp ?? creatingEventLocal;
  const creatingManualVenue =
    creatingManualVenueProp ?? creatingManualVenueLocal;
  const setCreatingEvent = (v: boolean) => {
    if (onCreatingEventChange) onCreatingEventChange(v);
    else setCreatingEventLocal(v);
  };
  const setCreatingManualVenue = (v: boolean) => {
    if (onCreatingManualVenueChange) onCreatingManualVenueChange(v);
    else setCreatingManualVenueLocal(v);
  };

  // Combined status string for the header — keeps the user oriented
  // without having to expand to see "anything to do here?"
  const { data: events = [] } = trpc.events.list.useQuery(
    { tripId, competitionId },
    { enabled: !!competitionId }
  );
  const { data: venues = [] } = trpc.venues.list.useQuery(
    { tripId, competitionId },
    { enabled: !!competitionId }
  );

  const eventsTyped = events as Array<{ is_practice: boolean }>;
  const venuesTyped = venues as Array<{ event_id: string | null }>;

  const scoredEvents = eventsTyped.filter((e) => !e.is_practice).length;
  const linkedVenues = venuesTyped.filter((v) => v.event_id).length;
  const allLinked = scoredEvents > 0 && linkedVenues === scoredEvents;

  const headerState = scoredEvents === 0 ? "todo" : allLinked ? "done" : "inProgress";
  const statusText =
    scoredEvents === 0
      ? "Not set up"
      : `${scoredEvents} event${scoredEvents === 1 ? "" : "s"} · ${linkedVenues} linked`;

  return (
    <CollapsiblePanel
      icon={
        <div className="flex items-center" aria-hidden>
          <Flag size={14} />
          <ArrowRight size={11} className="mx-0.5" />
          <MapPin size={14} />
        </div>
      }
      label="Events &amp; Venues"
      note={statusText}
      state={headerState}
      open={open}
      onToggle={() => setOpen((v) => !v)}
      testId="matchup-panel"
    >
      {events.length === 0 ? (
        <NoEventsEmptyState
          canEdit={canEdit}
          onAdd={() => setCreatingEvent(true)}
        />
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_2fr] lg:gap-4">
          <Column
            icon={<Flag size={12} />}
            label="Unassigned Events"
            hint={canEdit ? "Drag onto a venue to assign" : undefined}
          >
            <EventsPanel
              competitionId={competitionId}
              tripId={tripId}
              canEdit={canEdit}
              bare
            />
          </Column>
          <Column
            icon={<MapPin size={12} />}
            label="Confirmed Venues"
            hint={canEdit ? "Drop an event here" : undefined}
          >
            <VenuesPanel
              competitionId={competitionId}
              tripId={tripId}
              canEdit={canEdit}
              bare
            />
          </Column>
        </div>
      )}

      {creatingEvent && (
        <EventSheet
          tripId={tripId}
          competitionId={competitionId}
          event={null}
          onClose={() => setCreatingEvent(false)}
        />
      )}
      {creatingManualVenue && (
        <ManualVenueSheet
          tripId={tripId}
          competitionId={competitionId}
          onClose={() => setCreatingManualVenue(false)}
        />
      )}
    </CollapsiblePanel>
  );
}

// ── NoEventsEmptyState ─────────────────────────────────────────────────────
//
// Shown until the competition has at least one event. Mirrors the Teams
// panel empty state — once an event exists the full two-column matchup
// view takes over. Venues and unlinked schedule items are still
// reachable then (they show up in the Confirmed Venues column).

function NoEventsEmptyState({
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
        <Flag size={20} />
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

// ── Column header ───────────────────────────────────────────────────────────

function Column({
  icon,
  label,
  hint,
  className,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={className}>
      <div className="mb-2 flex items-baseline gap-2">
        <span style={{ color: "var(--color-bt-text-dim)" }}>{icon}</span>
        <h4
          className="text-[11px] font-semibold uppercase tracking-wider"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          {label}
        </h4>
        {hint && (
          <span
            className="text-[10px] italic"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            {hint}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

// ── CollapsiblePanel (mirrors the shape used in the other comp panels) ─────

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
  /** State retained on the prop for future use, but no longer drives any
   *  styling — the outer Events & Venues chrome stays neutral regardless
   *  of how many events are linked. Confirmation is communicated by the
   *  inner content (teal flags / linked-event chips) instead. */
  state?: "done" | "inProgress" | "todo";
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
          <p
            className="mt-0.5 text-xs"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
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
