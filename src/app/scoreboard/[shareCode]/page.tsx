"use client";

import { useParams } from "next/navigation";
import { Trophy } from "lucide-react";
import { trpc } from "@/lib/trpc-client";

/**
 * Public scoreboard — STUBBED in Phase A.
 *
 * Migration 062 rebuilt the competition schema; the share record now
 * resolves to a competition (not the legacy event shape). Live scores
 * will return in Phase B against the rebuilt schema. Until then we show
 * the competition's name (so the share link still feels purposeful) and
 * an explicit placeholder.
 */
export default function PublicScoreboardPage() {
  const { shareCode } = useParams<{ shareCode: string }>();
  const { data, isLoading, error } = trpc.scoreboardShares.getScoreboard.useQuery(
    { shareCode },
    { enabled: !!shareCode }
  );

  const headline =
    (data?.competition as { name?: string } | null)?.name ?? "BuddyTrip Scoreboard";

  return (
    <div
      className="flex min-h-screen items-center justify-center px-4"
      style={{ background: "var(--color-bt-base)", color: "var(--color-bt-text)" }}
    >
      <div
        className="flex w-full max-w-md flex-col items-center justify-center rounded-xl px-6 py-16 text-center"
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
        <h1
          className="mt-4 text-xl font-bold"
          style={{ color: "var(--color-bt-text)" }}
        >
          {isLoading ? "Loading…" : headline}
        </h1>
        <p
          className="mt-3 max-w-xs text-sm leading-relaxed"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          {error
            ? "Scoreboard not found."
            : "Scores will be available once the competition is underway."}
        </p>
      </div>
    </div>
  );
}
