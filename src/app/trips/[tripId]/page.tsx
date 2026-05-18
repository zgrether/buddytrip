"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Lock, Sparkles } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { useTripRole } from "@/hooks/useTripRole";
import { type TabId, TripBottomNav } from "@/components/BottomNav";
import { TripTabBar } from "@/components/TripTabBar";
import { getTripStatus } from "@/components/StatusBadge";
import { TripHeader } from "@/components/TripHeader";
import { TripSettingsModal } from "@/components/TripSettingsModal";
import { TopNav } from "@/components/TopNav";
import { FloatingChatPanel } from "@/components/FloatingChatPanel";
import { useRealtimeNotifications } from "@/hooks/useRealtimeNotifications";
import { useRealtimeCompetition } from "@/hooks/useRealtimeCompetition";
import { useRealtimeEvents } from "@/hooks/useRealtimeEvents";
import { HomeTab } from "./tabs/HomeTab";
import { ScheduleTab } from "./tabs/ScheduleTab";
import { CrewTab } from "./tabs/CrewTab";
import { LodgingTab } from "./tabs/LodgingTab";
import { CompTab } from "./tabs/CompTab";
import { ExpensesTab } from "./tabs/ExpensesTab";
import { formatDateRange } from "@/lib/dates";
import { isReadOnly as checkReadOnly } from "@/lib/tripStatus";
import { TripSummaryModal } from "./components/TripSummaryModal";
import { TripInvitationModal } from "./components/TripInvitationModal";
import { DatesSheet } from "./components/DatesSheet";

// ── TripDetailPage ────────────────────────────────────────────────────────

