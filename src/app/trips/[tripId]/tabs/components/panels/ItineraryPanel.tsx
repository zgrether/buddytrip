"use client";

import { useState } from "react";
import { Calendar } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { ItineraryView } from "../ItineraryView";
import { ItineraryIntroModal } from "../modals/ItineraryIntroModal";
import { InvitationCard } from "@/components/InvitationCard";
import type { TripData } from "../../types";

// ── Types ────────────────────────────────────────────────────────────────

interface ItineraryPanelProps {
  tripId: string;
  trip: TripData;
  isOwner: boolean;
  /** True once the owner has tapped "Add Itinerary" on the invitation card. */
  isActivated: boolean;
}

// ── Component ────────────────────────────────────────────────────────────

/**
 * ItineraryPanel — home tab panel for the day-by-day timeline.
 *
 * State machine:
 *   1. Member, not activated  → dim placeholder, no CTA
 *   2. Owner, not activated   → standard InvitationCard, opens
 *                               ItineraryIntroModal
 *   3. Activated              → ItineraryView renders directly (no panel
 *                               container). When activated-but-empty, the
 *                               empty state gets an X button to back out.
 *
 * The previous "no content" branch (a bare nudge to set dates from the
 * header) has been folded into the standard invitation card so all four
 * home-tab panels share the same opt-in affordance.
 */
export function ItineraryPanel({
  tripId,
  trip,
  isOwner,
  isActivated,
}: ItineraryPanelProps) {
  const [introOpen, setIntroOpen] = useState(false);
  const utils = trpc.useUtils();

  const enableItinerary = trpc.trips.enableItinerary.useMutation({
    async onMutate() {
      await utils.trips.getById.cancel({ tripId });
      const prev = utils.trips.getById.getData({ tripId });
      utils.trips.getById.setData({ tripId }, (old: TripData | undefined) =>
        old ? { ...old, itinerary_enabled: true } : old
      );
      return { prev };
    },
    onError(_e, _v, ctx) {
      if (ctx?.prev !== undefined) utils.trips.getById.setData({ tripId }, ctx.prev);
    },
    onSuccess() {
      setIntroOpen(false);
    },
    onSettled() {
      utils.trips.getById.invalidate({ tripId });
    },
  });

  const disableItinerary = trpc.trips.disableItinerary.useMutation({
    async onMutate() {
      await utils.trips.getById.cancel({ tripId });
      const prev = utils.trips.getById.getData({ tripId });
      utils.trips.getById.setData({ tripId }, (old: TripData | undefined) =>
        old ? { ...old, itinerary_enabled: false } : old
      );
      return { prev };
    },
    onError(_e, _v, ctx) {
      if (ctx?.prev !== undefined) utils.trips.getById.setData({ tripId }, ctx.prev);
    },
    onSettled() {
      utils.trips.getById.invalidate({ tripId });
    },
  });

  // ── State 4: live (no panel shell — view renders directly) ──────────
  if (isActivated) {
    return (
      <ItineraryView
        trip={trip}
        isOwner={isOwner}
        onCancel={isOwner ? () => disableItinerary.mutate({ tripId }) : undefined}
      />
    );
  }

  // ── State 1: member, not activated ───────────────────────────────────
  if (!isOwner) {
    return (
      <DimPlaceholder
        text="Your itinerary will appear here once the trip organizer sets it up."
      />
    );
  }

  // ── State 2: owner, not activated — standard invitation card ─────────
  return (
    <>
      <InvitationCard
        Icon={Calendar}
        title="Add Itinerary"
        body="Set your trip dates and your lodging, schedule, and travel info all slot into a day-by-day view."
        onClick={() => setIntroOpen(true)}
        testId="itinerary-invitation"
      />
      {introOpen && (
        <ItineraryIntroModal
          isOpen
          onClose={() => setIntroOpen(false)}
          onActivate={() => enableItinerary.mutate({ tripId })}
          isActivating={enableItinerary.isPending}
        />
      )}
    </>
  );
}

// ── DimPlaceholder ───────────────────────────────────────────────────────

function DimPlaceholder({ text }: { text: string }) {
  return (
    <div
      className="flex items-center gap-3 rounded-xl px-4 py-3.5"
      style={{
        background: "var(--color-bt-card)",
        border: "1px solid var(--color-bt-border)",
        opacity: 0.6,
      }}
    >
      <p
        className="text-[13px] leading-snug"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        {text}
      </p>
    </div>
  );
}

