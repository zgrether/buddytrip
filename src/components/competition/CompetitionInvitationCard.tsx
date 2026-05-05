"use client";

import { useState } from "react";
import { ArrowRight, Trophy } from "lucide-react";
import { CompetitionIntroModal } from "./CompetitionIntroModal";

interface Props {
  /** Owner/planner; members never see this card. */
  canEdit: boolean;
  /** True once a competition exists OR the owner has opted in via this CTA. */
  isActivated: boolean;
  /** Flips compUnlocked + navigates to the comp tab. Provided by the trip page. */
  onEnable: (() => void) | undefined;
}

/**
 * CompetitionInvitationCard — home-tab discoverability for the
 * competition feature. Owner-only invite that opens CompetitionIntroModal.
 *
 * Hidden once activated (a competition exists or the owner has unlocked
 * the comp tab) — at that point the persistent Competition tab in the
 * tab bar is the surface.
 */
export function CompetitionInvitationCard({ canEdit, isActivated, onEnable }: Props) {
  const [introOpen, setIntroOpen] = useState(false);

  if (isActivated || !canEdit) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setIntroOpen(true)}
        data-testid="competition-invitation"
        className="w-full rounded-xl px-4 py-5 text-left transition-colors hover:bg-[color:var(--color-bt-accent-faint)]"
        style={{
          background: "var(--color-bt-surface-invitation)",
          border: "1.5px dashed var(--color-bt-border)",
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
            <p
              className="text-sm font-bold"
              style={{ color: "var(--color-bt-text)" }}
            >
              Enable Competition Mode
            </p>
            <p
              className="mt-1 text-xs leading-snug"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              Your group already has a rivalry. Give it a scoreboard,
              teams, and a live leaderboard.
            </p>
          </div>
          <ArrowRight
            size={16}
            className="flex-shrink-0"
            style={{ color: "var(--color-bt-accent)" }}
          />
        </div>
      </button>

      <CompetitionIntroModal
        isOpen={introOpen}
        onClose={() => setIntroOpen(false)}
        onEnable={() => {
          setIntroOpen(false);
          onEnable?.();
        }}
      />
    </>
  );
}
