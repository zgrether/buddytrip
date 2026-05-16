"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { Trophy } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { useTripRole } from "@/hooks/useTripRole";
import { TopNav } from "@/components/TopNav";
import { TripBottomNav } from "@/components/BottomNav";
import { ScoreboardPanel } from "@/components/competition/ScoreboardPanel";

/**
 * Live Leaderboard — renders the owner's chosen scoreboard style.
 *
 * Drops the old 4-tab placeholder (Overview / Groups / Trip Info /
 * History). Now this page is just the styled scoreboard. The owner
 * picks the style from the comp tab; everyone else sees whatever was
 * picked. Mock data lives in localStorage via the event detail page
 * until the real scoring API ships.
 *
 * Shows a placeholder when the competition isn't live yet (status !==
 * "active"). The bottom-nav Live entry only renders when status ===
 * "active", so most users shouldn't see that state — it's a fallback
 * for hard URL loads.
 */
export default function LiveLeaderboardPage() {
  const { tripId } = useParams<{ tripId: string }>();
  const { isOwner } = useTripRole(tripId);

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
            <ScoreboardPanel
              competitionId={competition.id}
              tripId={tripId}
              isOwner={!!isOwner}
            />
          </div>
        )}
      </div>

      {/* Bottom nav — only render when the comp is live (matches
          page.tsx). Live tab will highlight as active since pathname
          matches its href. When not live, the inline CTA in the empty
          state handles navigation back. */}
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
