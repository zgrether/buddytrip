"use client";

import { Calendar, LayoutGrid, Trophy, Users, X } from "lucide-react";
import { useModalBackButton } from "@/hooks/useModalBackButton";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onEnable: () => void;
}

/**
 * CompetitionIntroModal — explainer + "Enable Competition Mode" CTA.
 *
 * Shown when the owner/planner taps the home-tab invitation card. The
 * "Enable" path here doesn't create the competition — it just flips the
 * compUnlocked flag in the trip page so the Comp tab appears. The actual
 * competition is created on that tab via CompetitionSetupPanel.
 */
export function CompetitionIntroModal({ isOpen, onClose, onEnable }: Props) {
  useModalBackButton(onClose, isOpen);
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "var(--color-bt-overlay)" }}
      onClick={onClose}
      data-testid="competition-intro-modal"
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-2xl"
        style={{
          background: "var(--color-bt-card-float)",
          border: "1px solid var(--color-bt-border)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header — Trophy hero + close X */}
        <div className="relative px-5 pt-6 pb-4 text-center">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-lg"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            <X size={16} />
          </button>
          <div
            className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl"
            style={{
              background: "var(--color-bt-accent-faint)",
              color: "var(--color-bt-accent)",
            }}
          >
            <Trophy size={28} />
          </div>
          <h2
            className="mt-4 text-xl font-bold"
            style={{ color: "var(--color-bt-text)" }}
          >
            Turn this trip into a competition
          </h2>
          <p
            className="mt-2 text-sm leading-relaxed"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            Add teams, events, and a live leaderboard. Perfect for golf
            trips, cabin weekends, and anything with a winner.
          </p>
        </div>

        {/* Feature list */}
        <div
          className="space-y-3 px-5 py-4"
          style={{ borderTop: "1px solid var(--color-bt-border)" }}
        >
          <Feature
            icon={<Users size={14} />}
            title="Teams"
            body="Split the crew into 2 or more teams. Pick names, colors, and short tags for the scorecard."
          />
          <Feature
            icon={<Calendar size={14} />}
            title="Events"
            body="Golf rounds, side games, anything scored. Practice rounds don't count toward points."
          />
          <Feature
            icon={<LayoutGrid size={14} />}
            title="Play Groups"
            body="Set foursomes the night before. Auto-generate by team or shuffle for variety."
          />
        </div>

        {/* Footer CTAs */}
        <div
          className="flex flex-col-reverse gap-2 px-5 pb-5 pt-4 sm:flex-row sm:justify-end"
          style={{ borderTop: "1px solid var(--color-bt-border)" }}
        >
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-4 py-2.5 text-sm font-medium"
            style={{
              background: "transparent",
              color: "var(--color-bt-text-dim)",
              border: "0.5px solid var(--color-bt-border)",
            }}
          >
            Maybe later
          </button>
          <button
            type="button"
            onClick={onEnable}
            className="flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold"
            style={{
              background: "var(--color-bt-accent)",
              color: "var(--color-bt-base)",
            }}
            data-testid="competition-intro-enable"
          >
            <Trophy size={14} />
            Enable Competition Mode
          </button>
        </div>
      </div>
    </div>
  );
}

function Feature({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div
        className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg"
        style={{
          background: "var(--color-bt-accent-faint)",
          color: "var(--color-bt-accent)",
        }}
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p
          className="text-sm font-semibold"
          style={{ color: "var(--color-bt-text)" }}
        >
          {title}
        </p>
        <p className="text-xs leading-snug" style={{ color: "var(--color-bt-text-dim)" }}>
          {body}
        </p>
      </div>
    </div>
  );
}
