"use client";

import { MapPin, Plus } from "lucide-react";
import { CoPlannerPanel } from "./IdeaZonePanel";

export type SidebarStage = "idea";

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
  /** Full member list — feeds the CoPlannerPanel. */
  members?: IdeaMember[];
  /** Set of user IDs who have voted on any idea. */
  allVoterIds?: Set<string>;
  /** Called when the user clicks "Add destination idea". */
  onAddIdea?: () => void;
}

/**
 * SidebarForStage — the idea-stage right rail: "Add destination idea"
 * CTA (owners only) plus the CoPlannerPanel. Crew chat lives in the
 * FloatingChatPanel at the page level and is no longer mounted here.
 *
 * The component kept its stage-aware shape (one branch today) so the
 * call site in IdeaZonePanel doesn't need to know about the content.
 */
export function SidebarForStage({
  tripId,
  isOwner,
  members,
  allVoterIds,
  onAddIdea,
}: SidebarForStageProps) {
  return (
    <>
      {isOwner && onAddIdea && (
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
  );
}
