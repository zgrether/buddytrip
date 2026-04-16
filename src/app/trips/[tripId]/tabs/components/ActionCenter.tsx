"use client";

import { Sparkles } from "lucide-react";
import type { TripData } from "../types";
import { DatePollCard } from "./DatePollCard";

export interface ActionCenterProps {
  trip: TripData;
  isOwner: boolean;
}

/**
 * ActionCenter — member-facing "what needs your attention" surface shown
 * during the IDEA and PLANNING stages.
 *
 * Mirrors DatesPlanningRow's visibility contract: the date poll can be
 * open in either stage, so ActionCenter must surface DatePollCard in both
 * or non-owners would have no way to see / vote on the poll.
 *
 * When no card has anything actionable to surface (e.g. dates are locked
 * and there's no poll in progress), we render a soft placeholder instead
 * of unmounting the whole section — the user asked us to avoid the
 * "panels vanish" transition whiplash.
 *
 * Future cards (RsvpCard, TravelCard) slot in alongside DatePollCard.
 */
export function ActionCenter({ trip, isOwner }: ActionCenterProps) {
  const stage = trip.stage ?? "idea";
  if (stage !== "idea" && stage !== "planning") return null;

  const pollMode = !!trip.poll_mode;
  // Future: also roll up RsvpCard / TravelCard "has action?" flags here.
  const hasActionableCard = pollMode;

  return (
    <section className="space-y-3">
      <p
        className="text-xs font-semibold uppercase tracking-wider"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        Action Center
      </p>
      {pollMode && <DatePollCard trip={trip} isOwner={isOwner} />}
      {!hasActionableCard && <ActionCenterIdle isOwner={isOwner} />}
      {/* TODO: RsvpCard + TravelCard slot in here in later phases */}
    </section>
  );
}

/**
 * Idle-state placeholder — shown when no card has a pending action.
 * Kept small and low-contrast so it reads as "you're all set" rather
 * than competing with real action cards when they appear later.
 */
function ActionCenterIdle({ isOwner }: { isOwner: boolean }) {
  return (
    <div
      className="flex items-start gap-3 rounded-xl px-4 py-3.5 transition-opacity duration-300"
      style={{
        background: "var(--color-bt-card)",
        border: "1px dashed var(--color-bt-border)",
      }}
    >
      <span
        className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg"
        style={{
          background: "var(--color-bt-card-raised)",
          color: "var(--color-bt-accent)",
        }}
      >
        <Sparkles size={14} />
      </span>
      <div className="min-w-0 flex-1">
        <p
          className="text-[14px] font-semibold leading-tight"
          style={{ color: "var(--color-bt-text)" }}
        >
          You&apos;re all set
        </p>
        <p
          className="mt-0.5 text-[12px] leading-snug"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          {isOwner
            ? "Nothing needed from the crew right now. New action cards will show up here as the trip progresses."
            : "Nothing needed from you at the moment — we'll let you know when the host has something for you to respond to."}
        </p>
      </div>
    </div>
  );
}
