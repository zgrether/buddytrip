"use client";

import { useState } from "react";
import { ArrowRight, Calendar, ChevronDown, MapPin } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { EventsPanel } from "./EventsPanel";
import { VenuesPanel } from "./VenuesPanel";

interface Props {
  competitionId: string;
  tripId: string;
  canEdit: boolean;
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
export function MatchupPanel({ competitionId, tripId, canEdit }: Props) {
  const [open, setOpen] = useState(true);

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
          <Calendar size={14} />
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
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 md:gap-4">
        <Column
          icon={<Calendar size={12} />}
          label="Unassigned Events"
          hint={canEdit ? "Drag a card onto a venue to assign" : undefined}
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
          hint={canEdit ? "Drop a dragged event here" : undefined}
        >
          <VenuesPanel
            competitionId={competitionId}
            tripId={tripId}
            canEdit={canEdit}
            bare
          />
        </Column>
      </div>
    </CollapsiblePanel>
  );
}

// ── Column header ───────────────────────────────────────────────────────────

function Column({
  icon,
  label,
  hint,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
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
          style={{ borderTop: `1px solid ${borderColor}` }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
