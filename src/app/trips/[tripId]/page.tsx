"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { MoreHorizontal, Lock } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { useTripRole } from "@/hooks/useTripRole";
import { TripBottomNav, type TabId } from "@/components/BottomNav";
import { TripTabBar } from "@/components/TripTabBar";
import { getTripStatus } from "@/components/StatusBadge";
import { TripHeader } from "@/components/TripHeader";
import { TripSettingsModal } from "@/components/TripSettingsModal";
import { TopNav } from "@/components/TopNav";
import { TripBreadcrumb } from "@/components/TripBreadcrumb";
import { HomeTab } from "./tabs/HomeTab";
import { ScheduleTab } from "./tabs/ScheduleTab";
import { CrewTab } from "./tabs/CrewTab";
import { CompTab } from "./tabs/CompTab";
import { ExpensesTab } from "./tabs/ExpensesTab";
import { formatDateRange } from "@/lib/dates";
import { isReadOnly as checkReadOnly, countdownLabel } from "@/lib/tripStatus";
import { useModalBackButton } from "@/hooks/useModalBackButton";
import { FloatingChatButton } from "./components/FloatingChatButton";
import { ChatDrawer } from "./components/ChatDrawer";

// ── TripDetailPage ────────────────────────────────────────────────────────

export default function TripDetailPage() {
  const { tripId } = useParams<{ tripId: string }>();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabId>("home");
  const [showSettings, setShowSettings] = useState(false);
  const [compUnlocked, setCompUnlocked] = useState(false);
  const [showAdvanceSheet, setShowAdvanceSheet] = useState<"going" | null>(null);
  const [toast, setToast] = useState<{ message: string; variant: "warning" } | null>(null);
  const [showChatDrawer, setShowChatDrawer] = useState(false);

  // ── Data ──────────────────────────────────────────────────────────────────
  const {
    data: trip,
    isLoading,
    error,
  } = trpc.trips.getById.useQuery({ tripId });

  const { role, isOwner, canEdit } = useTripRole(tripId);

  // ── Prefetch all HomeTab queries in parallel with the trip query ──────────
  // All of these only need tripId (available immediately from the URL), so
  // they fire on first render alongside trips.getById. We track their loading
  // states so the page waits for ALL data before rendering — no 2-phase pop-in.
  const { isLoading: ideasLoading } = trpc.ideas.list.useQuery({ tripId });
  const { isLoading: pollLoading } = trpc.datePoll.get.useQuery({ tripId });
  const { data: members = [], isLoading: membersLoading } = trpc.tripMembers.list.useQuery({ tripId });
  const { isLoading: reservationsLoading } = trpc.reservations.list.useQuery({ tripId });
  const { isLoading: tilesLoading } = trpc.quickInfoTiles.list.useQuery({ tripId });

  // Competition data: events only needs tripId; teams/scores need the eventId
  // which we grab from the trip object once it resolves (avoids a second round
  // trip by not waiting for events.getByTrip to return first).
  const { data: prefetchedEvent, isLoading: eventLoading } = trpc.events.getByTrip.useQuery({ tripId });
  const prefetchEventId = prefetchedEvent?.id ?? trip?.event_id ?? "";
  const { isLoading: teamsLoading } = trpc.teams.list.useQuery(
    { tripId, eventId: prefetchEventId },
    { enabled: !!prefetchEventId }
  );
  const { isLoading: scoresLoading } = trpc.groupResults.listScoresByEvent.useQuery(
    { tripId, eventId: prefetchEventId },
    { enabled: !!prefetchEventId }
  );

  // ── Prefetch sub-page queries so Messages/Leaderboard get cache hits ─────
  // These all need eventId, which we already have above.
  trpc.teamAssignments.list.useQuery(
    { tripId, eventId: prefetchEventId },
    { enabled: !!prefetchEventId }
  );
  trpc.rounds.list.useQuery(
    { tripId, eventId: prefetchEventId },
    { enabled: !!prefetchEventId }
  );
  trpc.playGroups.list.useQuery(
    { tripId, eventId: prefetchEventId },
    { enabled: !!prefetchEventId }
  );
  trpc.sideEvents.list.useQuery(
    { tripId, eventId: prefetchEventId },
    { enabled: !!prefetchEventId }
  );

  const dataLoading = isLoading || ideasLoading || pollLoading || membersLoading
    || reservationsLoading || tilesLoading || eventLoading || teamsLoading || scoresLoading;

  // All hooks must be called before any early returns
  const utils = trpc.useUtils();
  const lockDestination = trpc.trips.lockDestination.useMutation({
    onSuccess: () => {
      utils.trips.getById.invalidate({ tripId });
      utils.trips.list.invalidate();
    },
  });

  // ── Toast auto-dismiss ────────────────────────────────────────────────────
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  // ── Loading ───────────────────────────────────────────────────────────────
  // Wait for ALL queries (trip + home-tab data) before rendering so every
  // panel appears at once instead of popping in across two render batches.
  if (dataLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div
          className="h-8 w-8 animate-spin rounded-full border-2"
          style={{ borderColor: "var(--color-bt-accent)", borderTopColor: "transparent" }}
        />
      </div>
    );
  }

  if (error || !trip) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="text-center">
          <p className="text-lg font-semibold" style={{ color: "var(--color-bt-text)" }}>
            Trip not found
          </p>
          <button
            onClick={() => router.push("/dashboard")}
            className="mt-4 text-sm"
            style={{ color: "var(--color-bt-accent)" }}
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  const status = getTripStatus(trip);
  const tripIsReadOnly = checkReadOnly(trip);
  const stage = (trip as { stage?: string }).stage ?? "idea";
  // IDEA stage: IdeaZonePanel renders its own floating action buttons
  const showFloatingChat = stage === "planning" && activeTab === "home";
  // When exploring (comparison_mode=true, no lock), don't fall back to
  // trip.location — lockDestination writes to that column and unlockDestination
  // doesn't clear it, so the old destination would bleed through to the header.
  const destLocation = trip.locked_destination_location
    ?? (trip.comparison_mode ? null : trip.location);
  const showComp = !!trip.event_id || compUnlocked;
  const isLocked = !!trip.locked_destination_title;

  // Effective canEdit: forced false when read-only
  const effectiveCanEdit = tripIsReadOnly ? false : canEdit;

  const settingsButton = (canEdit && !tripIsReadOnly) ? (
    <button
      data-testid="trip-settings-btn"
      onClick={() => setShowSettings(true)}
      className="flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-bt-hover)]"
      style={{ color: "var(--color-bt-text-dim)" }}
      aria-label="Trip settings"
    >
      <MoreHorizontal size={18} />
    </button>
  ) : null;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      className="min-h-screen"
      style={{ background: "var(--color-bt-base)", color: "var(--color-bt-text)" }}
    >
      {/* ── Top nav + breadcrumb ──────────────────────────────────────────── */}
      <TopNav />
      <TripBreadcrumb
        tripId={tripId}
        tripTitle={trip.title}
        rightSlot={settingsButton}
      />

      {/* ── Trip header card ──────────────────────────────────────────────── */}
      <div className="mx-auto max-w-[1280px] px-4 pt-4">
        <TripHeader
          tripName={trip.title}
          status={status}
          stage={stage}
          countdownText={countdownLabel(trip)}
          location={destLocation}
          lockedTitle={trip.locked_destination_title}
          dateRange={formatDateRange(trip.start_date, trip.end_date)}
          isLocked={isLocked}
          canEdit={canEdit}
          myRole={role}
          isOwner={isOwner}
          tripStartDate={trip.start_date}
          onDestinationChange={(value) => {
            lockDestination.mutate({
              tripId: trip.id,
              title: value,
              location: value,
            });
          }}
          onDatesTap={() => setActiveTab("schedule")}
          onStepClick={(stepKey) => {
            if (stepKey === "going" && isOwner && stage === "planning") {
              setShowAdvanceSheet("going");
            }
          }}
        />

        {/* ── Tab bar (hidden in IDEA stage) ──────────────────────────── */}
        {stage !== "idea" && (
          <div className="mt-4">
            <TripTabBar
              activeTab={activeTab}
              onTabChange={(tab) => {
                if (stage === "planning" && tab === "expenses") {
                  setToast({ message: "Expenses are available once the trip moves to Ready.", variant: "warning" });
                  return;
                }
                setActiveTab(tab);
              }}
              showComp={showComp}
              canEdit={canEdit}
              stage={stage}
            />
          </div>
        )}
      </div>

      {/* ── Tab content ──────────────────────────────────────────────────── */}
      <main className={`mx-auto max-w-[1280px] pt-4 ${stage === "idea" || stage === "planning" ? "pb-6" : "pb-24"}`}>
        {/* Read-only banner */}
        {tripIsReadOnly && activeTab === "home" && (
          <div
            className="mx-4 mb-3 flex items-center gap-2 rounded-xl px-4 py-2.5"
            style={{ background: "var(--color-bt-card-raised)", border: "1px solid var(--color-bt-border)" }}
          >
            <Lock size={14} style={{ color: "var(--color-bt-text-dim)" }} />
            <span className="text-[13px]" style={{ color: "var(--color-bt-text-dim)" }}>
              This trip is read-only
            </span>
          </div>
        )}
        {activeTab === "home" && (
          <HomeTab
            trip={trip}
            role={role}
            canEdit={effectiveCanEdit}
            isOwner={isOwner}
            onTabChange={(tab) => setActiveTab(tab as TabId)}
            onEnableComp={effectiveCanEdit ? () => { setCompUnlocked(true); setActiveTab("comp"); } : undefined}
            onOpenChat={() => setShowChatDrawer(true)}
          />
        )}
        {activeTab === "schedule" && (
          <ScheduleTab trip={trip} role={role} canEdit={effectiveCanEdit} isOwner={tripIsReadOnly ? false : isOwner} />
        )}
        {activeTab === "crew" && (
          <CrewTab trip={trip} role={role} canEdit={effectiveCanEdit} isOwner={tripIsReadOnly ? false : isOwner} />
        )}
        {activeTab === "expenses" && (
          <ExpensesTab trip={trip} role={role} canEdit={effectiveCanEdit} isOwner={tripIsReadOnly ? false : isOwner} />
        )}
        {activeTab === "comp" && (
          <CompTab trip={trip} role={role} canEdit={effectiveCanEdit} isOwner={tripIsReadOnly ? false : isOwner} />
        )}
      </main>

      {/* ── Bottom navigation (READY+ stages only) ────────────────────────── */}
      {stage !== "idea" && stage !== "planning" && (
        <TripBottomNav tripId={tripId} eventId={trip.event_id} />
      )}

      {/* ── Settings modal ────────────────────────────────────────────────── */}
      {showSettings && role && (
        <TripSettingsModal
          tripId={tripId}
          tripName={trip.title}
          viewerRole={role}
          onClose={() => setShowSettings(false)}
        />
      )}

      {/* ── Stage advancement sheets ─────────────────────────────────────── */}
      {showAdvanceSheet === "going" && (
        <AdvanceToGoingSheet
          tripId={tripId}
          destination={trip.locked_destination_title ?? ""}
          dateRange={formatDateRange(trip.start_date, trip.end_date)}
          onClose={() => setShowAdvanceSheet(null)}
          onAdvanced={(ghosts) => {
            if (ghosts.length > 0) {
              setToast({
                message: `No email on file for: ${ghosts.join(", ")}. They won't receive the RSVP blast.`,
                variant: "warning",
              });
            }
          }}
        />
      )}

      {/* ── Floating chat button + drawer (IDEA/PLANNING mobile) ──────── */}
      {showFloatingChat && (
        <FloatingChatButton onClick={() => setShowChatDrawer(true)} />
      )}
      <ChatDrawer
        tripId={tripId}
        isOpen={showChatDrawer}
        onClose={() => setShowChatDrawer(false)}
        memberNames={Object.fromEntries(
          members.map((m: { user_id: string | null; memberId: string; displayName: string }) => [m.user_id ?? m.memberId, m.displayName])
        )}
      />

      {/* ── Toast notification ─────────────────────────────────────────── */}
      {toast && (
        <div
          className="fixed bottom-24 left-1/2 z-[100] w-full max-w-sm -translate-x-1/2 px-4"
          onClick={() => setToast(null)}
        >
          <div
            className="rounded-xl px-4 py-3 text-sm shadow-lg"
            style={{
              background: "rgba(217,119,6,0.1)",
              color: "var(--color-bt-warning)",
              border: "1px solid var(--color-bt-warning)",
            }}
          >
            {toast.message}
          </div>
        </div>
      )}
    </div>
  );
}

