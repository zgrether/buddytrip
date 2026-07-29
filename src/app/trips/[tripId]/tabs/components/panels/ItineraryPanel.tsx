"use client";

import { Spinner } from "@/components/Spinner";
import { ItineraryView } from "../ItineraryView";
import { DatePollCard } from "../DatePollCard";
import {
  FreshTripGuide,
  DismissedEmptyState,
  useGuideDismissed,
  useSetupProgress,
} from "../../../components/setup-guide";
import type { TripData } from "../../types";

// ── Types ────────────────────────────────────────────────────────────────

interface ItineraryPanelProps {
  tripId: string;
  trip: TripData;
  isOwner: boolean;
  /** Role is not yet known. Distinct from `isOwner: false`, which this panel
   *  otherwise treats as "member" — see the branch below. */
  roleLoading?: boolean;
  /** True once the owner has tapped "Add Itinerary" on the (legacy)
   *  invitation card. With the FreshTripGuide rollout we treat the empty
   *  itinerary as the default for owners, so this flag is no longer the
   *  primary gate — but it still routes legacy trips and members. */
  isActivated: boolean;
  /** Opens the existing DatesSheet — wired from the trip page. Passed
   *  through to FreshTripGuide's date flip-card poll branch. */
  onOpenDatesSheet?: () => void;
  /** Tab switcher — drives the Lodging / Crew / Agenda step CTAs in
   *  FreshTripGuide. */
  onTabChange?: (tab: string) => void;
}

// ── Component ────────────────────────────────────────────────────────────

/**
 * ItineraryPanel — home tab panel for the day-by-day timeline.
 *
 * State machine (owner):
 *   - poll active + no dates → FreshTripGuide poll-takeover (DatePollCard
 *     with owner controls). Wins over dismissal so a live poll is never
 *     hidden behind the "Set dates" empty state.
 *   - dates set OR isActivated → ItineraryView (real bookends + content).
 *     When the guide isn't dismissed, FreshTripGuide also renders above it
 *     so the owner can keep adding lodging/crew/agenda from the same spot.
 *   - no dates set + !dismissed → FreshTripGuide alone (the empty state).
 *   - no dates set + dismissed  → DismissedEmptyState (single dashed card
 *     with a Set-dates CTA and a "Show setup guide" restore link).
 *
 * Members still see the dim placeholder until the trip has real content.
 *
 * The legacy `isActivated` flag (itinerary_enabled) routes pre-existing
 * trips that already opted in; new trips treat the empty itinerary as the
 * default, with FreshTripGuide teaching the flow.
 */
export function ItineraryPanel({
  tripId,
  trip,
  isOwner,
  roleLoading,
  isActivated,
  onOpenDatesSheet,
  onTabChange,
}: ItineraryPanelProps) {
  const [dismissed, setDismissed] = useGuideDismissed(tripId);
  // Setup progress drives the "· N left" nudge on the committed itinerary's
  // Setup-guide pill (owner only). Called unconditionally before any early
  // return; its queries are shared with the rest of the Home tab.
  const setup = useSetupProgress(tripId, trip);

  const datesSet = !!(trip.start_date && trip.end_date);
  const pollActive = !!trip.poll_mode;

  // ── Role NOT YET KNOWN — a third state, and it must not fall through ──────
  // `isOwner` is `false` while `useTripRole` is in flight, so the member branch
  // below used to claim a pending role as a definite one and paint "Your
  // timeline will start to fill in" over an owner's trip until the query landed.
  // Same defect class as #741, where a null role rendered the non-editor
  // placeholder permanently.
  //
  // The trip layout now seeds `tripMembers.list` from the server, so on the
  // normal path role is already resolved on the first render and this branch is
  // never reached. It is the fallback for the path where the seed can't land —
  // the layout swallows auth/membership failures by design — and a wrong view is
  // worse than a brief neutral one.
  //
  // Neutral means NEUTRAL: the shared spinner, not either role's surface. It is
  // scoped to this panel, so the rest of the tab still paints — this is not the
  // page-level gate Phase 4 removed.
  if (roleLoading) {
    return (
      <div className="flex items-center justify-center py-16" data-testid="itinerary-role-pending">
        <Spinner size={24} />
      </div>
    );
  }

  // ── Member path ─────────────────────────────────────────────────────
  // Reached only once role is RESOLVED (see the guard above) — `!isOwner` here
  // means "definitely not the owner", not "not the owner yet".
  // Priority order:
  //   1. Real bookends locked → ItineraryView (the trip has dates; show
  //      the day-by-day even if the poll flag is somehow still on,
  //      because dates landing is what members are waiting for).
  //   2. Poll is active → DatePollCard in vote/read mode. This is the
  //      one place the crew weighs in; the home tab IS the poll until
  //      it resolves. If the owner hasn't added windows yet, the card's
  //      empty state ("The organizer hasn't added any windows yet")
  //      handles that — members still see something useful instead of
  //      a generic dim placeholder.
  //   3. Otherwise → dim placeholder. The legacy `isActivated` flag is
  //      intentionally dropped from the member path: with the new poll
  //      flow, "itinerary is set up" should mean "dates are locked,"
  //      not "the owner flipped a legacy switch." Owners (below) still
  //      honor the flag for the rare in-flight legacy trip.
  if (!isOwner) {
    // Active poll (before dates are locked) → the crew votes here.
    if (pollActive && !datesSet) {
      return <DatePollCard trip={trip} isOwner={false} />;
    }
    // Otherwise always show the itinerary. With no content yet it renders the
    // redesigned empty-state preview — no "organizer needs to set the dates"
    // dead-end, which isn't the member's concern.
    return <ItineraryView trip={trip} isOwner={false} />;
  }

  // ── Owner: active poll (before dates lock) — poll takes over ───────
  // An in-flight poll owns the home tab REGARDLESS of guide dismissal.
  // Without this, a dismissed setup guide drops the owner onto the generic
  // "Set dates" empty state while a poll is live — stranding them with no way
  // to manage windows or watch votes (the crew, meanwhile, correctly see the
  // poll). FreshTripGuide's poll-takeover renders the DatePollCard with owner
  // controls + the poll context header; dismissal can't hide it while
  // poll_mode is on. Mirrors the member short-circuit above.
  if (pollActive && !datesSet) {
    return (
      <FreshTripGuide
        tripId={tripId}
        trip={trip}
        onTabChange={onTabChange}
        onDismiss={() => setDismissed(true)}
      />
    );
  }

  // ── Owner: dates set OR activated — guide and itinerary toggle ────
  // Either/or: when the guide is up the itinerary is hidden, and vice
  // versa. The toggle lives in the top-right of whichever surface is
  // showing — "View itinerary →" on the guide, "← Setup guide" in the
  // ITINERARY header.
  if (datesSet || isActivated) {
    if (!dismissed) {
      return (
        <FreshTripGuide
          tripId={tripId}
          trip={trip}
          onTabChange={onTabChange}
          onDismiss={() => setDismissed(true)}
        />
      );
    }
    return (
      <ItineraryView
        trip={trip}
        isOwner={isOwner}
        onShowGuide={() => setDismissed(false)}
        setupLeft={setup.leftCount}
      />
    );
  }

  // ── Owner: no dates yet ────────────────────────────────────────────
  if (dismissed) {
    return (
      <DismissedEmptyState
        onSetDates={() => onOpenDatesSheet?.()}
        onRestoreGuide={() => setDismissed(false)}
      />
    );
  }

  return (
    <FreshTripGuide
      tripId={tripId}
      trip={trip}
      onTabChange={onTabChange}
      onDismiss={() => setDismissed(true)}
    />
  );
}

