"use client";

import { useState } from "react";
import { Plane } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { GettingThereSection } from "../GettingThereSection";
import { GettingThereIntroModal } from "../modals/GettingThereIntroModal";
import { InvitationCard } from "@/components/InvitationCard";
import type { TripData } from "../../types";

// ── Types ────────────────────────────────────────────────────────────────

interface GettingTherePanelProps {
  tripId: string;
  trip: TripData;
  isOwner: boolean;
  isActivated: boolean;
  /**
   * @deprecated — no longer affects rendering. The previous "Set your trip
   * dates first…" locked card has been retired now that dates live in the
   * header; the invitation card is the entry point regardless of dates.
   * Kept on the prop type for back-compat with existing call sites.
   */
  hasDates?: boolean;
}

// ── Component ────────────────────────────────────────────────────────────

/**
 * GettingTherePanel — home tab panel for travel coordination.
 *
 * State machine:
 *   1. Member, not activated   → dim placeholder, no CTA
 *   2. Owner, not activated    → invitation card → opens GettingThereIntroModal
 *   3. Activated               → live GettingThereSection in CardShell
 */
export function GettingTherePanel({
  tripId,
  isOwner,
  isActivated,
}: GettingTherePanelProps) {
  const [introOpen, setIntroOpen] = useState(false);
  const utils = trpc.useUtils();

  const enableGettingThere = trpc.trips.enableGettingThere.useMutation({
    async onMutate() {
      await utils.trips.getById.cancel({ tripId });
      const prev = utils.trips.getById.getData({ tripId });
      utils.trips.getById.setData({ tripId }, (old: TripData | undefined) =>
        old ? { ...old, getting_there_enabled: true } : old
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

  const disableGettingThere = trpc.trips.disableGettingThere.useMutation({
    async onMutate() {
      await utils.trips.getById.cancel({ tripId });
      const prev = utils.trips.getById.getData({ tripId });
      utils.trips.getById.setData({ tripId }, (old: TripData | undefined) =>
        old ? { ...old, getting_there_enabled: false } : old
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

  // ── State 4: live (no panel shell — section renders directly) ───────
  if (isActivated) {
    return (
      <GettingThereSection
        tripId={tripId}
        isOwner={isOwner}
        onCancel={isOwner ? () => disableGettingThere.mutate({ tripId }) : undefined}
      />
    );
  }

  // ── State 1: member, not activated ───────────────────────────────────
  if (!isOwner) {
    return (
      <DimLockedCard
        text="Travel coordination will appear here once the trip organizer sets it up."
      />
    );
  }

  // ── State 2: owner, not activated, invitation ────────────────────────
  return (
    <>
      <InvitationCard
        Icon={Plane}
        title="Coordinate Travel Plans"
        body="Share travel plans so the crew can coordinate arrivals and no one's left waiting at the airport."
        onClick={() => setIntroOpen(true)}
        testId="getting-there-invitation"
      />
      {introOpen && (
        <GettingThereIntroModal
          isOpen
          onClose={() => setIntroOpen(false)}
          onActivate={() => enableGettingThere.mutate({ tripId })}
          isActivating={enableGettingThere.isPending}
        />
      )}
    </>
  );
}

// ── DimLockedCard ────────────────────────────────────────────────────────

function DimLockedCard({ text }: { text: string }) {
  return (
    <div
      className="rounded-xl px-4 py-3.5"
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
