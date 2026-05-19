"use client";

import { useState } from "react";
import { Trophy } from "lucide-react";
import { CompetitionIntroModal } from "./CompetitionIntroModal";
import { InvitationCard } from "@/components/InvitationCard";

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
 *
 * Uses the shared InvitationCard primitive so the empty-state CTA matches
 * every other home-tab panel (Quick Info, Travel Plans, Itinerary).
 */
export function CompetitionInvitationCard({ canEdit, isActivated, onEnable }: Props) {
  const [introOpen, setIntroOpen] = useState(false);

  if (isActivated || !canEdit) return null;

  return (
    <>
      <InvitationCard
        Icon={Trophy}
        title="Enable Competition Mode"
        body="Your group already has a rivalry. Give it a scoreboard, teams, and a live leaderboard."
        onClick={() => setIntroOpen(true)}
        testId="competition-invitation"
      />
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
