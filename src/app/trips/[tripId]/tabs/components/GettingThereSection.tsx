"use client";

import { useState } from "react";
import {
  Car,
  ChevronDown,
  HelpCircle,
  Plane,
  Plus,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { UserAvatar } from "@/components/UserAvatar";

type TravelMode = "driving" | "flying" | "other";

interface TripMemberLite {
  memberId: string;
  user_id: string | null;
  displayName: string;
  isGuest?: boolean;
  travel_mode?: string | null;
  travel_detail?: string | null;
  flight_airline?: string | null;
  flight_number?: string | null;
  flight_airport?: string | null;
  flight_arrival_time?: string | null;
}

export interface GettingThereSectionProps {
  tripId: string;
  isOwner: boolean;
}

/**
 * GettingThereSection — the Home tab "Getting There" block shown during
 * the GOING/NOW stages.
 *
 * Everything renders in a single card:
 *   1. Section heading + helper line
 *   2. Your own travel row (expandable; opens automatically when empty)
 *   3. Owner-only pending tally: "N haven't shared travel plans" with a
 *      3-avatar stack
 *
 * Travel info is always shared — no opt-in toggle. The wider TravelEntryForm
 * in the Action Center still exists for older callers; this component
 * writes to the same `tripMembers.updateTravel` mutation.
 */
export function GettingThereSection({ tripId, isOwner }: GettingThereSectionProps) {
  const utils = trpc.useUtils();
  const currentUser = useCurrentUser();
  const { data: members = [] } = trpc.tripMembers.list.useQuery({ tripId });

  const myMember = (members as TripMemberLite[]).find(
    (m) => m.user_id === currentUser?.id,
  );
  const otherMembers = (members as TripMemberLite[]).filter(
    (m) => m.user_id !== currentUser?.id,
  );

  // Always start collapsed — the user opens the row deliberately by
  // tapping. Auto-expanding when empty was visually noisy and made the
  // panel default to a half-filled form for users who hadn't engaged yet.
  const [expanded, setExpanded] = useState(false);

  const hasMyTravel = !!myMember?.travel_mode;

  // ── Render ──────────────────────────────────────────────────────────────
  // Title + outer card chrome are now provided by the wrapping
  // GettingTherePanel CardShell — this section is just the inner content
  // (your row + pending tally) so the same component can sit cleanly
  // inside the panel surface.
  return (
    <div data-testid="getting-there-section">
      {/* Empty state mock-up — only when the user hasn't shared travel yet
          AND they're not currently editing. Mirrors the Itinerary empty
          state pattern: dashed card + icon + heading + description + faded
          skeleton preview of populated arrival rows. */}
      {myMember && !hasMyTravel && !expanded && (
        <div className="px-4 pt-4">
          <EmptyArrivalsState />
        </div>
      )}

      {myMember ? (
        <YourTravelRow
          tripId={tripId}
          member={myMember}
          expanded={expanded}
          onToggleExpanded={() => setExpanded((v) => !v)}
          onSaved={() => {
            utils.tripMembers.list.invalidate({ tripId });
            setExpanded(false);
          }}
        />
      ) : null}

      {/* Owner-only pending tally */}
      {isOwner && <PendingTravelRow members={otherMembers} />}
    </div>
  );
}

// ── EmptyArrivalsState ───────────────────────────────────────────────────
// Shown inside the GettingThere panel when the user hasn't shared their
// travel yet. Same shape as the Itinerary panel empty state: dashed card
// + centered icon/heading/description + faded skeleton preview of what
// populated arrival rows will look like.

function EmptyArrivalsState() {
  return (
    <div
      className="rounded-xl p-4"
      style={{
        background: "var(--color-bt-base)",
        border: "1px dashed var(--color-bt-border)",
      }}
    >
      <div className="flex flex-col items-center text-center">
        <div
          className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl"
          style={{
            background: "var(--color-bt-accent-faint)",
            color: "var(--color-bt-accent)",
          }}
        >
          <Plane size={22} />
        </div>
        <p className="text-sm font-bold" style={{ color: "var(--color-bt-text)" }}>
          Crew arrivals will weave together here
        </p>
        <p
          className="mt-1 max-w-[280px] text-xs leading-snug"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          Share your travel and the crew can coordinate pickups, dinner
          times, and tee slots around real arrival times.
        </p>
      </div>

      {/* Skeleton arrivals — three faded rows mirroring the intro modal */}
      <div
        className="mt-4 overflow-hidden rounded-lg"
        style={{
          background: "var(--color-bt-card)",
          border: "1px solid var(--color-bt-border)",
          opacity: 0.65,
        }}
      >
        <SkeletonArrival name="Zach" detail="Delta 1733" time="3:42 PM" mode="flying" />
        <SkeletonArrival name="Brad" detail="driving from Charlotte" time="~6:00 PM" mode="driving" />
        <SkeletonArrival name="Rob" detail="Delta 847" time="5:30 PM" mode="flying" last />
      </div>
    </div>
  );
}

function SkeletonArrival({
  name,
  detail,
  time,
  mode,
  last,
}: {
  name: string;
  detail: string;
  time: string;
  mode: "flying" | "driving";
  last?: boolean;
}) {
  const isFlying = mode === "flying";
  const Icon = isFlying ? Plane : Car;
  const badgeStyle = isFlying
    ? {
        background: "var(--color-bt-accent-faint)",
        color: "var(--color-bt-accent)",
        border: "1px solid var(--color-bt-accent-border)",
      }
    : {
        background: "var(--color-bt-warning-faint)",
        color: "var(--color-bt-warning)",
        border: "1px solid var(--color-bt-warning-border)",
      };
  return (
    <div
      className="flex items-center gap-2 px-3 py-2"
      style={{
        borderBottom: last ? undefined : "1px solid var(--color-bt-border)",
      }}
    >
      <div className="min-w-0 flex-1">
        <p
          className="text-[12px] font-semibold"
          style={{ color: "var(--color-bt-text)" }}
        >
          {name}{" "}
          <span style={{ fontWeight: 400, color: "var(--color-bt-text-dim)" }}>
            · {detail}
          </span>
        </p>
        <p className="text-[10px]" style={{ color: "var(--color-bt-text-dim)" }}>
          {time}
        </p>
      </div>
      <span
        className="flex flex-shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider"
        style={badgeStyle}
      >
        <Icon size={9} />
        {isFlying ? "Flying" : "Driving"}
      </span>
    </div>
  );
}

// ── YourTravelRow ─────────────────────────────────────────────────────────

function YourTravelRow({
  tripId,
  member,
  expanded,
  onToggleExpanded,
  onSaved,
}: {
  tripId: string;
  member: TripMemberLite;
  expanded: boolean;
  onToggleExpanded: () => void;
  onSaved: () => void;
}) {
  const hasTravel = !!member.travel_mode;

  // ── No travel info yet — Pattern 1 add button + optional inline form ──
  // Matches Schedule "Item", Lodging "Property", Receipts "Receipt", Crew
  // "Crew member" so add-affordances are consistent across the trip.
  if (!hasTravel) {
    return (
      <div className="px-4 py-3">
        {expanded ? (
          <TravelExpandForm tripId={tripId} member={member} onSaved={onSaved} onCancel={onToggleExpanded} />
        ) : (
          <button
            type="button"
            onClick={onToggleExpanded}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-medium transition-all"
            style={{
              background: "var(--color-bt-card-raised)",
              color: "var(--color-bt-text)",
              border: "1px solid var(--color-bt-border)",
            }}
          >
            <Plane size={15} />
            <Plus size={12} /> Travel info
          </button>
        )}
      </div>
    );
  }

  // ── Has travel — existing row pattern (avatar + summary + badge + chevron) ─
  return (
    <div>
      <button
        type="button"
        onClick={onToggleExpanded}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--color-bt-hover)]"
      >
        <UserAvatar name={member.displayName} avatarUrl={null} size="md" />

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>
            {member.displayName}{" "}
            <span className="text-xs font-normal" style={{ color: "var(--color-bt-text-dim)" }}>
              (you)
            </span>
          </p>
          <p className="truncate text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
            {summarizeTravel(member)}
          </p>
        </div>

        <TravelModeBadge mode={member.travel_mode as TravelMode | null} />

        <ChevronDown
          size={16}
          className="flex-shrink-0 transition-transform"
          style={{
            color: "var(--color-bt-text-dim)",
            transform: expanded ? "rotate(180deg)" : undefined,
          }}
        />
      </button>

      {/* Expand panel */}
      {expanded && (
        <div
          className="border-t px-4 pb-4 pt-3"
          style={{ borderColor: "var(--color-bt-border)" }}
        >
          <TravelExpandForm tripId={tripId} member={member} onSaved={onSaved} onCancel={onToggleExpanded} />
        </div>
      )}
    </div>
  );
}

