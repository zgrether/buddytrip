"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ChevronRight, Trophy } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { CompetitionIntroModal } from "../modals/CompetitionIntroModal";

// ── Types ────────────────────────────────────────────────────────────────

interface CompetitionPanelProps {
  tripId: string;
  isOwner: boolean;
  /** True once the trip has an event_id (i.e. competition has been set up). */
  isActivated: boolean;
  /** Caller-supplied callback that runs the existing comp-setup flow on confirm. */
  onSetupComp: (() => void) | undefined;
}

// ── Component ────────────────────────────────────────────────────────────

/**
 * CompetitionPanel — home tab panel for competition / leaderboard.
 *
 * State machine:
 *   1. Member, not activated  → render nothing
 *   2. Owner, not activated   → invitation card → opens CompetitionIntroModal
 *   3. Activated              → live leaderboard summary in CardShell
 */
export function CompetitionPanel({
  tripId,
  isOwner,
  isActivated,
  onSetupComp,
}: CompetitionPanelProps) {
  const router = useRouter();
  const [introOpen, setIntroOpen] = useState(false);

  const { data: event } = trpc.events.getByTrip.useQuery(
    { tripId },
    { enabled: isActivated }
  );

  const knownEventId = event?.id ?? "";
  const { data: teams = [] } = trpc.teams.list.useQuery(
    { tripId, eventId: knownEventId },
    { enabled: !!knownEventId }
  );
  const { data: scoreRows = [] } = trpc.groupResults.listScoresByEvent.useQuery(
    { tripId, eventId: knownEventId },
    { enabled: !!knownEventId }
  );

  // ── State 3: live ────────────────────────────────────────────────────
  if (isActivated && event) {
    const teamTotals = teams
      .map((t) => ({
        ...t,
        total: scoreRows
          .filter((r) => r.team_id === t.id)
          .reduce((sum, r) => sum + (r.total_points ?? 0), 0),
      }))
      .sort((a, b) => b.total - a.total);

    return (
      <CardShell
        title={event.title ?? "Competition"}
        subtitle="Leaderboard"
        onClick={() => router.push(`/trips/${tripId}/leaderboard`)}
      >
        {teamTotals.length > 0 ? (
          <div className="flex gap-2">
            {teamTotals.map((team) => (
              <div
                key={team.id}
                className="flex-1 rounded-lg p-2 text-center"
                style={{
                  background: "var(--color-bt-base)",
                  border: "1px solid var(--color-bt-border)",
                }}
              >
                <p
                  className="mb-0.5 truncate text-[10px] font-semibold"
                  style={{ color: team.color }}
                >
                  {team.short_name}
                </p>
                <p
                  className="text-lg font-bold"
                  style={{ color: "var(--color-bt-text)" }}
                >
                  {team.total}
                </p>
                <p
                  className="text-[10px]"
                  style={{ color: "var(--color-bt-text-dim)" }}
                >
                  pts
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
            No scores yet
          </p>
        )}
      </CardShell>
    );
  }

  // ── State 1: member, not activated ───────────────────────────────────
  if (!isOwner) {
    return null;
  }

  // ── State 2: owner, not activated, invitation ────────────────────────
  return (
    <>
      <InvitationCard
        title="Add a Competition"
        body="Your group already has a rivalry. Give it a scoreboard, teams, and a live leaderboard."
        onClick={() => setIntroOpen(true)}
      />
      <CompetitionIntroModal
        isOpen={introOpen}
        onClose={() => setIntroOpen(false)}
        onActivate={() => {
          setIntroOpen(false);
          onSetupComp?.();
        }}
        isActivating={false}
      />
    </>
  );
}

// ── InvitationCard ───────────────────────────────────────────────────────

function InvitationCard({
  title,
  body,
  onClick,
}: {
  title: string;
  body: string;
  onClick: () => void;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      data-testid="competition-invitation"
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
          <Trophy size={18} />
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
  subtitle,
  children,
  onClick,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  const Inner = (
    <>
      <div
        className="flex items-center gap-2 px-4 py-3"
        style={{ borderBottom: "1px solid var(--color-bt-border)" }}
      >
        <Trophy size={14} style={{ color: "var(--color-bt-accent)" }} />
        <p
          className="text-[13px] font-bold"
          style={{ color: "var(--color-bt-text)" }}
        >
          {title}
        </p>
        {subtitle && (
          <p
            className="ml-auto flex items-center gap-0.5 text-[11px] font-semibold"
            style={{ color: "var(--color-bt-accent)" }}
          >
            {subtitle}
            {onClick && <ChevronRight size={12} />}
          </p>
        )}
      </div>
      <div className="px-4 py-4">{children}</div>
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        data-testid="competition-panel"
        className="w-full overflow-hidden rounded-xl text-left"
        style={{
          background: "var(--color-bt-card)",
          border: "1px solid var(--color-bt-border)",
        }}
      >
        {Inner}
      </button>
    );
  }

  return (
    <div
      className="overflow-hidden rounded-xl"
      style={{
        background: "var(--color-bt-card)",
        border: "1px solid var(--color-bt-border)",
      }}
    >
      {Inner}
    </div>
  );
}
