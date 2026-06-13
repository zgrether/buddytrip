"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { Trophy } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { useRealtimeCompetition } from "@/hooks/useRealtimeCompetition";
import { TopNav } from "@/components/TopNav";
import { TripBottomNav } from "@/components/BottomNav";
import { CompetitionLeaderboard } from "@/components/competition/CompetitionLeaderboard";

/**
 * Live Leaderboard — Tier-1 competition standings view (Slice D2).
 *
 * Renders the CompetitionLeaderboard hero: 2-team head-to-head or N-team ranked
 * list, magic number, session breakdown, clinch state. Data comes from the
 * competitions.leaderboard query (no realtime subscription in D2 scope — the
 * component polls on a 30-second interval; a future realtime invalidation can
 * drop in without a rewrite). The owner's scoreboard-style picker (8 variants)
 * stays on the Comp tab (ScoreboardPanel); this page is the dedicated hero view.
 *
 * Shows a placeholder when the competition isn't live (status !== "active").
 */
export default function LiveLeaderboardPage() {
  const { tripId } = useParams<{ tripId: string }>();

  // Realtime subscription so the leaderboard reflects owner changes
  // (Go Live toggle) without a refresh.
  useRealtimeCompetition(tripId);

  const { data: competition, isLoading } = trpc.competitions.getByTrip.useQuery({
    tripId,
  });

  return (
    <div
      className="min-h-screen"
      style={{ background: "var(--color-bt-base)", color: "var(--color-bt-text)" }}
    >
      <TopNav />
      <div className="mx-auto max-w-[1024px] px-4 pt-4 pb-24">
        {isLoading ? null : !competition || competition.status !== "active" ? (
          <NotLiveEmptyState tripId={tripId} />
        ) : (
          <div className="space-y-3">
            <div className="px-1">
              <h1
                className="text-2xl font-bold"
                style={{ color: "var(--color-bt-text)" }}
              >
                {competition.name}
              </h1>
              {competition.tagline && (
                <p
                  className="mt-1 text-sm"
                  style={{ color: "var(--color-bt-text-dim)" }}
                >
                  {competition.tagline}
                </p>
              )}
            </div>
            <CompetitionLeaderboard
              competitionId={competition.id}
              tripId={tripId}
            />
          </div>
        )}
      </div>

      {competition?.status === "active" && (
        <TripBottomNav tripId={tripId} showComp={true} />
      )}
    </div>
  );
}

function NotLiveEmptyState({ tripId }: { tripId: string }) {
  return (
    <div
      className="mt-6 flex flex-col items-center justify-center rounded-xl px-6 py-16 text-center"
      style={{
        background: "var(--color-bt-card)",
        border: "1px solid var(--color-bt-border)",
      }}
    >
      <div
        className="flex h-16 w-16 items-center justify-center rounded-2xl"
        style={{
          background: "var(--color-bt-accent-faint)",
          color: "var(--color-bt-accent)",
        }}
      >
        <Trophy size={28} />
      </div>
      <h2
        className="mt-4 text-lg font-semibold"
        style={{ color: "var(--color-bt-text)" }}
      >
        Competition isn&rsquo;t live yet
      </h2>
      <p
        className="mt-2 max-w-xs text-sm leading-relaxed"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        The organizer hasn&rsquo;t flipped this to live. The scoreboard will
        appear here once they hit Go Live.
      </p>
      <Link
        href={`/trips/${tripId}`}
        className="mt-5 inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold"
        style={{
          background: "var(--color-bt-card-raised)",
          color: "var(--color-bt-text)",
          border: "1px solid var(--color-bt-border)",
        }}
      >
        Back to trip
      </Link>
    </div>
  );
}
