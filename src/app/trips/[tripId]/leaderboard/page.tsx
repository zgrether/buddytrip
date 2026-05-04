"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Trophy } from "lucide-react";
import { TopNav } from "@/components/TopNav";

/**
 * Live Leaderboard — STUBBED in Phase A.
 *
 * The previous implementation read from the dropped `rounds` and
 * `side_events` tables. Migration 062 rebuilt the competition schema, and
 * the new scoring surface (events → group_results) is owned by Phase B.
 *
 * This placeholder keeps navigation and the four sub-tabs visible so the
 * structure is recognizable, but every panel reads "Coming soon."
 */

type Section = "overview" | "groups" | "info" | "history";

const SECTIONS: { id: Section; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "groups", label: "Groups" },
  { id: "info", label: "Trip Info" },
  { id: "history", label: "History" },
];

export default function LiveLeaderboardPage() {
  const { tripId } = useParams<{ tripId: string }>();
  const router = useRouter();
  const [section, setSection] = useState<Section>("overview");

  return (
    <div
      className="min-h-screen"
      style={{ background: "var(--color-bt-base)", color: "var(--color-bt-text)" }}
    >
      <TopNav />
      <div className="mx-auto max-w-[1280px] px-4 pt-4 pb-24">
        <button
          onClick={() => router.push(`/trips/${tripId}`)}
          className="flex items-center gap-1.5 text-sm font-medium"
          style={{ color: "var(--color-bt-accent)" }}
        >
          <ArrowLeft size={16} />
          Back to trip
        </button>

        {/* Sub-tab shells — non-functional, structural only */}
        <div
          className="mt-4 flex gap-1 rounded-xl p-1"
          style={{ background: "var(--color-bt-card-raised)" }}
        >
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              className="flex-1 rounded-lg py-2 text-xs font-semibold transition-colors"
              style={
                section === s.id
                  ? {
                      background: "var(--color-bt-card)",
                      color: "var(--color-bt-text)",
                    }
                  : { color: "var(--color-bt-text-dim)" }
              }
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* Empty state — same surface treatment as other empty states */}
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
            Leaderboard
          </h2>
          <p
            className="mt-2 max-w-xs text-sm leading-relaxed"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            Coming soon — scores will appear here once events are completed.
          </p>
        </div>
      </div>
    </div>
  );
}
