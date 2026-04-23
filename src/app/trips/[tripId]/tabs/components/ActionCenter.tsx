"use client";

import type { ReactNode } from "react";
import { Sparkles } from "lucide-react";
import type { TripData } from "../types";
import { DatePollCard } from "./DatePollCard";
import { DatesPanel } from "../../components/DatesPanel";
import { InvitationCard } from "./InvitationCard";

export interface ActionCenterProps {
  trip: TripData;
  isOwner: boolean;
  canEdit: boolean;
  onTabChange?: (tab: string) => void;
  onWriteInvitation?: () => void;
  /** Optional right-aligned node rendered inline with the "Action Center"
   *  title — e.g. the Trip Summary button. */
  titleAction?: ReactNode;
}

/**
 * ActionCenter — the single "what needs your attention" surface shown
 * during the PLANNING stage. Three clean states:
 *
 * 1. datesLocked = true  → "You're all set" idle state
 * 2. datesLocked = false, pollMode = false
 *      → DatesPanel (date pickers + Poll the crew button)
 * 3. datesLocked = false, pollMode = true
 *      → DatesPanel (collapsed flat row + cancel button)
 *        + DatePollCard below it
 *
 * DatesPanel is removed from PlanningSection; it lives here exclusively.
 * Future cards (RsvpCard, TravelCard) slot in alongside the dates surface.
 */
export function ActionCenter({ trip, isOwner, canEdit, onTabChange, onWriteInvitation, titleAction }: ActionCenterProps) {
  const stage = trip.stage ?? "idea";
  if (stage !== "idea" && stage !== "planning" && stage !== "going") return null;

  const datesLocked = !!(trip.start_date && trip.end_date);
  const pollMode = !!trip.poll_mode;

  // ── GOING stage ────────────────────────────────────────────────────────
  // In the going stage the Action Center's primary card is the host's
  // invitation and (optionally) the travel-sharing form.
  if (stage === "going") {
    return (
      <section className="space-y-3">
        <ActionCenterHeader titleAction={titleAction} />
        <InvitationCard trip={trip} isOwner={isOwner} onWriteInvitation={onWriteInvitation} />
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <ActionCenterHeader titleAction={titleAction} />

      {datesLocked ? (
        // Dates locked — nothing to do
        <ActionCenterIdle isOwner={isOwner} />
      ) : isOwner ? (
        // Owner view: DatesPanel is a two-button state machine that
        // internally expands to embed DatePollCard when the poll is active.
        <DatesPanel
          trip={trip}
          canEdit={canEdit}
          isOwner={isOwner}
          isOpen={true}
          onToggle={() => {}}
          onTabChange={onTabChange}
        />
      ) : pollMode ? (
        // Non-owner view: DatesPanel is hidden entirely — the DatePollCard
        // is the only surface they need to see / interact with.
        <DatePollCard
          trip={trip}
          isOwner={isOwner}
          onManageCrew={canEdit && onTabChange ? () => onTabChange("crew") : undefined}
        />
      ) : (
        // Non-owner, no poll yet — host hasn't started anything.
        <ActionCenterIdle isOwner={isOwner} />
      )}

      {/* TODO: RsvpCard + TravelCard slot in here in later phases */}
    </section>
  );
}

/**
 * Header row — "Action Center" label on the left, optional action slot
 * (Trip Summary button) right-aligned. Slot stays out of the card panel
 * so the title stays visually distinct from the card chrome.
 */
function ActionCenterHeader({ titleAction }: { titleAction?: ReactNode }) {
  return (
    <div className="flex min-h-[2rem] items-center justify-between gap-2">
      <p
        className="text-xs font-semibold uppercase tracking-wider"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        Action Center
      </p>
      {titleAction}
    </div>
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
