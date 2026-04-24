"use client";

import type { ReactNode } from "react";
import { Sparkles } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import type { TripData } from "../types";
import { DatePollCard } from "./DatePollCard";
import { DatesPanel } from "../../components/DatesPanel";
import { InvitationCard } from "./InvitationCard";
import { ActionCard } from "./ActionCard";
import { TravelEntryForm } from "../../components/TravelEntryForm";

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
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: "12px",
          }}
        >
          <InvitationCard trip={trip} isOwner={isOwner} onWriteInvitation={onWriteInvitation} />
          <TravelCard trip={trip} isOwner={isOwner} />
        </div>
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

// ── Travel Card ──────────────────────────────────────────────────────────────

function TravelCard({ trip, isOwner }: { trip: TripData; isOwner: boolean }) {
  const tripId = trip.id;
  const travelEnabled = !!trip.travel_enabled;
  const currentUser = useCurrentUser();
  const utils = trpc.useUtils();
  const { data: members = [] } = trpc.tripMembers.list.useQuery({ tripId });

  const myMember = members.find((m) => m.user_id === currentUser?.id);

  const updateSettings = trpc.trips.updateActionCenterSettings.useMutation({
    async onMutate(vars) {
      await utils.trips.getById.cancel({ tripId });
      const prev = utils.trips.getById.getData({ tripId });
      utils.trips.getById.setData({ tripId }, (old: unknown) => {
        if (!old) return old;
        return {
          ...(old as Record<string, unknown>),
          ...(vars.travelEnabled !== undefined ? { travel_enabled: vars.travelEnabled } : {}),
        } as typeof old;
      });
      return { prev };
    },
    onError(_err, _vars, context) {
      if (context?.prev) utils.trips.getById.setData({ tripId }, context.prev);
    },
    onSettled() {
      utils.trips.getById.invalidate({ tripId });
    },
  });

  if (!isOwner && !travelEnabled) return null;

  return (
    <ActionCard isResolved={false}>
      <p
        className="mb-2 text-xs font-semibold uppercase tracking-wider"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        Travel
      </p>

      {isOwner && (
        <div
          className="mb-4 flex flex-col gap-2 rounded-lg px-3 py-2.5"
          style={{
            background: "var(--color-bt-card-raised)",
            border: "1px solid var(--color-bt-border)",
          }}
        >
          <ToggleRow
            label="Share travel info"
            checked={travelEnabled}
            onChange={(v) => updateSettings.mutate({ tripId, travelEnabled: v })}
            testid="toggle-travel-enabled"
          />
        </div>
      )}

      {travelEnabled ? (
        <>
          <p
            className="mb-3 text-[13px] leading-relaxed"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            {isOwner
              ? "You're the host — share your travel plans so the crew can coordinate."
              : "Share your travel plans so the crew can coordinate."}
          </p>
          <TravelEntryForm
            tripId={tripId}
            currentTravel={myMember as Parameters<typeof TravelEntryForm>[0]["currentTravel"]}
          />
        </>
      ) : (
        <p
          className="text-[13px] leading-relaxed"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          Enable travel sharing so the crew can coordinate arrival plans.
        </p>
      )}
    </ActionCard>
  );
}

// ── Small inline toggle row ──────────────────────────────────────────────────

function ToggleRow({
  label,
  checked,
  disabled,
  onChange,
  testid,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
  testid: string;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3">
      <span
        className="min-w-0 flex-1 text-[13px] font-medium"
        style={{ color: "var(--color-bt-text)" }}
      >
        {label}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        data-testid={testid}
        onClick={() => onChange(!checked)}
        className="relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors disabled:opacity-50"
        style={{
          background: checked ? "var(--color-bt-accent)" : "var(--color-bt-border)",
        }}
      >
        <span
          className="inline-block h-4 w-4 transform rounded-full bg-white transition-transform"
          style={{ transform: checked ? "translateX(18px)" : "translateX(2px)" }}
        />
      </button>
    </label>
  );
}
