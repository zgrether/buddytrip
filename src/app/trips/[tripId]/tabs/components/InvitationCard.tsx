"use client";

import { ArrowRight, Mail } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import type { TripData } from "../types";

export interface InvitationCardProps {
  trip: TripData;
  isOwner?: boolean;
  onWriteInvitation?: () => void;
  onTabChange?: (tab: string) => void;
}

/**
 * InvitationCard — compact nudge in the going-stage Action Center.
 *
 * The full crew-email UI (editable message, recipient checklist, send button)
 * lives in CrewEmailPanel on the Crew tab. This card just surfaces a hint
 * when there's something worth doing, routing owners over to the Crew tab.
 */
export function InvitationCard({ trip, isOwner = false, onTabChange }: InvitationCardProps) {
  const tripId = trip.id;
  const currentUser = useCurrentUser();
  const { data: members = [] } = trpc.tripMembers.list.useQuery({ tripId });

  if (!isOwner) return null;

  const lastBlastSentAt = trip.last_blast_sent_at ?? null;
  const others = members.filter((m) => m.user_id !== currentUser?.id);
  const unlinkedCount = others.filter((m) => m.isGuest).length;

  if (unlinkedCount > 0) {
    return (
      <NudgeCard
        title={`${unlinkedCount} ${unlinkedCount === 1 ? "person hasn't" : "people haven't"} joined the app yet`}
        subtitle="Send them an email so they can RSVP and see the plan."
        cta="Go to Crew"
        onClick={() => onTabChange?.("crew")}
      />
    );
  }

  if (!lastBlastSentAt) {
    return (
      <NudgeCard
        title="Everyone's in the app — send a welcome?"
        subtitle="Blast the crew a quick note that the trip is on."
        cta="Go to Crew"
        onClick={() => onTabChange?.("crew")}
      />
    );
  }

  return null;
}

// ── Nudge card ──────────────────────────────────────────────────────────────

function NudgeCard({
  title,
  subtitle,
  cta,
  onClick,
}: {
  title: string;
  subtitle: string;
  cta: string;
  onClick?: () => void;
}) {
  return (
    <div
      className="flex items-start gap-3 rounded-xl px-4 py-3.5"
      style={{
        background: "var(--color-bt-card)",
        border: "1px solid var(--color-bt-border)",
      }}
      data-testid="invitation-desktop-nudge"
    >
      <span
        className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg"
        style={{
          background: "var(--color-bt-accent-faint)",
          color: "var(--color-bt-accent)",
        }}
      >
        <Mail size={14} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-semibold leading-tight" style={{ color: "var(--color-bt-text)" }}>
          {title}
        </p>
        <p className="mt-0.5 text-[12px] leading-snug" style={{ color: "var(--color-bt-text-dim)" }}>
          {subtitle}
        </p>
      </div>
      {onClick && (
        <button
          type="button"
          onClick={onClick}
          className="flex flex-shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-opacity hover:opacity-80"
          style={{
            color: "var(--color-bt-accent)",
            background: "transparent",
            border: "1px solid var(--color-bt-accent-border)",
          }}
        >
          {cta}
          <ArrowRight size={12} />
        </button>
      )}
    </div>
  );
}
