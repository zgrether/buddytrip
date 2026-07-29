"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Lock } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { STRUCTURE_QUERY } from "@/lib/queryConfig";
import { pushMarker, replaceMarker, readOwner } from "@/lib/historyMarker";

/** The tab ids `?tab=` will honour. `comp` is accepted only so a stale link can
 *  be recognised and redirected — it is never written by this page. */
const VALID_TABS = ["home", "crew", "lodging", "schedule", "expenses", "comp"] as const;

import { useTripRole } from "@/hooks/useTripRole";
import type { TabId } from "@/components/BottomNav";
import { TripTabBar } from "@/components/TripTabBar";
import { getTripStatus } from "@/components/StatusBadge";
import { TripHeader } from "@/components/TripHeader";
import { TripSettingsModal } from "@/components/TripSettingsModal";
import { TopNav } from "@/components/TopNav";
import { useRealtimeCompetition } from "@/hooks/useRealtimeCompetition";
import { useRealtimeMembers } from "@/hooks/useRealtimeMembers";
import { useRealtimeTripData } from "@/hooks/useRealtimeTripData";
import { HomeTab } from "./tabs/HomeTab";
import { ScheduleTab } from "./tabs/ScheduleTab";
import { CrewTab } from "./tabs/CrewTab";
import { LodgingTab } from "./tabs/LodgingTab";
import { ExpensesTab } from "./tabs/ExpensesTab";
import { formatDateRangeCompact } from "@/lib/dates";
import { isReadOnly as checkReadOnly } from "@/lib/tripStatus";
import { DatesSheet } from "./components/DatesSheet";
import { AppShell } from "@/components/shell/AppShell";
import { useTripId } from "@/components/TripIdProvider";
import { ChatView } from "@/components/shell/ChatView";
import { LiveFaceClient } from "@/components/competition/LiveFaceClient";

// ── TripDetailPage ────────────────────────────────────────────────────────

