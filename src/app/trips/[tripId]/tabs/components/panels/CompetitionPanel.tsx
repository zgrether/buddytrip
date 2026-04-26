"use client";

import { useState } from "react";
import { ArrowRight, Trophy } from "lucide-react";
import { CompetitionIntroModal } from "../modals/CompetitionIntroModal";

// ── Types ────────────────────────────────────────────────────────────────

interface CompetitionPanelProps {
  isOwner: boolean;
  /** True once the trip has an event_id (i.e. competition has been set up). */
  isActivated: boolean;
  /** Caller-supplied callback that runs the existing comp-setup flow on confirm. */
  onSetupComp: (() => void) | undefined;
}

// ── Component ────────────────────────────────────────────────────────────

/**
 * CompetitionPanel — home tab panel for the competition setup CTA.
 *
 * State machine:
 *   1. Activated              → render nothing (live leaderboard is now
 *                                rendered by the persistent CompetitionStrip
 *                                between TripHeader and TripTabBar)
 *   2. Member, not activated  → render nothing
 *   3. Owner, not activated   → invitation card → opens CompetitionIntroModal
 */
export function CompetitionPanel({
  isOwner,
  isActivated,
  onSetupComp,
}: CompetitionPanelProps) {
  const [introOpen, setIntroOpen] = useState(false);

  // ── State 1: activated — strip handles it ─────────────────────────────
  if (isActivated) return null;

  // ── State 2: member, not activated ───────────────────────────────────
  if (!isOwner) return null;

  // ── State 3: owner, not activated, invitation ────────────────────────
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

