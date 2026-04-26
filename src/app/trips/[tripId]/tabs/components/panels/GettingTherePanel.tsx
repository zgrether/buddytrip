"use client";

import { useState } from "react";
import { ArrowRight, Lock, Plane } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { GettingThereSection } from "../GettingThereSection";
import { GettingThereIntroModal } from "../modals/GettingThereIntroModal";
import type { TripData } from "../../types";

// ── Types ────────────────────────────────────────────────────────────────

interface GettingTherePanelProps {
  tripId: string;
  trip: TripData;
  isOwner: boolean;
  isActivated: boolean;
  hasDates: boolean;
  /** Caller-supplied opener for the dates modal — used by the locked state's "Set dates →" link. */
  onOpenDatesModal?: () => void;
}

// ── Component ────────────────────────────────────────────────────────────

/**
 * GettingTherePanel — home tab panel for travel coordination.
 *
 * State machine:
 *   1. No dates set            → dim locked card; owner sees "Set dates →"
 *   2. Member, not activated   → dim placeholder, no CTA
 *   3. Owner, dates set,
 *      not activated           → invitation card → opens GettingThereIntroModal
 *   4. Activated               → live GettingThereSection in CardShell
 */
export function GettingTherePanel({
  tripId,
  isOwner,
  isActivated,
  hasDates,
  onOpenDatesModal,
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

  // ── State 4: live ────────────────────────────────────────────────────
  if (isActivated) {
    return (
      <CardShell title="Getting There">
        <GettingThereSection tripId={tripId} isOwner={isOwner} />
      </CardShell>
    );
  }

  // ── State 1: no dates set ────────────────────────────────────────────
  if (!hasDates) {
    return (
      <DimLockedCard
        text="Set your trip dates first to coordinate travel arrivals."
        actionLabel={isOwner ? "Set dates →" : undefined}
        onAction={onOpenDatesModal}
      />
    );
  }

  // ── State 2: member, not activated ───────────────────────────────────
  if (!isOwner) {
    return (
      <DimLockedCard
        text="Travel coordination will appear here once the trip organizer sets it up."
      />
    );
  }

  // ── State 3: owner, dates set, invitation ────────────────────────────
  return (
    <>
      <InvitationCard
        Icon={Plane}
        title="Add Travel Coordination"
        body="Share travel plans so the crew can coordinate arrivals and no one's left waiting at the airport."
        onClick={() => setIntroOpen(true)}
        testId="getting-there-invitation"
      />
      <GettingThereIntroModal
        isOpen={introOpen}
        onClose={() => setIntroOpen(false)}
        onActivate={() => enableGettingThere.mutate({ tripId })}
        isActivating={enableGettingThere.isPending}
      />
    </>
  );
}

// ── DimLockedCard ────────────────────────────────────────────────────────

function DimLockedCard({
  text,
  actionLabel,
  onAction,
}: {
  text: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div
      className="flex items-center gap-3 rounded-xl px-4 py-3.5"
      style={{
        background: "var(--color-bt-card)",
        border: "1px solid var(--color-bt-border)",
        opacity: actionLabel ? 0.85 : 0.6,
      }}
    >
      <Lock size={16} style={{ color: "var(--color-bt-text-dim)", flexShrink: 0 }} />
      <p
        className="flex-1 text-[13px] leading-snug"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        {text}
      </p>
      {actionLabel && (
        <button
          type="button"
          onClick={onAction}
          className="flex-shrink-0 text-xs font-semibold"
          style={{
            color: "var(--color-bt-accent)",
            background: "transparent",
            border: "none",
            cursor: "pointer",
          }}
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

// ── InvitationCard ───────────────────────────────────────────────────────

function InvitationCard({
  Icon,
  title,
  body,
  onClick,
  testId,
}: {
  Icon: typeof Plane;
  title: string;
  body: string;
  onClick: () => void;
  testId?: string;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      data-testid={testId}
      className="w-full rounded-xl px-4 py-5 text-left transition-colors"
      style={{
        background: hover
          ? "var(--color-bt-accent-faint)"
          : "var(--color-bt-surface-invitation)",
        border: `1.5px dashed ${
          hover ? "var(--color-bt-accent-border)" : "var(--color-bt-border)"
        }`,
        cursor: "pointer",
      }}
    >
      <div className="flex items-start gap-3">
        <div
          className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl"
          style={{
            background: "var(--color-bt-accent-faint)",
            color: "var(--color-bt-accent)",
          }}
        >
          <Icon size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold" style={{ color: "var(--color-bt-text)" }}>
            {title}
          </p>
          <p
            className="mt-1 text-xs leading-snug"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            {body}
          </p>
        </div>
        <ArrowRight
          size={16}
          style={{
            color: "var(--color-bt-accent)",
            flexShrink: 0,
            opacity: hover ? 1 : 0,
            transition: "opacity 150ms",
          }}
        />
      </div>
    </button>
  );
}

// ── CardShell ────────────────────────────────────────────────────────────

function CardShell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="overflow-hidden rounded-xl"
      style={{
        background: "var(--color-bt-card)",
        border: "1px solid var(--color-bt-border)",
      }}
    >
      <div
        className="flex items-center gap-2 px-4 py-3"
        style={{ borderBottom: "1px solid var(--color-bt-border)" }}
      >
        <Plane size={14} style={{ color: "var(--color-bt-accent)" }} />
        <p className="text-[13px] font-bold" style={{ color: "var(--color-bt-text)" }}>
          {title}
        </p>
      </div>
      <div className="px-4 py-4">{children}</div>
    </div>
  );
}
