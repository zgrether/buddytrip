"use client";

import { useState } from "react";
import { ArrowRight, Calendar, Lock } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { ItineraryView } from "../ItineraryView";
import { ItineraryIntroModal } from "../modals/ItineraryIntroModal";
import type { TripData } from "../../types";

// ── Types ────────────────────────────────────────────────────────────────

interface ItineraryPanelProps {
  tripId: string;
  trip: TripData;
  isOwner: boolean;
  /** True once the owner has tapped "Add Itinerary" on the invitation card. */
  isActivated: boolean;
  /** True if the trip has any itinerary-relevant content (dates / lodging / schedule / shared travel). */
  hasContent: boolean;
}

// ── Component ────────────────────────────────────────────────────────────

/**
 * ItineraryPanel — home tab panel for the day-by-day timeline.
 *
 * State machine:
 *   1. Member, not activated  → dim placeholder, no CTA
 *   2. Owner, no content      → dim "locked" card with lock icon, no CTA
 *   3. Owner, has content,
 *      not activated          → invitation card, opens ItineraryIntroModal
 *   4. Activated              → live ItineraryView wrapped in card-live shell
 */
export function ItineraryPanel({
  tripId,
  trip,
  isOwner,
  isActivated,
  hasContent,
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

  // ── State 4: live ────────────────────────────────────────────────────
  if (isActivated) {
    return (
      <CardShell title="Itinerary" subtitle={liveSubtitle(trip)}>
        <ItineraryView trip={trip} isOwner={isOwner} />
      </CardShell>
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

  // ── State 2: owner, no content (locked) ──────────────────────────────
  if (!hasContent) {
    return (
      <DimPlaceholder
        showLock
        text="Add dates, lodging, schedule items, or travel info to unlock your day-by-day view."
      />
    );
  }

  // ── State 3: owner, has content, invitation ──────────────────────────
  return (
    <>
      <InvitationCard
        Icon={Calendar}
        title="Add an Itinerary"
        body="Set your trip dates and your lodging, schedule, and travel info all slot into a day-by-day view."
        onClick={() => setIntroOpen(true)}
        testId="itinerary-invitation"
      />
      <ItineraryIntroModal
        isOpen={introOpen}
        onClose={() => setIntroOpen(false)}
        onActivate={() => enableItinerary.mutate({ tripId })}
        isActivating={enableItinerary.isPending}
      />
    </>
  );
}

// ── Helpers (shared with other panels in spirit; kept local for clarity) ─

function liveSubtitle(trip: TripData): string {
  const parts: string[] = [];
  if (trip.start_date && trip.end_date) {
    const start = new Date(trip.start_date + "T00:00:00");
    const end = new Date(trip.end_date + "T00:00:00");
    const startLabel = start.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const endLabel = end.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    parts.push(`${startLabel}–${endLabel}`);
    const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
    parts.push(`${days} day${days !== 1 ? "s" : ""}`);
  }
  return parts.join(" · ");
}

// ── DimPlaceholder ───────────────────────────────────────────────────────

function DimPlaceholder({ text, showLock }: { text: string; showLock?: boolean }) {
  return (
    <div
      className="flex items-center gap-3 rounded-xl px-4 py-3.5"
      style={{
        background: "var(--color-bt-card)",
        border: "1px solid var(--color-bt-border)",
        opacity: 0.6,
      }}
    >
      {showLock && (
        <Lock size={16} style={{ color: "var(--color-bt-text-dim)", flexShrink: 0 }} />
      )}
      <p
        className="text-[13px] leading-snug"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        {text}
      </p>
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
  Icon: typeof Calendar;
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
          <p
            className="text-sm font-bold"
            style={{ color: "var(--color-bt-text)" }}
          >
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
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
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
        <Calendar size={14} style={{ color: "var(--color-bt-accent)" }} />
        <p
          className="text-[13px] font-bold"
          style={{ color: "var(--color-bt-text)" }}
        >
          {title}
        </p>
        {subtitle && (
          <p
            className="ml-auto text-[11px]"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            {subtitle}
          </p>
        )}
      </div>
      <div className="px-4 py-4">{children}</div>
    </div>
  );
}
