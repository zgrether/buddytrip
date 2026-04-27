"use client";

import { useRouter } from "next/navigation";
import { ChevronRight, Trophy } from "lucide-react";
import { trpc } from "@/lib/trpc-client";

// ── Types ────────────────────────────────────────────────────────────────

interface CompetitionStripProps {
  tripId: string;
  /** trip.event_id from the parent — if null/undefined, the strip renders nothing. */
  eventId: string | null | undefined;
}

// ── Component ────────────────────────────────────────────────────────────

/**
 * CompetitionStrip — persistent compact leaderboard summary that lives
 * between the trip header and the tab bar. Visible to all trip members
 * once a competition exists, regardless of which tab they're on.
 *
 * Replaces the live state of the home-tab CompetitionPanel. The panel
 * still owns the invitation/setup CTA when no competition exists; once
 * activated, the panel returns null and this strip is the only surface.
 */
export function CompetitionStrip({ tripId, eventId }: CompetitionStripProps) {
  const router = useRouter();

  const { data: event } = trpc.events.getByTrip.useQuery(
    { tripId },
    { enabled: !!eventId }
  );

  const knownEventId = event?.id ?? eventId ?? "";
  const { data: teams = [] } = trpc.teams.list.useQuery(
    { tripId, eventId: knownEventId },
    { enabled: !!knownEventId }
  );
  const { data: scoreRows = [] } = trpc.groupResults.listScoresByEvent.useQuery(
    { tripId, eventId: knownEventId },
    { enabled: !!knownEventId }
  );

  if (!eventId || !event) return null;

  const teamTotals = teams
    .map((t) => ({
      ...t,
      total: scoreRows
        .filter((r) => r.team_id === t.id)
        .reduce((sum, r) => sum + (r.total_points ?? 0), 0),
    }))
    .sort((a, b) => b.total - a.total);

  return (
    <button
      type="button"
      onClick={() => router.push(`/trips/${tripId}/leaderboard`)}
      data-testid="competition-strip"
      className="w-full overflow-hidden rounded-xl px-3 py-2.5 text-left transition-opacity hover:opacity-90"
      style={{
        background: "var(--color-bt-tag-bg)",
        border: "1px solid var(--color-bt-accent-border)",
      }}
    >
      <div className="flex items-center gap-3">
        <div className="flex flex-1 items-center gap-2 min-w-0">
          <Trophy size={14} style={{ color: "var(--color-bt-accent)", flexShrink: 0 }} />
          <p
            className="truncate text-[11px] font-bold uppercase tracking-wider"
            style={{ color: "var(--color-bt-accent)" }}
          >
            {event.title ?? "Competition"}
          </p>
        </div>

        {/* Compact team scores — inline, takes minimal horizontal space */}
        {teamTotals.length > 0 ? (
          <div className="flex items-center gap-2 flex-shrink-0">
            {teamTotals.map((team, i) => (
              <span key={team.id} className="flex items-center gap-1">
                <span
                  className="text-[10px] font-bold"
                  style={{ color: team.color }}
                >
                  {team.short_name}
                </span>
                <span
                  className="text-xs font-extrabold tabular-nums"
                  style={{ color: "var(--color-bt-text)" }}
                >
                  {team.total}
                </span>
                {i < teamTotals.length - 1 && (
                  <span
                    aria-hidden
                    className="text-[10px]"
                    style={{ color: "var(--color-bt-text-dim)" }}
                  >
                    ·
                  </span>
                )}
              </span>
            ))}
          </div>
        ) : (
          <span
            className="text-[11px]"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            No scores yet
          </span>
        )}

        <ChevronRight
          size={14}
          style={{ color: "var(--color-bt-accent)", flexShrink: 0 }}
        />
      </div>
    </button>
  );
}