// ── AdvanceToGoingSheet ─────────────────────────────────────────────────

function AdvanceToGoingSheet({
  tripId,
  destination,
  dateRange,
  onClose,
  onAdvanced,
}: {
  tripId: string;
  destination: string;
  dateRange: string;
  onClose: () => void;
  onAdvanced: (ghostsWithoutEmail: string[]) => void;
}) {
  const [message, setMessage] = useState("");
  const utils = trpc.useUtils();

  // Check if a date is locked
  const { data: poll } = trpc.datePoll.get.useQuery({ tripId });
  const hasLockedDate = !!poll?.lockedWindowId;

  const advance = trpc.trips.advanceToGoing.useMutation({
    onSuccess(result) {
      utils.trips.getById.invalidate({ tripId });
      utils.trips.list.invalidate();
      onAdvanced(result.ghostsWithoutEmail ?? []);
      onClose();
    },
  });
  useModalBackButton(onClose);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center lg:items-center"
      style={{ background: "var(--color-bt-overlay)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-[560px] rounded-t-2xl p-6 lg:rounded-2xl"
        style={{ background: "var(--color-bt-card)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold" style={{ color: "var(--color-bt-text)" }}>
          Make it official
        </h2>
        <p className="mt-2 text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
          Write a message to your crew — this will appear on the home tab for everyone
          and kick off the RSVP.
        </p>

        {hasLockedDate ? (
          <>
            {/* Preview chip */}
            <div
              className="mt-4 rounded-xl px-3 py-2 text-[13px]"
              style={{ background: "var(--color-bt-card-raised)", color: "var(--color-bt-text)" }}
            >
              {dateRange ? `${dateRange} · ${destination}` : destination}
            </div>

            {/* Message textarea */}
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="What do you want to share with your crew?"
              rows={3}
              className="mt-3 w-full resize-none rounded-xl border px-3 py-2.5 text-sm outline-none"
              style={{
                background: "var(--color-bt-card-raised)",
                borderColor: "var(--color-bt-border)",
                color: "var(--color-bt-text)",
              }}
            />
            <p className="mt-1 text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
              This becomes your trip&apos;s About section — share the details, get people excited.
            </p>

            <button
              onClick={() => advance.mutate({ tripId, aboutMessage: message.trim() })}
              disabled={advance.isPending || !message.trim()}
              className="mt-4 w-full rounded-xl py-3 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-40"
              style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
            >
              {advance.isPending ? "Sending..." : "Send it"}
            </button>
            <button
              onClick={onClose}
              className="mt-2 w-full rounded-xl py-2.5 text-sm transition-opacity hover:opacity-80"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              Not yet
            </button>
          </>
        ) : (
          <div
            className="mt-4 flex items-start gap-3 rounded-xl px-4 py-3"
            style={{ background: "var(--color-bt-warning-bg, rgba(217,119,6,0.1))" }}
          >
            <span style={{ color: "var(--color-bt-warning)" }}>⚠</span>
            <p className="text-sm" style={{ color: "var(--color-bt-warning)" }}>
              Lock a date first — your crew will want to know when.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
