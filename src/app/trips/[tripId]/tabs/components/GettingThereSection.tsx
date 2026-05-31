"use client";

import { useState } from "react";
import {
  AlertTriangle,
  Car,
  ChevronDown,
  Eye,
  EyeOff,
  Ghost,
  HelpCircle,
  Plane,
  Plus,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { Avatar } from "@/components/Avatar";

type TravelMode = "driving" | "flying" | "other";
type TravelFilterKey = "all" | "driving" | "flying" | "other";

interface TripMemberLite {
  memberId: string;
  user_id: string | null;
  displayName: string;
  isGuest?: boolean;
  user?: { avatar_icon?: string | null } | null;
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
  /** When provided (owner only), shows an X on the empty-state mock-up
      that backs out of the activation entirely. */
  onCancel?: () => void;
}

// ── TravelFilterPill ──────────────────────────────────────────────────────
// Same shape as ItineraryView's FilterPill — tones match TravelModeBadge.

const TRAVEL_PILL_TONES: Record<TravelFilterKey, { bg: string; color: string; border: string }> = {
  all: {
    bg: "var(--color-bt-accent-faint)",
    color: "var(--color-bt-accent)",
    border: "var(--color-bt-accent-border)",
  },
  driving: {
    bg: "var(--color-bt-warning-faint)",
    color: "var(--color-bt-warning)",
    border: "var(--color-bt-warning-border)",
  },
  flying: {
    bg: "var(--color-bt-accent-faint)",
    color: "var(--color-bt-accent)",
    border: "var(--color-bt-accent-border)",
  },
  other: {
    bg: "var(--color-bt-blue-bg)",
    color: "var(--color-bt-planning)",
    border: "var(--color-bt-planning-border)",
  },
};

function TravelFilterPill({
  label,
  filterKey,
  active,
  onClick,
}: {
  label: string;
  filterKey: TravelFilterKey;
  active: boolean;
  onClick: () => void;
}) {
  const cfg = TRAVEL_PILL_TONES[filterKey];
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full px-3 py-1.5 text-xs font-semibold"
      style={
        active
          ? { background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}` }
          : { background: "var(--color-bt-card-raised)", color: "var(--color-bt-text-dim)", border: "1px solid var(--color-bt-border)" }
      }
    >
      {label}
    </button>
  );
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
export function GettingThereSection({ tripId, isOwner, onCancel }: GettingThereSectionProps) {
  const utils = trpc.useUtils();
  const currentUser = useCurrentUser();
  const { data: members = [] } = trpc.tripMembers.list.useQuery({ tripId });
  // Trip query is cached from the parent page — use it to flag arrival
  // dates that fall before the trip starts.
  const { data: trip } = trpc.trips.getById.useQuery({ tripId });
  const tripStartDate = trip?.start_date ?? null;

  // Visibility toggle — owner controls whether non-owners see this panel.
  // Defaults to true (visible) when the column hasn't been set.
  const crewVisible = (trip as { travel_plans_crew_visible?: boolean | null } | undefined)
    ?.travel_plans_crew_visible !== false;
  const setTravelPlansVisible = trpc.trips.setTravelPlansVisible.useMutation({
    onSuccess: () => utils.trips.getById.invalidate({ tripId }),
  });

  const myMember = (members as TripMemberLite[]).find(
    (m) => m.user_id === currentUser?.id,
  );
  // All crew except the viewer — shown to the owner (expandable) or as
  // read-only rows for non-owners who've shared their travel.
  const allOtherMembers = (members as TripMemberLite[]).filter(
    (m) => m.user_id !== currentUser?.id,
  );
  // Non-owner view: all members (including guests) who've confirmed travel.
  const sharedOthers = allOtherMembers.filter((m) => !!m.travel_mode);
  // Pending tally counts only real (non-guest) members — guests can't share their own.
  const realOtherMembers = allOtherMembers.filter((m) => !m.isGuest);

  // All hooks must be called before any early return (rules-of-hooks).
  // Always start collapsed — the user opens the row deliberately by
  // tapping. Auto-expanding when empty was visually noisy.
  const [expanded, setExpanded] = useState(false);
  // "No travel yet" section starts collapsed in owner view.
  const [pendingOpen, setPendingOpen] = useState(false);
  // Filter pills — radio (single-select): clicking the active pill resets to All.
  const [activeFilter, setActiveFilter] = useState<TravelFilterKey>("all");

  // Non-owners are locked out entirely when the owner has hidden this panel.
  if (!isOwner && !crewVisible) return null;

  // Owner view: split other members by whether travel is confirmed.
  const confirmedOthers = allOtherMembers.filter((m) => !!m.travel_mode);
  const pendingOthers = allOtherMembers.filter((m) => !m.travel_mode);

  const myHasTravel = !!myMember?.travel_mode;
  // All members with travel (me + others) sorted by arrival time together.
  // Members with no arrival time sort last.
  const sortedWithTravel: TripMemberLite[] = [
    ...(myHasTravel && myMember ? [myMember] : []),
    ...(isOwner ? confirmedOthers : sharedOthers),
  ].sort(byArrivalTime);

  const toggleFilter = (key: TravelFilterKey) => {
    setActiveFilter((prev) => (prev === key ? "all" : key));
  };

  const matchesFilter = (mode: string | null | undefined) =>
    activeFilter === "all" || mode === activeFilter;

  const hasMyTravel = !!myMember?.travel_mode;
  // Empty-state mock-up only shows when nobody on the trip has shared
  // travel yet. As soon as anyone shares (the viewer or another crew
  // member), real rows take its place.
  const anyoneElseShared = allOtherMembers.some((m) => !!m.travel_mode);
  const someoneShared = hasMyTravel || anyoneElseShared;
  const showEmptyState = !!myMember && !someoneShared && !expanded;

  // Only show pills once there are multiple distinct modes in use.
  const allConfirmedMembers = [
    ...(myMember?.travel_mode ? [myMember] : []),
    ...confirmedOthers,
  ];
  const modesInUse = new Set(allConfirmedMembers.map((m) => m.travel_mode));
  const showFilterPills = !showEmptyState && modesInUse.size > 1;

  // ── Render ──────────────────────────────────────────────────────────────
  // GETTING THERE header sits OUTSIDE the rows card so the card always
  // reads as content under a labelled section, not a floating panel of
  // text. Header hides only when the empty-state mock-up is showing —
  // the dashed mock-up carries its own identity.
  return (
    // flex+h-full chain lets the empty-state mock-up stretch to match the
    // height of the Itinerary panel when both are rendered in the home-tab
    // 2-column grid. h-full collapses harmlessly to auto in single-column
    // contexts where the parent has no defined height.
    <div className="flex h-full flex-col space-y-3" data-testid="getting-there-section">
      {!showEmptyState && (
        <div className="flex items-center justify-between">
          <h2
            className="text-xs font-semibold uppercase tracking-wider"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            Travel Plans
          </h2>
          {isOwner && (
            <button
              type="button"
              onClick={() =>
                setTravelPlansVisible.mutate({ tripId, visible: !crewVisible })
              }
              disabled={setTravelPlansVisible.isPending}
              className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider disabled:opacity-40 transition-colors"
              style={{ color: crewVisible ? "var(--color-bt-text-dim)" : "var(--color-bt-warning)" }}
            >
              {crewVisible ? <Eye size={11} /> : <EyeOff size={11} />}
              {crewVisible ? "Visible to crew" : "Hidden from crew"}
            </button>
          )}
        </div>
      )}

      {showEmptyState && (
        <EmptyArrivalsState
          onCancel={onCancel}
          onAdd={() => setExpanded(true)}
        />
      )}

      {showFilterPills && (
        <div className="flex flex-wrap items-center gap-2">
          <TravelFilterPill label="All"     filterKey="all"     active={activeFilter === "all"}     onClick={() => toggleFilter("all")} />
          {modesInUse.has("driving") && <TravelFilterPill label="Driving" filterKey="driving" active={activeFilter === "driving"} onClick={() => toggleFilter("driving")} />}
          {modesInUse.has("flying")  && <TravelFilterPill label="Flying"  filterKey="flying"  active={activeFilter === "flying"}  onClick={() => toggleFilter("flying")} />}
          {modesInUse.has("other")   && <TravelFilterPill label="Other"   filterKey="other"   active={activeFilter === "other"}   onClick={() => toggleFilter("other")} />}
        </div>
      )}

      {!showEmptyState && (() => {
        // "Add travel" row: shown when I have no travel, at the top since it's
        // an action prompt (position irrelevant — no arrival time to sort by).
        const addTravelShown =
          !!myMember && !myHasTravel && matchesFilter(myMember.travel_mode);

        // Filtered sorted list of everyone with travel.
        const filteredWithTravel = sortedWithTravel.filter((m) =>
          matchesFilter(m.travel_mode),
        );

        return (
          <div
            className="overflow-hidden rounded-xl"
            style={{
              background: "var(--color-bt-card)",
              border: "1px solid var(--color-bt-border)",
            }}
          >
            {/* "Add travel" button — only when I haven't shared yet */}
            {addTravelShown && (
              <YourTravelRow
                tripId={tripId}
                member={myMember!}
                tripStartDate={tripStartDate}
                expanded={expanded}
                onToggleExpanded={() => setExpanded((v) => !v)}
                onSaved={() => {
                  utils.tripMembers.list.invalidate({ tripId });
                  setExpanded(false);
                }}
                highlighted
              />
            )}

            {/* All members with travel, sorted by arrival — me included */}
            {filteredWithTravel.map((m, i) => {
              const isMe = m.memberId === myMember?.memberId;
              // Show border-t when something is rendered above this row.
              const showBorderTop = addTravelShown || i > 0;

              if (isMe) {
                return (
                  <YourTravelRow
                    key={m.memberId}
                    tripId={tripId}
                    member={myMember!}
                    tripStartDate={tripStartDate}
                    expanded={expanded}
                    onToggleExpanded={() => setExpanded((v) => !v)}
                    onSaved={() => {
                      utils.tripMembers.list.invalidate({ tripId });
                      setExpanded(false);
                    }}
                    showBorderTop={showBorderTop}
                    highlighted
                  />
                );
              }

              if (isOwner) {
                return (
                  <OtherMemberTravelRow
                    key={m.memberId}
                    tripId={tripId}
                    member={m}
                    tripStartDate={tripStartDate}
                    onSaved={() => utils.tripMembers.list.invalidate({ tripId })}
                    showBorderTop={showBorderTop}
                  />
                );
              }

              return (
                <CrewTravelRow
                  key={m.memberId}
                  member={m}
                  showBorderTop={showBorderTop}
                />
              );
            })}

            {/* Owner: collapsible "no travel yet" section */}
            {isOwner && pendingOthers.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => setPendingOpen((v) => !v)}
                  className="flex w-full items-center gap-3 border-t px-4 py-3 text-left transition-colors hover:bg-[var(--color-bt-hover)]"
                  style={{ borderColor: "var(--color-bt-border)" }}
                >
                  <span
                    className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold"
                    style={{
                      background: "var(--color-bt-card-raised)",
                      color: "var(--color-bt-text-dim)",
                      border: "1px solid var(--color-bt-border)",
                    }}
                  >
                    {pendingOthers.length}
                  </span>
                  <span className="flex-1 text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
                    {pendingOthers.length === 1 ? "hasn't" : "haven't"} confirmed their travel plans
                  </span>
                  <ChevronDown
                    size={14}
                    style={{
                      color: "var(--color-bt-text-dim)",
                      transform: pendingOpen ? "rotate(180deg)" : "rotate(0deg)",
                      transition: "transform 150ms",
                      flexShrink: 0,
                    }}
                  />
                </button>
                {pendingOpen && pendingOthers.map((m) => (
                  <OtherMemberTravelRow
                    key={m.memberId}
                    tripId={tripId}
                    member={m}
                    tripStartDate={tripStartDate}
                    onSaved={() => utils.tripMembers.list.invalidate({ tripId })}
                    showBorderTop
                  />
                ))}
              </>
            )}

            {!isOwner && <PendingTravelRow members={realOtherMembers} />}
          </div>
        );
      })()}
    </div>
  );
}

// ── CrewTravelRow ─────────────────────────────────────────────────────────
// Read-only row for any crew member (other than the viewer) who has shared
// their travel info. Same shape as YourTravelRow's "has travel" branch but
// without the chevron / expand affordance.

function CrewTravelRow({ member, showBorderTop = true }: { member: TripMemberLite; showBorderTop?: boolean }) {
  const avatar = member.isGuest ? (
    <div
      className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full"
      style={{ background: "var(--color-bt-border)", color: "var(--color-bt-text-dim)" }}
    >
      <Ghost size={14} />
    </div>
  ) : (
    <Avatar name={member.displayName} avatarIcon={member.user?.avatar_icon ?? null} size="md" />
  );

  return (
    <div
      className="flex w-full items-center gap-3 px-4 py-3"
      style={showBorderTop ? { borderTop: "1px solid var(--color-bt-border)" } : {}}
    >
      {avatar}

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>
          {member.displayName}
        </p>
        <p className="truncate text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
          {summarizeTravel(member)}
        </p>
        {arrivalLine(member) && (
          <p className="truncate text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
            {arrivalLine(member)}
          </p>
        )}
      </div>

      <TravelModeBadge mode={member.travel_mode as TravelMode | null} />
    </div>
  );
}

// ── OtherMemberTravelRow ──────────────────────────────────────────────────
// Owner-expandable row for every other crew member (real and ghost alike).
// Same expand/collapse pattern as YourTravelRow but uses updateMemberTravel.
// Ghost members get a Ghost avatar; real members get their profile Avatar.

function OtherMemberTravelRow({
  tripId,
  member: m,
  tripStartDate,
  onSaved,
  showBorderTop = true,
}: {
  tripId: string;
  member: TripMemberLite;
  tripStartDate: string | null;
  onSaved: () => void;
  showBorderTop?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasTravel = !!m.travel_mode;

  const avatar = m.isGuest ? (
    <div
      className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full"
      style={{ background: "var(--color-bt-border)", color: "var(--color-bt-text-dim)" }}
    >
      <Ghost size={14} />
    </div>
  ) : (
    <Avatar name={m.displayName} avatarIcon={m.user?.avatar_icon ?? null} size="md" />
  );

  const borderStyle: React.CSSProperties = showBorderTop
    ? { borderTop: "1px solid var(--color-bt-border)" }
    : {};

  if (!hasTravel) {
    return (
      <div className="px-4 py-3" style={borderStyle}>
        {expanded ? (
          <TravelExpandForm
            tripId={tripId}
            member={m}
            tripStartDate={tripStartDate}
            targetUserId={m.user_id ?? undefined}
            onSaved={() => { onSaved(); setExpanded(false); }}
            onCancel={() => setExpanded(false)}
          />
        ) : (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="flex w-full items-center gap-3 text-left"
          >
            {avatar}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>
                {m.displayName}
              </p>
              <p className="truncate text-xs italic" style={{ color: "var(--color-bt-text-dim)" }}>
                No travel info yet — tap to add
              </p>
            </div>
            <Plus size={14} style={{ color: "var(--color-bt-text-dim)", flexShrink: 0 }} />
          </button>
        )}
      </div>
    );
  }

  // Has travel — same collapsible row pattern as YourTravelRow
  return (
    <div style={borderStyle}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--color-bt-hover)]"
      >
        {avatar}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>
            {m.displayName}
          </p>
          <p className="truncate text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
            {summarizeTravel(m)}
          </p>
          {arrivalLine(m) && (
            <p className="truncate text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
              {arrivalLine(m)}
            </p>
          )}
        </div>
        <TravelModeBadge mode={m.travel_mode as TravelMode | null} />
        <ChevronDown
          size={16}
          className="flex-shrink-0 transition-transform"
          style={{
            color: "var(--color-bt-text-dim)",
            transform: expanded ? "rotate(180deg)" : undefined,
          }}
        />
      </button>
      {expanded && (
        <div className="border-t px-4 pb-4 pt-3" style={{ borderColor: "var(--color-bt-border)" }}>
          <TravelExpandForm
            tripId={tripId}
            member={m}
            tripStartDate={tripStartDate}
            targetUserId={m.user_id ?? undefined}
            onSaved={() => { onSaved(); setExpanded(false); }}
            onCancel={() => setExpanded(false)}
          />
        </div>
      )}
    </div>
  );
}

// ── EmptyArrivalsState ───────────────────────────────────────────────────
// Shown inside the GettingThere panel when the user hasn't shared their
// travel yet. Same shape as the Itinerary panel empty state: dashed card
// + centered icon/heading/description + faded skeleton preview of what
// populated arrival rows will look like.

function EmptyArrivalsState({
  onCancel,
  onAdd,
}: {
  onCancel?: () => void;
  /** Opens the inline travel form so the viewer can share their plans —
      without this the empty state is a dead end with no add affordance. */
  onAdd: () => void;
}) {
  return (
    // flex-1 = grow to fill the section's h-full container so the dashed
    // box matches the height of the Itinerary panel's empty state when
    // they're side-by-side. Extra height shows up as empty space BELOW
    // the mock content, inside the dashed border.
    <div
      className="relative flex flex-1 flex-col rounded-xl p-4"
      style={{
        background: "var(--color-bt-base)",
        border: "1px dashed var(--color-bt-border)",
      }}
    >
      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancel Getting There"
          data-testid="getting-there-empty-cancel"
          className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-bt-hover)]"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          <X size={14} />
        </button>
      )}
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
        <button
          type="button"
          onClick={onAdd}
          className="mt-4 flex items-center justify-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold transition-opacity hover:opacity-90"
          style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
        >
          <Plus size={15} /> Add your travel
        </button>
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
        className="flex flex-shrink-0 items-center justify-center rounded-full p-1.5"
        style={badgeStyle}
      >
        <Icon size={11} />
      </span>
    </div>
  );
}

// ── YourTravelRow ─────────────────────────────────────────────────────────

function YourTravelRow({
  tripId,
  member,
  tripStartDate,
  expanded,
  onToggleExpanded,
  onSaved,
  showBorderTop = false,
  highlighted = false,
}: {
  tripId: string;
  member: TripMemberLite;
  tripStartDate: string | null;
  expanded: boolean;
  onToggleExpanded: () => void;
  onSaved: () => void;
  /** Add a top border (when something is rendered above this row in the card). */
  showBorderTop?: boolean;
  /** Subtle background tint to distinguish the viewer's own row. */
  highlighted?: boolean;
}) {
  const hasTravel = !!member.travel_mode;
  const highlightStyle: React.CSSProperties = highlighted
    ? { background: "var(--color-bt-card-raised)" }
    : {};
  const borderStyle: React.CSSProperties = showBorderTop
    ? { borderTop: "1px solid var(--color-bt-border)" }
    : {};

  // ── No travel info yet — Pattern 1 add button + optional inline form ──
  // Matches Schedule "Item", Lodging "Property", Receipts "Receipt", Crew
  // "Crew member" so add-affordances are consistent across the trip.
  if (!hasTravel) {
    return (
      <div className="px-4 py-3" style={{ ...borderStyle, ...highlightStyle }}>
        {expanded ? (
          <TravelExpandForm tripId={tripId} member={member} tripStartDate={tripStartDate} onSaved={onSaved} onCancel={onToggleExpanded} />
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
    <div style={{ ...borderStyle, ...highlightStyle }}>
      <button
        type="button"
        onClick={onToggleExpanded}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--color-bt-hover)]"
      >
        <Avatar name={member.displayName} avatarIcon={member.user?.avatar_icon ?? null} size="md" />

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
          {arrivalLine(member) && (
            <p className="truncate text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
              {arrivalLine(member)}
            </p>
          )}
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
          <TravelExpandForm tripId={tripId} member={member} tripStartDate={tripStartDate} onSaved={onSaved} onCancel={onToggleExpanded} />
        </div>
      )}
    </div>
  );
}

// ── TravelExpandForm ──────────────────────────────────────────────────────

function TravelExpandForm({
  tripId,
  member,
  tripStartDate,
  targetUserId,
  onSaved,
  onCancel,
}: {
  tripId: string;
  member: TripMemberLite;
  tripStartDate: string | null;
  /** When set, the owner is editing on behalf of another member.
   *  Uses updateMemberTravel instead of updateTravel. */
  targetUserId?: string;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<TravelMode>(
    (member.travel_mode as TravelMode) ?? "driving",
  );
  // Details: flight airline/number for flying, route description for non-flying.
  const [details, setDetails] = useState(() =>
    member.travel_mode === "flying"
      ? [member.flight_airline, member.flight_number].filter(Boolean).join(" ")
      : member.travel_detail ?? "",
  );
  // Arrival: a real date + time pair produces an ISO timestamp the itinerary
  // can parse. Used across all modes — driving/other arrivals weave into the
  // itinerary too, not just flights.
  const [arrivalDate, setArrivalDate] = useState(() =>
    parseArrivalDate(member.flight_arrival_time),
  );
  const [arrivalTime, setArrivalTime] = useState(() =>
    parseArrivalTime(member.flight_arrival_time),
  );

  // Both mutations are always called (React hook rules). Only one fires per save.
  const updateTravel = trpc.tripMembers.updateTravel.useMutation({ onSuccess: onSaved });
  const updateMemberTravel = trpc.tripMembers.updateMemberTravel.useMutation({ onSuccess: onSaved });

  const isPending = targetUserId ? updateMemberTravel.isPending : updateTravel.isPending;

  const handleSave = () => {
    // Combine arrival date + time into a local ISO timestamp (no TZ
    // suffix; the server stores it as-is and the itinerary builder
    // parses it via new Date(...), which honours the user's TZ).
    let arrivalISO: string | null = null;
    if (arrivalDate) {
      arrivalISO = arrivalTime
        ? `${arrivalDate}T${arrivalTime}:00`
        : `${arrivalDate}T00:00:00`;
    }

    const flightAirline = mode === "flying" ? details.trim() || null : null;
    const travelDetail = mode !== "flying" ? details.trim() || null : null;

    if (targetUserId) {
      updateMemberTravel.mutate({
        tripId,
        targetUserId,
        travelMode: mode,
        travelDetail,
        flightAirline,
        flightNumber: null,
        flightArrivalTime: arrivalISO,
        flightAirport: null,
      });
    } else if (mode === "flying") {
      updateTravel.mutate({
        tripId,
        travelMode: mode,
        travelDetail: null,
        flightAirline,
        flightNumber: null,
        flightArrivalTime: arrivalISO,
        flightAirport: null,
        travelShared: true,
      });
    } else {
      // Driving / other — details (e.g., "driving from Charlotte") goes
      // into travel_detail; the arrival timestamp goes into
      // flight_arrival_time so it shows up on the itinerary.
      updateTravel.mutate({
        tripId,
        travelMode: mode,
        travelDetail,
        flightAirline: null,
        flightNumber: null,
        flightArrivalTime: arrivalISO,
        flightAirport: null,
        travelShared: true,
      });
    }
  };

  // Subtle heads-up when the entered arrival is before the trip starts
  // (typo, wrong year, etc.). Just a small inline note — not blocking.
  const arrivalBeforeTrip =
    !!arrivalDate && !!tripStartDate && arrivalDate < tripStartDate;

  return (
    <div className="space-y-3">
      {arrivalBeforeTrip && (
        <div
          className="flex items-center gap-3 rounded-xl px-4 py-3"
          style={{
            background: "var(--color-bt-card)",
            border: "1px solid var(--color-bt-border)",
          }}
        >
          <span
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg"
            style={{ background: "var(--color-bt-warning-faint)", color: "var(--color-bt-warning)" }}
          >
            <AlertTriangle size={14} />
          </span>
          <div>
            <p
              className="text-[13px] font-semibold leading-tight"
              style={{ color: "var(--color-bt-text)" }}
            >
              Arrival is before the trip starts
            </p>
            <p
              className="mt-0.5 text-[11px] leading-snug"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              Double-check the month and day, or update the trip dates if entered wrong
            </p>
          </div>
        </div>
      )}

      {/* Mode segmented control — content-width pill, left-aligned. */}
      <div
        className="inline-flex rounded-xl p-1"
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
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold"
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
        <div style={{ flex: "1 1 130px" }}>
          <label
            className="mb-1 block text-[10px] font-bold uppercase tracking-wider"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            Arriving
          </label>
          <input
            type="date"
            value={arrivalDate}
            onChange={(e) => setArrivalDate(e.target.value)}
            className="w-full rounded-lg border px-2.5 py-1.5 text-sm outline-none"
            style={{
              background: "var(--color-bt-base)",
              borderColor: "var(--color-bt-border)",
              color: "var(--color-bt-text)",
              colorScheme: "dark",
            }}
          />
        </div>
        <div style={{ flex: "1 1 100px" }}>
          <label
            className="mb-1 block text-[10px] font-bold uppercase tracking-wider"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            Time
          </label>
          <input
            type="time"
            value={arrivalTime}
            onChange={(e) => setArrivalTime(e.target.value)}
            className="w-full rounded-lg border px-2.5 py-1.5 text-sm outline-none"
            style={{
              background: "var(--color-bt-base)",
              borderColor: "var(--color-bt-border)",
              color: "var(--color-bt-text)",
              colorScheme: "dark",
            }}
          />
        </div>
        <button
          type="button"
          onClick={onCancel}
          disabled={isPending}
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
          disabled={isPending}
          className="flex-shrink-0 rounded-lg px-4 py-2 text-xs font-bold disabled:opacity-40"
          style={{
            background: "var(--color-bt-accent)",
            color: "var(--color-bt-base)",
            whiteSpace: "nowrap",
          }}
        >
          {isPending ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

// ── TravelModeBadge ───────────────────────────────────────────────────────

function TravelModeBadge({ mode }: { mode: TravelMode | null }) {
  if (!mode) return null;
  const style: React.CSSProperties = {};
  let Icon: LucideIcon;
  if (mode === "flying") {
    style.background = "var(--color-bt-accent-faint)";
    style.color = "var(--color-bt-accent)";
    style.border = "1px solid var(--color-bt-accent-border)";
    Icon = Plane;
  } else if (mode === "driving") {
    style.background = "var(--color-bt-warning-faint)";
    style.color = "var(--color-bt-warning)";
    style.border = "1px solid var(--color-bt-warning-border)";
    Icon = Car;
  } else {
    style.background = "var(--color-bt-blue-bg)";
    style.color = "var(--color-bt-planning)";
    style.border = "1px solid var(--color-bt-planning-border)";
    Icon = HelpCircle;
  }
  return (
    <span
      className="flex flex-shrink-0 items-center justify-center rounded-full p-1.5"
      style={style}
    >
      <Icon size={12} />
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

/** Sort travel members by arrival time ascending; members without an arrival
 *  time sort to the end. */
function byArrivalTime(a: TripMemberLite, b: TripMemberLite): number {
  const at = a.flight_arrival_time;
  const bt = b.flight_arrival_time;
  if (!at && !bt) return 0;
  if (!at) return 1;
  if (!bt) return -1;
  return at < bt ? -1 : at > bt ? 1 : 0;
}

/** Main detail line — flight info or travel description, no arrival time. */
function summarizeTravel(m: TripMemberLite): string {
  if (m.travel_mode === "flying") {
    const parts = [m.flight_airline, m.flight_number].filter(Boolean);
    return parts.length ? parts.join(" ") : "Flying";
  }
  // Driving / other
  if (m.travel_detail) return m.travel_detail;
  return m.travel_mode === "driving" ? "Driving" : "Other";
}

/** Arrival line — "Arriving Sep 10 · 3:00 PM" or null if no arrival set. */
function arrivalLine(m: TripMemberLite): string | null {
  const label = formatArrivalLabel(m.flight_arrival_time);
  return label ? `Arriving ${label}` : null;
}

/** Render an ISO timestamp as "Sep 10 · 3:00 PM" — empty string if invalid. */
function formatArrivalLabel(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${date} · ${time}`;
}

/** Pull YYYY-MM-DD out of an ISO timestamp in local time. */
function parseArrivalDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-CA");
}

/** Pull HH:MM out of an ISO timestamp in local time. */
function parseArrivalTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0][0]!.toUpperCase();
  return (words[0][0]! + words[1][0]!).toUpperCase();
}

