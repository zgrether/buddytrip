"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Lock } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { useTripRole } from "@/hooks/useTripRole";
import { type TabId, TripBottomNav } from "@/components/BottomNav";
import { TripTabBar } from "@/components/TripTabBar";
import { getTripStatus } from "@/components/StatusBadge";
import { TripHeader } from "@/components/TripHeader";
import { TripSettingsModal } from "@/components/TripSettingsModal";
import { TopNav } from "@/components/TopNav";
import { FloatingChatPanel } from "@/components/FloatingChatPanel";
import { NewsPanel, type NewsAuthorMeta } from "@/components/NewsPanel";
import { useRealtimeCompetition } from "@/hooks/useRealtimeCompetition";
import { useRealtimeEvents } from "@/hooks/useRealtimeEvents";
import { useRealtimeMembers } from "@/hooks/useRealtimeMembers";
import { HomeTab } from "./tabs/HomeTab";
import { ScheduleTab } from "./tabs/ScheduleTab";
import { CrewTab } from "./tabs/CrewTab";
import { LodgingTab } from "./tabs/LodgingTab";
import { CompTab } from "./tabs/CompTab";
import { ExpensesTab } from "./tabs/ExpensesTab";
import { formatDateRangeCompact } from "@/lib/dates";
import { isReadOnly as checkReadOnly } from "@/lib/tripStatus";
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
  const [toast, setToast] = useState<{ message: string; variant: "warning" } | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  // News + Chat both dock to the right rail, so they're mutually exclusive:
  // opening one closes the other.
  const [newsOpen, setNewsOpen] = useState(false);
  const openChat = () => {
    setNewsOpen(false);
    setChatOpen((prev) => !prev);
  };
  const openNews = () => {
    setChatOpen(false);
    setNewsOpen((prev) => !prev);
  };
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
  const { data: members = [], isLoading: membersLoading } = trpc.tripMembers.list.useQuery({ tripId });
  // datePoll.get and quickInfoTiles.list fire here in parallel but are NOT
  // gated in dataLoading — datePoll feeds one owner-only "votes in" pill and
  // tiles aren't read in this file, so blocking first paint on the slowest of
  // them just delayed TTFB. They populate in the background; the pill pops in.
  trpc.datePoll.get.useQuery({ tripId });
  trpc.quickInfoTiles.list.useQuery({ tripId });

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
  // Background prefetch for receipts so the Expenses tab reads from cache
  // instead of flashing its loading skeleton for 1–2s on first open. Same
  // queryKey as ExpensesSection's own useQuery, so it hydrates instantly.
  trpc.expenses.list.useQuery({ tripId });
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

  const dataLoading = isLoading || ideasLoading || membersLoading
    || competitionLoading;

  // Push competition row changes (Go Live, scoreboard style, name,
  // tagline) live to every crew member — without this they'd see
  // stale data for up to staleTime (60s).
  useRealtimeCompetition(tripId);
  // Same for events (placements, edits, reorders) so the scoreboard
  // reflects scoring updates the moment the owner makes them.
  useRealtimeEvents(tripId, competition?.id);
  // Push membership changes (role promote/demote, add, remove) live so a
  // member's tab visibility + edit permissions re-resolve immediately —
  // without this a just-demoted organizer keeps seeing organizer-only tabs
  // until their tripMembers.list cache goes stale or they reload.
  useRealtimeMembers(tripId);

  // Remember the most recently visited trip so the root-route Server
  // Component (src/app/page.tsx) can 307 the user back here on return
  // visits without any client work. The cookie has to be readable
  // server-side, so document.cookie writes the same value the
  // localStorage entry holds — kept in sync here and in the same
  // tick. 1 year expiry, lax SameSite (sent on direct navigation
  // back to /), Path=/ so / and /trips/* both see it.
  useEffect(() => {
    if (tripId && typeof window !== "undefined") {
      window.localStorage.setItem("bt-last-trip-id", tripId);
      const oneYearSec = 60 * 60 * 24 * 365;
      document.cookie =
        `bt-last-trip-id=${encodeURIComponent(tripId)}; ` +
        `Max-Age=${oneYearSec}; Path=/; SameSite=Lax`;
    }
  }, [tripId]);

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
  const isIdea = status === "idea";
  // Idea phase: IdeaZonePanel renders its own floating action buttons
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
  // Competition is an owner/organizer-only authoring surface (matches
  // TripTabBar). Members never see the tab — they follow a live competition
  // through the bottom-nav "Live" entry / leaderboard route instead. This
  // also snaps a member back to "home" if they land on a stale ?tab=comp URL.
  const canShowCompTab = effectiveCanEdit;
  const canShowLodgingTab =
    !isIdea && effectiveCanEdit;
  const canShowScheduleTab = effectiveCanEdit;
  // Receipts is hidden only in the idea phase, where there's nothing to
  // receipt against yet.
  const canShowExpensesTab = !isIdea;

  const activeTab: TabId =
    (activeTabRaw === "comp" && !canShowCompTab) ||
    (activeTabRaw === "lodging" && !canShowLodgingTab) ||
    (activeTabRaw === "schedule" && !canShowScheduleTab) ||
    (activeTabRaw === "expenses" && !canShowExpensesTab)
      ? "home"
      : activeTabRaw;

  // ── Tab badge conditions ──────────────────────────────────────────────
  // crewDot: owner sees a dot when at least one member is Invited —
  // i.e., has an email but hasn't signed up yet, so a resend-invite
  // action is meaningful. Placeholders (name-only) are intentional
  // headcount entries and don't earn the dot.
  const crewDot =
    isOwner &&
    (members as Array<{ isGuest?: boolean; user?: { email?: string | null } | null }>).some(
      (m) => m.isGuest && !!m.user?.email
    );
  // schedule badge: two tiers, parallel to lodging.
  //  "warning" — one or more agenda items have a scheduled_date that
  //              falls outside the trip date range (likely a typo).
  //  "info"    — at least one item is still incomplete (unscheduled
  //              or scheduled-but-unconfirmed). Normal planning action.
  // Warning takes priority; only shown to editors.
  const scheduleItems = prefetchedSchedule as Array<{
    is_confirmed: boolean;
    scheduled_date?: string | null;
    item_type?: string | null;
  }>;
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
  // Task 70: the dot fires until the lodging is actually "decided." A
  // property only counts as decided when it's confirmed AND has a date —
  // confirming without a check-in/out leaves it off the itinerary (the
  // itinerary keys off dates), so confirmed-but-undated is still an
  // action item. Dates needn't be in-range (pre/post-trip stays are
  // fine); they just have to exist. Leftover unconfirmed entries beyond
  // that are "considered but not booked" and don't nag.
  const lodgingUnconfirmed =
    effectiveCanEdit &&
    lodgingItems.length > 0 &&
    !lodgingItems.some((i) => i.is_confirmed && (i.check_in_time || i.check_out_time));
  const scheduleOutOfRange =
    effectiveCanEdit &&
    tripStart && tripEnd &&
    scheduleItems.some((item) => {
      const d = item.scheduled_date ?? null;
      return d && (d < tripStart || d > tripEnd);
    });
  // Agenda info dot — mirror the in-tab nudges so the tab badge never
  // promises an action item the user can't find. The only actionable
  // states that surface a nudge in ScheduleTab are:
  //   1. items exist but trip dates aren't set ("Set dates to schedule"), or
  //   2. a golf round is on a day but still needs a tee time / walk-on.
  // On-deck (unscheduled) items are a normal parking state, not an action
  // item, so they no longer light the dot on their own.
  const scheduleNeedsDates =
    effectiveCanEdit && !tripStart && scheduleItems.length > 0;
  const scheduleUnconfirmedGolf =
    effectiveCanEdit &&
    scheduleItems.some(
      (item) =>
        item.item_type === "golf" && !item.is_confirmed && !!item.scheduled_date
    );
  // compDot: warning when any scored GOLF event has no agenda item linked.
  const compDot =
    !!competition &&
    (prefetchedCompEvents as Array<{ type: string; is_practice: boolean; agenda_item?: unknown }>)
      .some((e) => e.type === "GOLF" && !e.is_practice && !e.agenda_item);

  const tabBadges: Partial<Record<TabId, "info" | "warning">> = {};
  // Crew uses the "warning" tier so the tab dot picks up amber — matches
  // the Pending status hue elsewhere on the tab (legend dot, nudge icon,
  // row subline, avatar corner badge). Task 61 tried planning-blue here
  // for a softer feel but the dot blended in; amber stands out.
  if (crewDot) tabBadges.crew = "warning";
  if (scheduleOutOfRange) tabBadges.schedule = "warning";
  else if (scheduleNeedsDates || scheduleUnconfirmedGolf) tabBadges.schedule = "info";
  if (lodgingOutOfRange) tabBadges.lodging = "warning";
  else if (lodgingUnconfirmed) tabBadges.lodging = "info";
  if (compDot) tabBadges.comp = "warning";

  // Settings gear is now rendered INSIDE TripHeader (top-right). The header
  // calls `onSettingsClick` when tapped — pass it through only when the owner
  // can actually edit the trip.
  const onSettingsClick = (isOwner && !tripIsReadOnly)
    ? () => setShowSettings(true)
    : undefined;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      className="min-h-screen"
      style={{ background: "var(--color-bt-base)", color: "var(--color-bt-text)" }}
    >
      {/* ── Top nav ────────────────────────────────────────────────────────── */}
      <TopNav
        tripId={tripId}
        onOpenChat={openChat}
        chatOpen={chatOpen}
        onOpenNews={openNews}
        newsOpen={newsOpen}
      />

      {/* ── Trip content ────────────────────────────────────────────────── */}
      {isIdea ? (
        /* Idea phase: no tab bar, no sidebar — IdeaZonePanel is the whole page. */
        <>
          <div className="mx-auto max-w-[1280px] px-4 pt-4">
            <TripHeader
              tripId={trip.id}
              tripName={trip.title}
              status={status}
              location={destLocation}
              lockedTitle={trip.locked_destination_title}
              dateRange={formatDateRangeCompact(trip.start_date, trip.end_date)}
              isLocked={isLocked}
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
                onTabChange={(tab) => setActiveTab(tab as TabId)}
                onEnableComp={effectiveCanEdit ? () => { setCompUnlocked(true); setActiveTab("comp"); } : undefined}
                compActivated={showComp}
                onOpenChat={() => setChatOpen(true)}
                onOpenDatesSheet={canEdit ? () => setDatesSheetOpen(true) : undefined}
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
          <div className={chatOpen || newsOpen ? "lg:mr-[400px] transition-[margin-right] duration-200" : "transition-[margin-right] duration-200"}>
            <TripHeader
              tripId={trip.id}
              tripName={trip.title}
              status={status}
              location={destLocation}
              lockedTitle={trip.locked_destination_title}
              dateRange={formatDateRangeCompact(trip.start_date, trip.end_date)}
              isLocked={isLocked}
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
              {/* Quick Info is now baked into the trip header dock
                   (TripHeaderDock) — tile rail sits alongside the countdown
                   ring, no separate home-tab panel anymore. */}

              {/* Competition strip — removed in Phase A schema rebuild.
                   The persistent leaderboard summary returns in Phase B
                   once scoring is wired through to the new events model. */}

              <TripTabBar
                activeTab={activeTab}
                onTabChange={(tab) => setActiveTab(tab)}
                canEdit={canEdit}
                isIdea={isIdea}
                badges={tabBadges}
              />
              <div className="pt-4 pb-32">
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
                    onTabChange={(tab) => setActiveTab(tab as TabId)}
                    onOpenChat={() => setChatOpen(true)}
                    onOpenDatesSheet={canEdit ? () => setDatesSheetOpen(true) : undefined}
                  />
                )}
                {activeTab === "schedule" && (
                  <ScheduleTab
                    trip={trip}
                    role={role}
                    canEdit={effectiveCanEdit}
                    isOwner={tripIsReadOnly ? false : isOwner}
                    onOpenDatesSheet={canEdit ? () => setDatesSheetOpen(true) : undefined}
                    onTabChange={setActiveTab}
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
                    compUnlocked={compUnlocked}
                    onEnable={effectiveCanEdit ? () => setCompUnlocked(true) : undefined}
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
        />
      )}

      {/* ── Floating crew chat ──────────────────────────────────────────
          Opened from the chat button in the TopNav. Renders as a side
          panel on desktop (lg+) and as a bottom sheet on mobile. */}
      <FloatingChatPanel
        tripId={tripId}
        isOpen={chatOpen}
        ideaStage={isIdea}
        onClose={() => setChatOpen(false)}
        memberNames={Object.fromEntries(
          members.map((m: { user_id: string | null; memberId: string; displayName: string }) => [m.user_id ?? m.memberId, m.displayName])
        )}
      />

      {/* ── News panel ──────────────────────────────────────────────────
          Owner/organizer announcement board. Sibling of chat: docked rail
          on desktop, bottom sheet on mobile. Opened from the News tool in
          the TopNav. */}
      <NewsPanel
        tripId={tripId}
        isOpen={newsOpen}
        onClose={() => setNewsOpen(false)}
        canPost={role === "Owner" || role === "Planner"}
        authors={Object.fromEntries(
          members.map(
            (m: {
              user_id: string | null;
              memberId: string;
              displayName: string;
              role: NewsAuthorMeta["role"];
              user: { avatar_icon: string | null } | null;
            }) => [
              m.user_id ?? m.memberId,
              {
                name: m.displayName,
                role: m.role,
                avatarIcon: m.user?.avatar_icon ?? null,
              },
            ]
          )
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

