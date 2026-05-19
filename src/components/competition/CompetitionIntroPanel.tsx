"use client";

import { Calendar, LayoutGrid, Trophy, Users } from "lucide-react";

interface Props {
  /** Flips compUnlocked at the page level so the Comp tab swaps to the setup panel. */
  onEnable: () => void;
}

/**
 * CompetitionIntroPanel — pre-enablement surface on the Comp tab.
 *
 * Same Trophy hero + feature list + "Enable Competition Mode" CTA that the
 * old CompetitionIntroModal showed, but as an inline tab surface. Because
 * it lives on a dedicated tab (the user already opted in by tapping it),
 * there's no "Maybe later" or X dismiss — they navigate away by switching
 * tabs.
 *
 * Tapping Enable doesn't create the competition. It flips the page-level
 * compUnlocked flag, which re-renders the Comp tab into CompetitionSetupPanel
 * (the actual create form for name, tagline, teams, etc.).
 */
export function CompetitionIntroPanel({ onEnable }: Props) {
  return (
    // Matches the standard panel treatment used across the app and the
    // marketing-page card visuals: --color-bt-card background, 1px border
    // in --color-bt-border, rounded-2xl, raised shadow. (The previous
    // card-float background + no shadow was inherited from the modal we
    // forked this content from and read as a floating chip on the tab.)
    <div
      className="overflow-hidden rounded-2xl border"
      style={{
        background: "var(--color-bt-card)",
        borderColor: "var(--color-bt-border)",
        boxShadow: "var(--shadow-raised)",
      }}
      data-testid="competition-intro-panel"
    >
      {/* Hero — trophy + headline + tagline */}
      <div className="px-5 pt-6 pb-4 text-center">
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
          Add teams, events, and a live leaderboard. Perfect for golf trips,
          cabin weekends, and anything with a winner.
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

      {/* CTA — Enable. No "Maybe later" needed; users back out by changing tabs. */}
      <div
        className="px-5 pb-5 pt-4"
        style={{ borderTop: "1px solid var(--color-bt-border)" }}
      >
        <button
          type="button"
          onClick={onEnable}
          data-testid="competition-intro-enable"
          className="flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition-opacity hover:opacity-85"
          style={{
            background: "var(--color-bt-accent)",
            color: "var(--color-bt-base)",
          }}
        >
          <Trophy size={14} />
          Enable Competition Mode
        </button>
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
        <p
          className="text-xs leading-snug"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          {body}
        </p>
      </div>
    </div>
  );
}
