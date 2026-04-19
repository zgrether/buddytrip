"use client";

import { MapPin, Plus, Sparkles } from "lucide-react";
import { SidebarChatPanel } from "./PlanningChatPanel";
import { StageContextBar } from "./StageContextBar";
import { CoPlannerPanel } from "./IdeaZonePanel";
import { QuickInfoSection } from "./QuickInfoSection";

export type SidebarStage = "idea" | "planning" | "going" | "now" | "past" | "saved";

interface IdeaMember {
  user_id: string;
  memberId: string;
  role: string;
  status: string;
  displayName: string;
}

export interface SidebarForStageProps {
  stage: SidebarStage;
  tripId: string;
  isOwner: boolean;
  canEdit: boolean;
  /** userId → display name map, used by the embedded chat. */
  memberNames: Record<string, string>;

  // ── Idea-stage specific ─────────────────────────────────────────────
  /** Full member list (idea stage only — feeds the CoPlannerPanel). */
  members?: IdeaMember[];
  /** Set of user IDs who have voted on any idea (idea stage only). */
  allVoterIds?: Set<string>;
  /** Called when the user clicks "Add destination idea" (idea stage only). */
  onAddIdea?: () => void;

  // ── Planning-stage specific ─────────────────────────────────────────
  /** Opens the TripSummaryModal (planning + owner only). */
  onWriteInvitation?: () => void;
}

/**
 * SidebarForStage — renders the right-rail sidebar content appropriate for
 * the trip's current lifecycle stage. Used inside <TwoColumnLayout> so the
 * outer grid stays stage-agnostic.
 *
 * The sidebar chat (SidebarChatPanel) is common to every stage; stage-specific
 * actions stack above it.
 */
export function SidebarForStage({
  stage,
  tripId,
  isOwner,
  canEdit,
  memberNames,
  members,
  allVoterIds,
  onAddIdea,
  onWriteInvitation,
}: SidebarForStageProps) {
  return (
    <>
      {stage === "idea" && (
        <>
          <StageContextBar tripId={tripId} stage="idea" displayStatus="idea" isOwner={isOwner} />
          {canEdit && onAddIdea && (
            <button
              data-testid="add-idea-btn"
              onClick={onAddIdea}
              className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-medium transition-colors hover:bg-[var(--color-bt-hover)]"
              style={{
                border: "1.5px dashed var(--color-bt-accent)",
                color: "var(--color-bt-accent)",
                background: "transparent",
              }}
            >
              <Plus size={16} />
              <MapPin size={15} />
              Add destination idea
            </button>
          )}
          {members && allVoterIds && (
            <CoPlannerPanel
              tripId={tripId}
              members={members}
              isOwner={isOwner}
              allVoterIds={allVoterIds}
            />
          )}
        </>
      )}

      {stage === "planning" && isOwner && onWriteInvitation && (
        <button
          onClick={onWriteInvitation}
          data-testid="sidebar-write-invitation-btn"
          className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold transition-opacity hover:opacity-90"
          style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
        >
          <Sparkles size={15} />
          Trip Summary
        </button>
      )}

      {/* Post-planning stages (going/now/past/saved) surface owner-configured
          Quick Info tiles — door codes, check-in times, addresses — as the
          at-a-glance glance rail alongside chat. */}
      {(stage === "going" || stage === "now" || stage === "past" || stage === "saved") && (
        <QuickInfoSection tripId={tripId} isOwner={isOwner} />
      )}

      {/* Chat is universal across stages. */}
      <SidebarChatPanel tripId={tripId} memberNames={memberNames} />
    </>
  );
}
