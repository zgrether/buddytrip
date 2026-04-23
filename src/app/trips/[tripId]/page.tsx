"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Settings, Lock, MessageCircle, Sparkles } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { useTripRole } from "@/hooks/useTripRole";
import { TripBottomNav, type TabId } from "@/components/BottomNav";
import { TripTabBar } from "@/components/TripTabBar";
import { getTripStatus } from "@/components/StatusBadge";
import { TripHeader } from "@/components/TripHeader";
import { ProgressStepper } from "@/components/ProgressStepper";
import { TripSettingsModal } from "@/components/TripSettingsModal";
import { TopNav } from "@/components/TopNav";
import { useRealtimeNotifications } from "@/hooks/useRealtimeNotifications";
import { HomeTab } from "./tabs/HomeTab";
import { ScheduleTab } from "./tabs/ScheduleTab";
import { CrewTab } from "./tabs/CrewTab";
import { LodgingTab } from "./tabs/LodgingTab";
import { CompTab } from "./tabs/CompTab";
import { ExpensesTab } from "./tabs/ExpensesTab";
import { formatDateRange } from "@/lib/dates";
import { isReadOnly as checkReadOnly, countdownLabel } from "@/lib/tripStatus";
import { ChatDrawer } from "./components/ChatDrawer";
import { QuickInfoSection } from "./components/QuickInfoSection";
import { TripSummaryModal } from "./components/TripSummaryModal";
import { TripInvitationModal } from "./components/TripInvitationModal";
import { TwoColumnLayout } from "./components/TwoColumnLayout";
import { SidebarForStage } from "./components/SidebarForStage";

// ── TripDetailPage ────────────────────────────────────────────────────────