function TripDetailBody({ tripId }: { tripId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // ── Tab state lives in the URL (Phase 2 / IA-1) ───────────────────────────
  // It used to be `useState` seeded once from `?tab=` and never written back, so
  // a tab was not a place: no deep link, nothing to share, and back left the trip
  // entirely instead of stepping to the previous tab (NAV_AUDIT_2.md §1.1).
  //
  // Now the URL is the single source of truth and the tab is DERIVED from it —
  // which means back/forward need no listener of their own. Next syncs a manual
  // pushState/replaceState into `useSearchParams`, and popstate re-derives.
  //
  // History cost is ONE entry per excursion, not one per switch: see `writeTab`.
  const activeTabRaw: TabId = useMemo(() => {
    const requested = searchParams.get("tab");
    return (VALID_TABS as readonly string[]).includes(requested ?? "")
      ? (requested as TabId)
      : "home";
  }, [searchParams]);

  /**
   * Move to `tab` by rewriting the URL.
   *
   * The sentinel model: the FIRST step away from Home pushes one entry;
   * every switch after that replaces it. So five tab taps cost one history
   * entry, back from any tab returns to Home, and back from Home leaves the
   * trip — instead of a stack five deep that the user has to unwind.
   */
  const setActiveTab = useCallback(
    (tab: TabId) => {
      if (typeof window === "undefined" || tab === activeTabRaw) return;
      const url = tab === "home" ? pathname : `${pathname}?tab=${tab}`;
      if (readOwner(window.history.state) === "tab") {
        // Already on the sentinel — swap its URL, don't stack another entry.
        replaceMarker("tab", { btTab: true }, url);
      } else {
        pushMarker("tab", { btTab: true }, url);
      }
      // No router call on purpose. Next syncs a History API write into
      // `useSearchParams` with NO server round-trip — the same mechanism the game
      // panel uses for `?game=` (CLAUDE.md #12). Going through `router.replace`
      // here would re-resolve the RSC and reintroduce exactly the cost this
      // refactor exists to remove.
    },
    [activeTabRaw, pathname],
  );
  const [showSettings, setShowSettings] = useState(false);
  const [toast, setToast] = useState<{ message: string; variant: "warning" } | null>(null);
  const [datesSheetOpen, setDatesSheetOpen] = useState(false);

  // ── Data ──────────────────────────────────────────────────────────────────
  const {
    data: trip,
    isLoading,
    error,
  } = trpc.trips.getById.useQuery({ tripId });

  // `loading` is destructured now and threaded to `HomeTab`. Role has THREE
  // states, not two: resolved-privileged, resolved-member, and NOT YET KNOWN.
  // While pending, `role` is null and `isOwner` is therefore `false` — which
  // `ItineraryPanel`'s `if (!isOwner)` read as "member" and painted the member
  // empty state over the owner's trip. The layout now seeds `tripMembers.list`
  // from the server so this is normally already resolved on the first render;
  // this flag covers the path where that seed can't land (the layout swallows
  // auth/membership failures by design).
  const { role, isOwner, canEdit, loading: roleLoading } = useTripRole(tripId);

  // ── Prefetch the tab queries in parallel with the trip query ──────────────
  // All of these only need tripId (available immediately from the URL), so they
  // fire on first render alongside trips.getById and warm the caches their tabs
  // read. They no longer hold up first paint — see `dataLoading` below.
  trpc.ideas.list.useQuery({ tripId });
  const { data: members = [] } = trpc.tripMembers.list.useQuery({ tripId }, STRUCTURE_QUERY);
  // datePoll / quickInfoTiles / schedule / logistics used to GATE first paint, to
  // stop a trip switch painting the previous trip's poll windows, header tiles or
  // itinerary for a frame. They no longer do — the route boundary already prevents
  // that (see the note on `dataLoading`). They stay here as parallel PREFETCHES so
  // the surfaces that read them are warm, but they hold nothing up.
  trpc.datePoll.get.useQuery({ tripId });
  trpc.quickInfoTiles.list.useQuery({ tripId });

  // Competition: drives the showComp gate + the bottom-nav "Live" entry.
  // The new schema (migration 062) tracks this via `competitions` rather
  // than the dropped trips.event_id column. Phase B will reintroduce the
  // sub-page prefetches (teams/events/groups/scores) once the live
  // leaderboard is rebuilt against the new model.
  const { data: competition } = trpc.competitions.getByTrip.useQuery({ tripId });

  // schedule + logistics feed the home itinerary and the tab badge dots. Prefetched
  // in parallel; no longer part of the paint gate.
  const { data: prefetchedSchedule = [] } = trpc.schedule.list.useQuery({ tripId });
  const { data: prefetchedLogistics = [] } = trpc.logistics.list.useQuery({ tripId });
  // Background prefetch for receipts so the Expenses tab reads from cache
  // instead of flashing its loading skeleton for 1–2s on first open. Same
  // queryKey as ExpensesSection's own useQuery, so it hydrates instantly.
  trpc.expenses.list.useQuery({ tripId });
  // teams + assignments are NO LONGER prefetched here. They were, so the old comp
  // tab wouldn't flash while its panels fetched — but they are gated on
  // `competition?.id`, so they could only fire AFTER competitions.getByTrip
  // resolved. That dependency was the entire reason the cold open had a third
  // batch.
  //
  // They're redundant now: every consumer (CompetitionFace, TeamsPanel, the four
  // game views) lives inside the Cup surface, and LiveFaceClient seeds both keys
  // from `faceBootstrap` — which the trip LAYOUT now resolves on the server. So
  // the data arrives earlier than this prefetch ever delivered it, without a
  // client round trip at all.

  /**
   * The paint gate — reduced from EIGHT queries to one (Phase 4 / F2).
   *
   * It used to block the entire subtree until ideas + members + datePoll +
   * tiles + schedule + logistics + competition had ALL resolved, which is what
   * made a cold open two serialised round trips deep: nothing below could mount
   * to fire its own queries until the slowest of the eight came back
   * (DATA_FRESHNESS_AUDIT F2).
   *
   * WHY IT CAN GO. The gate's stated purpose was anti-flash on a trip SWITCH —
   * the page stays mounted while `tripId` changes, so for a frame it could paint
   * trip A's poll windows / header tiles / itinerary under trip B's header. That
   * reasoning was measured and found not to hold: with this gate DISABLED, a real
   * trip switch showed ZERO frames of trip A's content under trip B's header,
   * because `loading.tsx` covers the navigation and Next tears the segment down
   * and rebuilds it. The ROUTE BOUNDARY is what prevents the bleed; the gate was
   * belt-and-braces on top of it. (Supporting: nothing in `src` uses
   * `keepPreviousData`/`placeholderData` and no surface mirrors a list query into
   * local state, so a re-key yields `undefined`, not the previous trip's rows.)
   *
   * WHAT REMAINS. `trips.getById` still gates, because the page cannot render a
   * trip it doesn't have — every branch below dereferences `trip`. The other
   * seven keep their `useQuery` calls (they still prefetch in parallel, warming
   * the caches their tabs read) but no longer hold the paint.
   *
   * IF THE BLEED EVER RETURNS, the fix is NOT to re-add this gate — it is to key
   * the scoped subtree on `tripId` so a context change forces a fresh tree
   * (`AppShell` already carries that key, documented as inert while the route
   * boundary stands). A gate hides the symptom for everyone on every load; the
   * key removes the cause.
   */
  const dataLoading = isLoading;

  // Push competition row changes (existence, scoreboard style, name, tagline)
  // live to every crew member — without this they'd see stale data for up to
  // staleTime (60s). The "Live" nav entry appears as soon as a competition
  // exists, so a freshly-created competition reveals to the crew immediately.
  useRealtimeCompetition(tripId);
  // Push membership changes (role promote/demote, add, remove) live so a
  // member's tab visibility + edit permissions re-resolve immediately —
  // without this a just-demoted organizer keeps seeing organizer-only tabs
  // until their tripMembers.list cache goes stale or they reload.
  useRealtimeMembers(tripId);
  // Push quick-info / lodging / schedule list changes live so another member's
  // header dock + itinerary reflect an edit without a refresh (Wave 1: these
  // three tables had no realtime coverage, so cross-device they stayed cached
  // up to the 60s staleTime — the "doesn't show until refresh" symptom).
  useRealtimeTripData(tripId);

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

  // Stale-pointer recovery: if the trip 404s — deleted (or membership revoked)
  // while bt-last-trip-id still pointed here, which the root route blindly
  // 307s to — clear the pointer and bounce to the dashboard instead of
  // stranding the user on a dead-end "Trip not found" screen.
  useEffect(() => {
    if (!error) return;
    if (typeof window !== "undefined") {
      window.localStorage.removeItem("bt-last-trip-id");
      document.cookie = "bt-last-trip-id=; Max-Age=0; Path=/; SameSite=Lax";
    }
    router.replace("/dashboard");
  }, [error, router]);

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

  // The competition is no longer a tab rendered inside the trip chrome — it's
  // the escaped Live face at /leaderboard (Stage 3). Any stale `?tab=comp`
  // deep link (e.g. browser-back to an old owner URL, or a sub-page that
  // routes back with tab=comp) redirects onto the face.
  //
  // LOOP HAZARD (NAV_AUDIT_2.md §5.4). Now that the tab is derived from the URL,
  // a redirect keyed on a tab VALUE fires again every time that URL comes back —
  // and a user pressing back from the face would be bounced forward onto it
  // forever. Two things prevent it:
  //   1. `router.replace`, not push: the `?tab=comp` entry is CONSUMED, so back
  //      from the face lands on whatever preceded it and never re-presents comp.
  //   2. `writeTab` never emits `?tab=comp` — `goToTab` intercepts comp and
  //      pushes the face route instead. The only way this URL exists is a stale
  //      external link, which is a one-shot.
  // The ref is belt-and-braces against a double-invoke (StrictMode) firing two
  // replaces for one stale link.
  const compRedirectedRef = useRef(false);
  useEffect(() => {
    if (activeTabRaw !== "comp") {
      compRedirectedRef.current = false;
      return;
    }
    if (compRedirectedRef.current) return;
    compRedirectedRef.current = true;
    router.replace(`/trips/${tripId}/leaderboard`);
  }, [activeTabRaw, tripId, router]);

  // ── Loading ───────────────────────────────────────────────────────────────
  /**
   * The SHELL renders immediately; only the trip CONTENT waits.
   *
   * This is the other half of the F2 fix. Reducing the gate from eight queries
   * to one changed nothing measurable on its own, because all eight ride the
   * SAME batch and therefore resolve together — the gate was never serialising
   * them. What actually cost a round trip was that the whole subtree, TopNav
   * included, sat behind the gate: its queries could not even be ISSUED until
   * trip data came back, which is what made the cold open three batches deep.
   *
   * Returning the shell here (rather than a bare spinner) lets TopNav mount and
   * fire on the FIRST tick, in parallel with the trip batch instead of after it.
   * Same component at the same position, so when the data lands React reconciles
   * rather than remounting — the shell does not flash.
   *
   * On error the effect above redirects to the dashboard; showing the shell with
   * a spinner in the meantime beats flashing a dead-end message.
   */
  if (dataLoading || error || !trip) {
    return (
      <AppShell
        tripId={tripId}
        defaultView="trip"
        topBar={({ chatOpen, onToggleChat, onDismissPanels, activeView, hasContext, onSelectView }) => (
          <TopNav
            tripId={tripId}
            hideTripSwitcher
            hideNews
            chatOpen={chatOpen}
            onOpenChat={onToggleChat}
            onDismissPanels={onDismissPanels}
            activeView={activeView}
            hasContext={hasContext}
            onSelectView={onSelectView}
          />
        )}
        cup={<LiveFaceClient initialBoot={null} />}
        chat={<ChatView tripId={tripId} canPost={false} />}
        trip={
          <div className="flex min-h-[60vh] items-center justify-center">
            <div
              className="h-8 w-8 animate-spin rounded-full border-2"
              style={{ borderColor: "var(--color-bt-accent)", borderTopColor: "transparent" }}
            />
          </div>
        }
      />
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
  const showComp = !!competition;
  const isLocked = !!trip.locked_destination_title;

  // The Competition entry is now a jump to the escaped Live face, not an
  // in-page tab (Stage 3). Intercept "comp" everywhere a child asks to switch
  // tabs and push the face route instead.
  const goToTab = (tab: TabId) => {
    if (tab === "comp") {
      router.push(`/trips/${tripId}/leaderboard`);
      return;
    }
    setActiveTab(tab);
  };

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
    check_in_date?: string | null;
    check_out_date?: string | null;
  }>).filter((i) => i.type === "lodging");
  const tripStart = (trip as { start_date?: string | null }).start_date ?? null;
  const tripEnd   = (trip as { end_date?: string | null }).end_date ?? null;
  const lodgingOutOfRange =
    effectiveCanEdit &&
    tripStart && tripEnd &&
    lodgingItems.some((i) => {
      const ci = i.check_in_date?.slice(0, 10) ?? null;
      const co = i.check_out_date?.slice(0, 10) ?? null;
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
    !lodgingItems.some((i) => i.is_confirmed && (i.check_in_date || i.check_out_date));
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

  // Settings gear is now rendered INSIDE TripHeader (top-right). The header
  // calls `onSettingsClick` when tapped — pass it through only when the owner
  // can actually edit the trip.
  const onSettingsClick = (isOwner && !tripIsReadOnly)
    ? () => setShowSettings(true)
    : undefined;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    /**
     * The shell (Phase 3, chat-as-action Phase 6). This route is the SCOPED
     * host: Trip and Cup render here and switching between them is client
     * state — no route change, no remount, no server round trip. Chat is an
     * overlay AppShell layers on top, not a third tab. Home is context-free
     * and lives on /dashboard, so selecting it navigates; see AppShell's
     * scope note.
     *
     * The top bar is REDUCED to brand + avatar plus (desktop-only) the chat
     * toggle — the trip switcher and News stay out (moved into the tab bar /
     * never wired here), and Chat is wired back in as a render prop so it can
     * reach AppShell's own `chatOpen` state (see AppShell's `topBar` doc
     * comment).
     */
    <AppShell
      tripId={tripId}
      defaultView="trip"
      topBar={({ chatOpen, onToggleChat, onDismissPanels, activeView, hasContext, onSelectView }) => (
        <TopNav
          tripId={tripId}
          hideTripSwitcher
          hideNews
          chatOpen={chatOpen}
          onOpenChat={onToggleChat}
          onDismissPanels={onDismissPanels}
          activeView={activeView}
          hasContext={hasContext}
          onSelectView={onSelectView}
        />
      )}
      cup={<LiveFaceClient initialBoot={null} />}
      chat={<ChatView tripId={tripId} canPost={effectiveCanEdit} />}
      trip={() => (
        <>
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
                roleLoading={roleLoading}
                onTabChange={(tab) => goToTab(tab as TabId)}
                onEnableComp={effectiveCanEdit ? () => router.push(`/trips/${tripId}/leaderboard`) : undefined}
                compActivated={showComp}
                onOpenDatesSheet={canEdit ? () => setDatesSheetOpen(true) : undefined}
              />
            )}
          </main>
        </>
      ) : (
        /* Planning / going / now / past / saved: single-column page.
           Crew chat lives in the FloatingChatPanel on the right (desktop)
           or as a bottom sheet (mobile), so no sidebar column is needed. */
        <div className="mx-auto max-w-[1280px] px-4 pt-4">
          {/* News/Chat now overlay the page with a scrim (they don't push the
              content narrower), so no margin-right shift here. */}
          <div>
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
                onTabChange={goToTab}
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
                    roleLoading={roleLoading}
                    onTabChange={(tab) => goToTab(tab as TabId)}
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
              </div>
            </div>
          </div>
        </div>
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
        </>
      )}
    />
  );
}

// ── Trip id ───────────────────────────────────────────────────────────────
// The URL param IS the trip UUID (CLAUDE.md #21 — there is no second form).
// It is still read in exactly ONE place, `TripIdProvider` (mounted by this
// route's layout), and every trip-scoped surface reads `useTripId()`.
//
// That single read point predates the slug removal and outlives it: this used
// to resolve inline, five other components had each copied the same block, and
// a sixth (`LiveFaceClient`) skipped it and broke the whole Cup tab.
export default function TripDetailPage() {
  const { tripId } = useTripId();

  // No client-side validity check: whether this id names a trip you can see is
  // the server's answer, and `TripDetailBody` already bounces to /dashboard
  // when `trips.getById` errors (its stale-pointer recovery). That covers a
  // dead id, a deleted trip and revoked membership alike — a shape check would
  // have caught only the first, and would wrongly reject non-UUID ids, which
  // `trips.id` being `text` permits.

  if (!tripId) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div
          className="h-8 w-8 animate-spin rounded-full border-2"
          style={{ borderColor: "var(--color-bt-accent)", borderTopColor: "transparent" }}
        />
      </div>
    );
  }

  return <TripDetailBody tripId={tripId} />;
}

