"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trophy, X } from "lucide-react";
import { trpc } from "@/lib/trpc-client";

// ── CompetitionEnableCard ───────────────────────────────────────────────────
//
// The optional "Running a competition?" card at the foot of trip Home's setup
// guide — the create entry point for a competition now that the Competition tab
// is gone (Stage 5 cord-cut). The trip CREATES the competition here; the
// competition face MANAGES it from its own gear thereafter.
//
//   - No competition + not dismissed → the prompt ("Set it up" / "Not this trip").
//   - "Set it up"  → the competition face, where the create flow lives. Once a
//                    competition exists the "Live" bottom-nav entry appears and
//                    becomes the entry point — so this card hides itself.
//   - "Not this trip" → dismissed (per-trip, localStorage), card hidden.
//
// Owner-only by virtue of living inside the owner-only FreshTripGuide.

const KEY = (tripId: string) => `bt-trip-${tripId}-comp-card-dismissed`;

export function CompetitionEnableCard({ tripId }: { tripId: string }) {
  const router = useRouter();
  const { data: competition } = trpc.competitions.getByTrip.useQuery({ tripId });

  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(KEY(tripId)) === "1";
    } catch {
      return false;
    }
  });

  // Once enabled, the "Live" nav entry is the way in — the card's job is done.
  if (competition || dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(KEY(tripId), "1");
    } catch {
      // best-effort; state still flips in memory
    }
  };

  return (
    <div
      className="relative mt-3 flex items-start gap-4 rounded-xl p-4"
      style={{
        background: "var(--color-bt-card)",
        border: "1px dashed var(--color-bt-border)",
      }}
      data-testid="comp-enable-card"
    >
      <div
        className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl"
        style={{
          background: "var(--color-bt-accent-faint)",
          color: "var(--color-bt-accent)",
        }}
        aria-hidden
      >
        <Trophy size={20} />
      </div>
      <div className="min-w-0 flex-1">
        <p
          className="text-[15px] font-semibold leading-tight"
          style={{ color: "var(--color-bt-text)" }}
        >
          Running a competition?
        </p>
        <p
          className="mt-1 text-[13px] leading-snug"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          Teams, games, and a live leaderboard the crew follows along. Optional —
          most trips don&rsquo;t need one.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => router.push(`/trips/${tripId}/leaderboard`)}
            className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[13px] font-semibold"
            style={{
              background: "var(--color-bt-accent)",
              color: "var(--color-bt-on-accent, #0d1f1a)",
            }}
            data-testid="comp-enable-setup"
          >
            <Trophy size={14} strokeWidth={2.4} />
            Set it up
          </button>
          <button
            type="button"
            onClick={dismiss}
            className="rounded-lg px-3 py-2 text-[13px] font-medium"
            style={{ color: "var(--color-bt-text-dim)" }}
            data-testid="comp-enable-dismiss"
          >
            Not this trip
          </button>
        </div>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-lg"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        <X size={15} />
      </button>
    </div>
  );
}