export default function TripDetailPage() {
  const { tripId } = useParams<{ tripId: string }>();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabId>("home");
  const [showSettings, setShowSettings] = useState(false);
  const [compUnlocked, setCompUnlocked] = useState(false);
  const [showInvitationModal, setShowInvitationModal] = useState(false);
  const [showWriteInvitationModal, setShowWriteInvitationModal] = useState(false);
  const [toast, setToast] = useState<{ message: string; variant: "warning" } | null>(null);
  const [showChatDrawer, setShowChatDrawer] = useState(false);
  const [sidebarChatMinimized, setSidebarChatMinimized] = useState(false);

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
  const { data: poll, isLoading: pollLoading } = trpc.datePoll.get.useQuery({ tripId });
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

  // ── Notifications ─────────────────────────────────────────────────────────
  useRealtimeNotifications([tripId]);

  const { data: notifications = [] } = trpc.notifications.list.useQuery(
    { tripId, limit: 20 },
  );

  const unreadCount = notifications.filter((n) => !n.read).length;

  // All hooks must be called before any early returns
  const utils = trpc.useUtils();

  const markAllRead = trpc.notifications.markAllRead.useMutation({
    onSuccess: () => {
      utils.notifications.list.invalidate({ tripId });
    },
  });

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
  // When exploring (comparison_mode=true, no lock), don't fall back to
  // trip.location — lockDestination writes to that column and unlockDestination
  // doesn't clear it, so the old destination would bleed through to the header.
  const destLocation = trip.locked_destination_location
    ?? (trip.comparison_mode ? null : trip.location);
  const showComp = !!trip.event_id || compUnlocked;
  const isLocked = !!trip.locked_destination_title;

  // Effective canEdit: forced false when read-only
  const effectiveCanEdit = tripIsReadOnly ? false : canEdit;

  const settingsButton = (isOwner && !tripIsReadOnly) ? (
    <button
      data-testid="trip-settings-btn"
      onClick={() => setShowSettings(true)}
      className="flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-bt-hover)]"
      style={{ color: "var(--color-bt-text-dim)" }}
      aria-label="Trip settings"
    >
      <Settings size={18} />
    </button>
  ) : null;

  // Trip summary — compact labelled pill for the owner once the trip is past
  // idea stage. Filled when the prereqs to advance (destination + dates locked)
  // are satisfied; outlined while something is still outstanding. Once the
  // trip is going, those prereqs are definitionally met, so the button stays
  // filled as a view-only recap.
  const summaryReady = stage === "going" || (!!trip.locked_destination_title?.trim() && !!poll?.lockedWindowId);
  const summaryButton = (isOwner && (stage === "planning" || stage === "going")) ? (
    <button
      data-testid="trip-summary-btn"
      onClick={() => setShowInvitationModal(true)}
      className="flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition-opacity hover:opacity-80"
      style={
        summaryReady
          ? { background: "var(--color-bt-accent)", color: "var(--color-bt-base)", border: "1px solid var(--color-bt-accent)" }
          : { background: "transparent", color: "var(--color-bt-accent)", border: "1px solid var(--color-bt-accent)" }
      }
      aria-label={summaryReady ? "Open trip summary" : "Open trip summary (some items still incomplete)"}
    >
      <Sparkles size={13} />
      Summary
    </button>
  ) : null;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      className="min-h-screen"
      style={{ background: "var(--color-bt-base)", color: "var(--color-bt-text)" }}
    >
      {/* ── Top nav ────────────────────────────────────────────────────────── */}
      <TopNav
        notifications={notifications}
        unreadCount={unreadCount}
        onMarkAllRead={() => markAllRead.mutate({ tripId })}
      />

      {/* ── Trip content ────────────────────────────────────────────────── */}
      {stage === "idea" ? (
        /* Idea stage: no tab bar, no sidebar — IdeaZonePanel is the whole page. */
        <>
          <div className="mx-auto max-w-[1280px] px-4 pt-4">
            {/* ── Owner toolbar: progress stepper + settings ── */}
            {isOwner && (
              <div className="mb-3 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <ProgressStepper
                    stage={stage}
                    displayStatus={status}
                    countdownText={countdownLabel(trip)}
                  />
                </div>
                {settingsButton}
              </div>
            )}

            <TripHeader
              tripName={trip.title}
              status={status}
              location={destLocation}
              lockedTitle={trip.locked_destination_title}
              dateRange={formatDateRange(trip.start_date, trip.end_date)}
              isLocked={isLocked}
              canEdit={canEdit}
              myRole={role}
              tripStartDate={trip.start_date}
              onDestinationChange={(value) => {
                lockDestination.mutate({
                  tripId: trip.id,
                  title: value,
                  location: value,
                });
              }}
              onDatesTap={() => setActiveTab("schedule")}
            />
          </div>
          <main className="mx-auto max-w-[1280px] pt-4 pb-6">
            {activeTab === "home" && (
              <HomeTab
                trip={trip}
                role={role}
                canEdit={effectiveCanEdit}
                isOwner={isOwner}
                displayStatus={status}
                onTabChange={(tab) => setActiveTab(tab as TabId)}
                onEnableComp={effectiveCanEdit ? () => { setCompUnlocked(true); setActiveTab("comp"); } : undefined}
                onOpenChat={() => setShowChatDrawer(true)}
              />
            )}
          </main>
        </>
      ) : (
        /* Planning / going / now / past / saved: persistent two-column layout —
           owner toolbar, header, quick info, tab bar, and tab content live in
           the main column so the sidebar column can sticky-fill the viewport
           from the top of the content area. */
        <div className="mx-auto max-w-[1280px] px-4 pt-4">
          <TwoColumnLayout
            stickySidebar
            collapseSidebar={sidebarChatMinimized}
            sidebar={
              <SidebarForStage
                stage={stage as "planning" | "going" | "now" | "past" | "saved"}
                tripId={tripId}
                isOwner={isOwner}
                canEdit={effectiveCanEdit}
                memberNames={Object.fromEntries(
                  members.map((m: { user_id: string | null; memberId: string; displayName: string }) => [m.user_id ?? m.memberId, m.displayName])
                )}
                onExpandChat={() => setShowChatDrawer(true)}
                chatMinimized={sidebarChatMinimized}
                onMinimizeChat={() => setSidebarChatMinimized(true)}
              />
            }
          >
            <div>
              {/* ── Owner toolbar: progress stepper + settings ──
                  The Trip Summary button lives inline with the Action
                  Center title; see HomeTab below. */}
              {isOwner && (
                <div className="mb-3 flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <ProgressStepper
                      stage={stage}
                      displayStatus={status}
                      countdownText={countdownLabel(trip)}
                    />
                  </div>
                  {settingsButton}
                </div>
              )}

              <TripHeader
                tripName={trip.title}
                status={status}
                location={destLocation}
                lockedTitle={trip.locked_destination_title}
                dateRange={formatDateRange(trip.start_date, trip.end_date)}
                isLocked={isLocked}
                canEdit={canEdit}
                myRole={role}
                tripStartDate={trip.start_date}
                onDestinationChange={(value) => {
                  lockDestination.mutate({
                    tripId: trip.id,
                    title: value,
                    location: value,
                  });
                }}
                onDatesTap={() => setActiveTab("schedule")}
              />

              <div className="mt-4">
              {(stage === "going" || stage === "now" || stage === "past" || stage === "saved") && (
                <div className="mb-4">
                  <QuickInfoSection tripId={tripId} isOwner={isOwner} />
                </div>
              )}
              <TripTabBar
                activeTab={activeTab}
                onTabChange={(tab) => setActiveTab(tab)}
                showComp={showComp}
                canEdit={canEdit}
                stage={stage}
              />
              <div className="pt-4 pb-24">
                {tripIsReadOnly && activeTab === "home" && (
                  <div
                    className="mb-3 flex items-center gap-2 rounded-xl px-4 py-2.5"
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
                    displayStatus={status}
                    onTabChange={(tab) => setActiveTab(tab as TabId)}
                    onEnableComp={effectiveCanEdit ? () => { setCompUnlocked(true); setActiveTab("comp"); } : undefined}
                    onOpenChat={() => setShowChatDrawer(true)}
                    onWriteInvitation={() => setShowWriteInvitationModal(true)}
                    actionCenterTitleAction={summaryButton}
                  />
                )}
                {activeTab === "schedule" && (
                  <ScheduleTab trip={trip} role={role} canEdit={effectiveCanEdit} isOwner={tripIsReadOnly ? false : isOwner} />
                )}
                {activeTab === "crew" && (
                  <CrewTab trip={trip} role={role} canEdit={effectiveCanEdit} isOwner={tripIsReadOnly ? false : isOwner} />
                )}
                {activeTab === "lodging" && (
                  <LodgingTab trip={trip} role={role} canEdit={effectiveCanEdit} isOwner={tripIsReadOnly ? false : isOwner} />
                )}
                {activeTab === "expenses" && (
                  <ExpensesTab trip={trip} role={role} canEdit={effectiveCanEdit} isOwner={tripIsReadOnly ? false : isOwner} />
                )}
                {activeTab === "comp" && (
                  <CompTab trip={trip} role={role} canEdit={effectiveCanEdit} isOwner={tripIsReadOnly ? false : isOwner} />
                )}
              </div>
              </div>
            </div>
          </TwoColumnLayout>
        </div>
      )}

      {/* ── Bottom navigation ─────────────────────────────────────────────
          Only surfaces once a competition exists (or has been unlocked) —
          that's the point where leaderboard / messages / expenses start
          carrying their own weight. Until then the trip lives entirely
          inside the home tab + stage-aware sidebar. */}
      {showComp && (
        <TripBottomNav tripId={tripId} eventId={trip.event_id} />
      )}

      {/* ── Settings modal ────────────────────────────────────────────────── */}
      {showSettings && role && (
        <TripSettingsModal
          tripId={tripId}
          tripName={trip.title}
          trip={trip}
          viewerRole={role}
          onClose={() => setShowSettings(false)}
        />
      )}

      {/* ── Trip Summary modal ──────────────────────────────────────────── */}
      {showInvitationModal && trip && (
        <TripSummaryModal
          tripId={tripId}
          trip={trip}
          onClose={() => setShowInvitationModal(false)}
          onAdvanced={() => setShowInvitationModal(false)}
        />
      )}

      {/* ── Trip Invitation modal (going-stage owner write-invitation CTA) ── */}
      {showWriteInvitationModal && trip && (
        <TripInvitationModal
          tripId={tripId}
          trip={trip}
          onClose={() => setShowWriteInvitationModal(false)}
        />
      )}

      {/* ── Mobile crew chat FAB ──────────────────────────────────────
          Always rendered on mobile. On desktop, it's hidden unless the user
          has minimized the sidebar chat — in which case it stands in for the
          collapsed sidebar panel. */}
      {(stage === "planning" || stage === "going" || stage === "now" || stage === "past" || stage === "saved") && (
        <div className={`fixed right-3 top-1/2 z-40 flex -translate-y-1/2 flex-col gap-2 ${sidebarChatMinimized ? "" : "lg:hidden"}`}>
          <button
            onClick={() => setShowChatDrawer(true)}
            data-testid="floating-chat-btn"
            className="flex h-12 w-12 items-center justify-center transition-colors active:scale-95"
            style={{
              background: "var(--color-bt-card)",
              border: "1px solid var(--color-bt-border)",
              borderRadius: "1rem",
              boxShadow: "var(--shadow-floating)",
            }}
            aria-label="Open crew chat"
          >
            <MessageCircle size={18} style={{ color: "var(--color-bt-text-dim)" }} />
          </button>
        </div>
      )}
      <ChatDrawer
        tripId={tripId}
        isOpen={showChatDrawer}
        onClose={() => setShowChatDrawer(false)}
        memberNames={Object.fromEntries(
          members.map((m: { user_id: string | null; memberId: string; displayName: string }) => [m.user_id ?? m.memberId, m.displayName])
        )}
        onDockToSidebar={sidebarChatMinimized ? () => {
          setSidebarChatMinimized(false);
          setShowChatDrawer(false);
        } : undefined}
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