export default function TripDetailPage() {
  const { tripId } = useParams<{ tripId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  // Initial tab respects `?tab=<id>` so sub-pages (e.g. the event
  // detail page under /trips/[tripId]/events/[eventId]) can route the
  // user back to the comp tab instead of dumping them on Home.
  //
  // `activeTabRaw` is the literal user/URL intent; the effective
  // `activeTab` (derived below) snaps back to "home" when the user
  // doesn't have permission for the requested tab.
  const [activeTabRaw, setActiveTab] = useState<TabId>(() => {
    const initial = searchParams.get("tab");
    const validTabs: TabId[] = [
      "home",
      "crew",
      "lodging",
      "schedule",
      "expenses",
      "comp",
    ];
    return (validTabs as string[]).includes(initial ?? "")
      ? (initial as TabId)
      : "home";
  });
  const [showSettings, setShowSettings] = useState(false);
  const [compUnlocked, setCompUnlocked] = useState(false);
  const [showInvitationModal, setShowInvitationModal] = useState(false);
  const [showWriteInvitationModal, setShowWriteInvitationModal] = useState(false);
  const [toast, setToast] = useState<{ message: string; variant: "warning" } | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [datesSheetOpen, setDatesSheetOpen] = useState(false);

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
  const { isLoading: tilesLoading } = trpc.quickInfoTiles.list.useQuery({ tripId });

  // Competition: drives the showComp gate + the bottom-nav "Live" entry.
  // The new schema (migration 062) tracks this via `competitions` rather
  // than the dropped trips.event_id column. Phase B will reintroduce the
  // sub-page prefetches (teams/events/groups/scores) once the live
  // leaderboard is rebuilt against the new model.
  const { data: competition, isLoading: competitionLoading } =
    trpc.competitions.getByTrip.useQuery({ tripId });

  // ── Background prefetch for tab badge conditions ───────────────────────
  // Not added to dataLoading — loads in parallel, dot appears when ready.
  const { data: prefetchedSchedule = [] } = trpc.schedule.list.useQuery({ tripId });
  const { data: prefetchedLogistics = [] } = trpc.logistics.list.useQuery({ tripId });
  // Background prefetch for competition events — drives the comp tab warning badge.
  const { data: prefetchedCompEvents = [] } = trpc.events.list.useQuery(
    { tripId, competitionId: competition?.id ?? "" },
    { enabled: !!competition?.id }
  );
  // Background prefetch for teams + assignments so the comp tab renders
  // instantly instead of flashing while the panels fire their own queries.
  trpc.teams.list.useQuery(
    { tripId, competitionId: competition?.id ?? "" },
    { enabled: !!competition?.id }
  );
  trpc.teamAssignments.list.useQuery(
    { tripId, competitionId: competition?.id ?? "" },
    { enabled: !!competition?.id }
  );

  const dataLoading = isLoading || ideasLoading || pollLoading || membersLoading
    || tilesLoading || competitionLoading;

  // ── Notifications ─────────────────────────────────────────────────────────
  useRealtimeNotifications([tripId]);
  // Push competition row changes (Go Live, scoreboard style, name,
  // tagline) live to every crew member — without this they'd see
  // stale data for up to staleTime (60s).
  useRealtimeCompetition(tripId);
  // Same for events (placements, edits, reorders) so the scoreboard
  // reflects scoring updates the moment the owner makes them.
  useRealtimeEvents(tripId, competition?.id);

  const { data: notifications = [] } = trpc.notifications.list.useQuery(
    { tripId, limit: 20 },
  );

  const unreadCount = notifications.filter((n) => !n.read).length;

  // Remember the most recently visited trip so root-route redirect
  // (src/app/page.tsx) can drop the user back here on return visits.
  useEffect(() => {
    if (tripId && typeof window !== "undefined") {
      window.localStorage.setItem("bt-last-trip-id", tripId);
    }
  }, [tripId]);

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
  const showComp = !!competition || compUnlocked;
  const isLocked = !!trip.locked_destination_title;

  // Effective canEdit: forced false when read-only
  const effectiveCanEdit = tripIsReadOnly ? false : canEdit;

  // Snap activeTab back to "home" if the user can't actually see the
  // requested tab — mirrors the visibility rules in TripTabBar.
  // Without this, a non-canEdit crew member could land on the comp
  // tab via a stale `?tab=comp` URL (from browser-back to a previous
  // owner-side URL state) and see CompTab render even though the tab
  // button itself is hidden in their tab bar.
  const canShowCompTab =
    stage !== "planning" && effectiveCanEdit && showComp;
  const canShowLodgingTab =
    stage !== "idea" && effectiveCanEdit;
  const canShowScheduleTab = effectiveCanEdit;
  // Receipts is now visible in PLANNING too — unified with GOING. Hidden
  // only in IDEA where there's nothing to receipt against yet.
  const canShowExpensesTab = stage !== "idea";

  const activeTab: TabId =
    (activeTabRaw === "comp" && !canShowCompTab) ||
    (activeTabRaw === "lodging" && !canShowLodgingTab) ||
    (activeTabRaw === "schedule" && !canShowScheduleTab) ||
    (activeTabRaw === "expenses" && !canShowExpensesTab)
      ? "home"
      : activeTabRaw;

  // ── Tab badge conditions ──────────────────────────────────────────────
  // crewDot: owner sees a dot when any member hasn't joined yet (guest/placeholder)
  const crewDot = isOwner && (members as Array<{ isGuest?: boolean }>).some((m) => m.isGuest);
  // scheduleDot: fires when any item is incomplete — either has no date assigned
  // (unscheduled) OR has a date but hasn't been confirmed yet. Both states need
  // action before the item can appear on the crew's official itinerary.
  const scheduleDot =
    effectiveCanEdit &&
    (prefetchedSchedule as Array<{ is_confirmed: boolean; scheduled_date?: string | null }>).some(
      (item) => !item.scheduled_date || !item.is_confirmed
    );
  // lodging badge: two tiers.
  //  "warning" — one or more lodging properties have check-in/out dates
  //              that fall outside the trip date range (likely a typo).
  //  "info"    — all dates are in range but at least one property hasn't
  //              been confirmed yet (normal planning-stage action item).
  // Warning takes priority; only shown to editors.
  const lodgingItems = (prefetchedLogistics as Array<{
    type?: string | null;
    is_confirmed?: boolean | null;
    check_in_time?: string | null;
    check_out_time?: string | null;
  }>).filter((i) => i.type === "lodging");
  const tripStart = (trip as { start_date?: string | null }).start_date ?? null;
  const tripEnd   = (trip as { end_date?: string | null }).end_date ?? null;
  const lodgingOutOfRange =
    effectiveCanEdit &&
    tripStart && tripEnd &&
    lodgingItems.some((i) => {
      const ci = i.check_in_time?.slice(0, 10) ?? null;
      const co = i.check_out_time?.slice(0, 10) ?? null;
      return (ci && (ci < tripStart || ci > tripEnd)) ||
             (co && (co < tripStart || co > tripEnd));
    });
  const lodgingUnconfirmed =
    effectiveCanEdit &&
    lodgingItems.length > 0 &&
    lodgingItems.some((i) => !i.is_confirmed);
  // compDot: warning when any scored GOLF event has no agenda item linked.
  const compDot =
    !!competition &&
    (prefetchedCompEvents as Array<{ type: string; is_practice: boolean; agenda_item?: unknown }>)
      .some((e) => e.type === "GOLF" && !e.is_practice && !e.agenda_item);

  const tabBadges: Partial<Record<TabId, "info" | "warning">> = {};
  if (crewDot) tabBadges.crew = "info";
  if (scheduleDot) tabBadges.schedule = "info";
  if (lodgingOutOfRange) tabBadges.lodging = "warning";
  else if (lodgingUnconfirmed) tabBadges.lodging = "info";
  if (compDot) tabBadges.comp = "warning";

  // Settings gear is now rendered INSIDE TripHeader (top-right). The header
  // calls `onSettingsClick` when tapped — pass it through only when the owner
  // can actually edit the trip.
  const onSettingsClick = (isOwner && !tripIsReadOnly)
    ? () => setShowSettings(true)
    : undefined;

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
        tripId={tripId}
        onOpenChat={() => setChatOpen((prev) => !prev)}
        chatOpen={chatOpen}
      />

      {/* ── Trip content ────────────────────────────────────────────────── */}
      {stage === "idea" ? (
        /* Idea stage: no tab bar, no sidebar — IdeaZonePanel is the whole page. */
        <>
          <div className="mx-auto max-w-[1280px] px-4 pt-4">
            <TripHeader
              tripId={trip.id}
              tripName={trip.title}
              status={status}
              location={destLocation}
              lockedTitle={trip.locked_destination_title}
              dateRange={formatDateRange(trip.start_date, trip.end_date)}
              isLocked={isLocked}
              stage={stage}
              canEdit={canEdit}
              myRole={role}
              tripStartDate={trip.start_date}
              tripEndDate={trip.end_date}
              onSettingsClick={onSettingsClick}
              pollActive={!!trip.poll_mode}
              onOpenDatesSheet={canEdit ? () => setDatesSheetOpen(true) : undefined}
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
                compActivated={showComp}
                onOpenChat={() => setChatOpen(true)}
              />
            )}
          </main>
        </>
      ) : (
        /* Planning / going / now / past / saved: single-column page.
           Crew chat lives in the FloatingChatPanel on the right (desktop)
           or as a bottom sheet (mobile), so no sidebar column is needed. */
        <div
          className="mx-auto max-w-[1280px] px-4 pt-4 transition-[margin-right] duration-200"
          style={{ marginRight: chatOpen ? undefined : undefined }}
        >
          <div className={chatOpen ? "lg:mr-[380px] transition-[margin-right] duration-200" : "transition-[margin-right] duration-200"}>
            <TripHeader
              tripId={trip.id}
              tripName={trip.title}
              status={status}
              location={destLocation}
              lockedTitle={trip.locked_destination_title}
              dateRange={formatDateRange(trip.start_date, trip.end_date)}
              isLocked={isLocked}
              stage={stage}
              canEdit={canEdit}
              myRole={role}
              tripStartDate={trip.start_date}
              tripEndDate={trip.end_date}
              onSettingsClick={onSettingsClick}
              pollActive={!!trip.poll_mode}
              onOpenDatesSheet={canEdit ? () => setDatesSheetOpen(true) : undefined}
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
              {/* Quick Info has moved into the home tab panel system —
                   no longer rendered above the tab bar. The QuickInfoSection
                   data hooks are still used by QuickInfoPanel inside HomeTab. */}

              {/* Competition strip — removed in Phase A schema rebuild.
                   The persistent leaderboard summary returns in Phase B
                   once scoring is wired through to the new events model. */}

              <TripTabBar
                activeTab={activeTab}
                onTabChange={(tab) => setActiveTab(tab)}
                showComp={showComp}
                canEdit={canEdit}
                stage={stage}
                badges={tabBadges}
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
                compActivated={showComp}
                    onOpenChat={() => setChatOpen(true)}
                    onWriteInvitation={() => setShowWriteInvitationModal(true)}
                    onAdvanceToGoing={isOwner ? () => setShowInvitationModal(true) : undefined}
                    actionCenterTitleAction={summaryButton}
                  />
                )}
                {activeTab === "schedule" && (
                  <ScheduleTab
                    trip={trip}
                    role={role}
                    canEdit={effectiveCanEdit}
                    isOwner={tripIsReadOnly ? false : isOwner}
                    onOpenDatesSheet={canEdit ? () => setDatesSheetOpen(true) : undefined}
                  />
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
                  <CompTab
                    trip={trip}
                    role={role}
                    canEdit={effectiveCanEdit}
                    isOwner={tripIsReadOnly ? false : isOwner}
                    onCompetitionDeleted={() => {
                      // Owner just wiped the competition. Drop the
                      // session-local "I unlocked the tab" flag and
                      // bounce back to home so the comp tab disappears
                      // for the owner too — not just the rest of crew.
                      setCompUnlocked(false);
                      setActiveTab("home");
                    }}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bottom nav appears once the owner flips the competition to
          "active" (Go Live button in CompetitionHeader). Stays hidden
          during setup so we don't surface an empty leaderboard. */}
      {competition?.status === "active" && (
        <TripBottomNav tripId={tripId} showComp={true} />
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

      {/* ── Trip dates sheet (set / poll / clear) ───────────────────────── */}
      {/* Wired to the dates affordance in TripHeader. Owns the full trip
          object so the embedded DatePollCard has everything it needs. */}
      {trip && (
        <DatesSheet
          isOpen={datesSheetOpen}
          onClose={() => setDatesSheetOpen(false)}
          tripId={tripId}
          trip={trip}
          isOwner={isOwner}
          onTabChange={(tab) => setActiveTab(tab as TabId)}
        />
      )}

      {/* ── Floating crew chat ──────────────────────────────────────────
          Opened from the chat button in the TopNav. Renders as a side
          panel on desktop (lg+) and as a bottom sheet on mobile. */}
      <FloatingChatPanel
        tripId={tripId}
        isOpen={chatOpen}
        onClose={() => setChatOpen(false)}
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