// ── TravelExpandForm ──────────────────────────────────────────────────────

function TravelExpandForm({
  tripId,
  member,
  onSaved,
  onCancel,
}: {
  tripId: string;
  member: TripMemberLite;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<TravelMode>(
    (member.travel_mode as TravelMode) ?? "driving",
  );
  // Details is the single free-text field for driving/other OR flight airline/number for flying.
  const [details, setDetails] = useState(() =>
    member.travel_mode === "flying"
      ? [member.flight_airline, member.flight_number].filter(Boolean).join(" ")
      : member.travel_detail ?? "",
  );
  // Arrival is free text for both — "Sep 10 · 3:00 PM" per the spec.
  const [arrival, setArrival] = useState(() =>
    member.travel_mode === "flying"
      ? member.flight_arrival_time ?? ""
      : member.travel_detail ?? "",
  );

  const updateTravel = trpc.tripMembers.updateTravel.useMutation({
    onSuccess: onSaved,
  });

  const handleSave = () => {
    if (mode === "flying") {
      updateTravel.mutate({
        tripId,
        travelMode: mode,
        travelDetail: null,
        flightAirline: details.trim() || null,
        flightNumber: null,
        flightArrivalTime: arrival.trim() || null,
        flightAirport: null,
        travelShared: true,
      });
    } else {
      // Driving / other — stash details and arrival in travel_detail as a
      // combined blob. This stays compatible with TravelPanel's existing
      // "{travel_detail}" summary rendering.
      const combined = [details.trim(), arrival.trim()].filter(Boolean).join(" · ");
      updateTravel.mutate({
        tripId,
        travelMode: mode,
        travelDetail: combined || null,
        flightAirline: null,
        flightNumber: null,
        flightArrivalTime: null,
        flightAirport: null,
        travelShared: true,
      });
    }
  };

  return (
    <div className="space-y-3">
      {/* Mode segmented control */}
      <div
        className="flex rounded-xl p-1"
        style={{ background: "var(--color-bt-card-raised)", border: "1px solid var(--color-bt-border)" }}
      >
        {(
          [
            { value: "driving", label: "Driving", Icon: Car },
            { value: "flying", label: "Flying", Icon: Plane },
            { value: "other", label: "Other", Icon: HelpCircle },
          ] as const
        ).map(({ value, label, Icon }) => {
          const active = mode === value;
          return (
            <button
              key={value}
              type="button"
              onClick={() => setMode(value)}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold"
              style={
                active
                  ? {
                      background: "var(--color-bt-card)",
                      color: "var(--color-bt-text)",
                      boxShadow: "var(--shadow-card)",
                    }
                  : { background: "transparent", color: "var(--color-bt-text-dim)" }
              }
            >
              <Icon size={12} />
              {label}
            </button>
          );
        })}
      </div>

      {/* Fields row */}
      <div className="flex flex-wrap items-end gap-2">
        <div style={{ flex: "1.2 1 180px" }}>
          <label
            className="mb-1 block text-[10px] font-bold uppercase tracking-wider"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            {mode === "flying" ? "Flight" : "Details"}
          </label>
          <input
            type="text"
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            placeholder={mode === "flying" ? "e.g. Delta 1733" : "e.g. driving from Charlotte"}
            className="w-full rounded-lg border px-2.5 py-1.5 text-sm outline-none"
            style={{
              background: "var(--color-bt-base)",
              borderColor: "var(--color-bt-border)",
              color: "var(--color-bt-text)",
            }}
          />
        </div>
        <div style={{ flex: "1 1 140px" }}>
          <label
            className="mb-1 block text-[10px] font-bold uppercase tracking-wider"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            Arriving
          </label>
          <input
            type="text"
            value={arrival}
            onChange={(e) => setArrival(e.target.value)}
            placeholder="Sep 10 · 3:00 PM"
            className="w-full rounded-lg border px-2.5 py-1.5 text-sm outline-none"
            style={{
              background: "var(--color-bt-base)",
              borderColor: "var(--color-bt-border)",
              color: "var(--color-bt-text)",
            }}
          />
        </div>
        <button
          type="button"
          onClick={onCancel}
          disabled={updateTravel.isPending}
          className="flex-shrink-0 rounded-lg border px-3 py-2 text-xs disabled:opacity-40"
          style={{
            borderColor: "var(--color-bt-border)",
            color: "var(--color-bt-text-dim)",
            background: "transparent",
            whiteSpace: "nowrap",
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={updateTravel.isPending}
          className="flex-shrink-0 rounded-lg px-4 py-2 text-xs font-bold disabled:opacity-40"
          style={{
            background: "var(--color-bt-accent)",
            color: "var(--color-bt-base)",
            whiteSpace: "nowrap",
          }}
        >
          {updateTravel.isPending ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

// ── TravelModeBadge ───────────────────────────────────────────────────────

function TravelModeBadge({ mode }: { mode: TravelMode | null }) {
  if (!mode) return null;
  const style: React.CSSProperties = {};
  let label: string;
  let Icon: LucideIcon;
  if (mode === "flying") {
    style.background = "var(--color-bt-accent-faint)";
    style.color = "var(--color-bt-accent)";
    style.border = "1px solid var(--color-bt-accent-border)";
    label = "Flying";
    Icon = Plane;
  } else if (mode === "driving") {
    style.background = "var(--color-bt-warning-faint)";
    style.color = "var(--color-bt-warning)";
    style.border = "1px solid var(--color-bt-warning-border)";
    label = "Driving";
    Icon = Car;
  } else {
    style.background = "var(--color-bt-card-raised)";
    style.color = "var(--color-bt-text-dim)";
    style.border = "1px solid var(--color-bt-border)";
    label = "Other";
    Icon = HelpCircle;
  }
  return (
    <span
      className="flex flex-shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
      style={style}
    >
      <Icon size={10} />
      {label}
    </span>
  );
}

// ── PendingTravelRow ──────────────────────────────────────────────────────

function PendingTravelRow({ members }: { members: TripMemberLite[] }) {
  const pending = members.filter((m) => !m.travel_mode);
  if (pending.length === 0) return null;

  const visible = pending.slice(0, 3);
  const extra = pending.length - visible.length;

  return (
    <div
      className="flex items-center justify-between gap-3 border-t px-4 py-2.5"
      style={{
        background: "color-mix(in srgb, var(--color-bt-text-dim) 4%, transparent)",
        borderColor: "var(--color-bt-border)",
      }}
    >
      <p className="text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
        <span style={{ color: "var(--color-bt-text)", fontWeight: 600 }}>
          {pending.length}
        </span>{" "}
        haven&apos;t shared travel plans
      </p>
      <div className="flex items-center">
        {visible.map((m, i) => (
          <span
            key={m.memberId}
            className="flex h-[18px] w-[18px] items-center justify-center overflow-hidden rounded-full"
            style={{
              background: "var(--color-bt-card-raised)",
              border: "1px solid var(--color-bt-card)",
              color: "var(--color-bt-text-dim)",
              marginLeft: i === 0 ? 0 : -4,
              fontSize: 9,
              fontWeight: 600,
            }}
            aria-hidden
          >
            {initials(m.displayName)}
          </span>
        ))}
        {extra > 0 && (
          <span
            className="flex h-[18px] items-center justify-center rounded-full px-1.5 text-[9px] font-bold"
            style={{
              background: "var(--color-bt-card-raised)",
              border: "1px solid var(--color-bt-card)",
              color: "var(--color-bt-text-dim)",
              marginLeft: -4,
            }}
          >
            +{extra}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────

function summarizeTravel(m: TripMemberLite): string {
  if (m.travel_mode === "flying") {
    const parts = [
      m.flight_airline,
      m.flight_number,
      m.flight_arrival_time && `arriving ${m.flight_arrival_time}`,
    ].filter(Boolean);
    return parts.length ? parts.join(" · ") : "Flying";
  }
  if (m.travel_detail) return m.travel_detail;
  return m.travel_mode === "driving" ? "Driving" : "Other";
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0][0]!.toUpperCase();
  return (words[0][0]! + words[1][0]!).toUpperCase();
}

