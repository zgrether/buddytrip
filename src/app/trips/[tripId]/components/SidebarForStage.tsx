"use client";

import { MapPin, Plus, Sparkles } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { SidebarChatPanel } from "./PlanningChatPanel";
import { StageContextBar } from "./StageContextBar";
import { CoPlannerPanel } from "./IdeaZonePanel";

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
  canEdit: _canEdit,
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
      )}

      {(stage === "planning" || stage === "going") && isOwner && onWriteInvitation && (
        <TripSummaryButton tripId={tripId} onClick={onWriteInvitation} stage={stage} />
      )}

      {/* Chat is universal across stages. */}
      <SidebarChatPanel tripId={tripId} memberNames={memberNames} />
    </>
  );
}

// ── TripSummaryButton ────────────────────────────────────────────────────
// Planning-stage owner button that opens the Trip Summary modal. Shows a
// filled/accent state once the prerequisites to advance the trip are
// satisfied (destination locked + dates locked, matching the gates the
// modal itself enforces) and a subtler outlined state while there's
// still something outstanding. The button stays clickable either way so
// the owner can open the modal to see exactly what's missing.

function TripSummaryButton({
  tripId,
  onClick,
  stage,
}: {
  tripId: string;
  onClick: () => void;
  stage: SidebarStage;
}) {
  // These queries are already prefetched by the trip page, so they hit
  // the cache instead of firing fresh network requests.
  const { data: trip } = trpc.trips.getById.useQuery({ tripId });
  const { data: poll } = trpc.datePoll.get.useQuery({ tripId });

  const hasDestination = !!trip?.locked_destination_title?.trim();
  const hasLockedDate = !!poll?.lockedWindowId;
  // In planning, readiness means "prereqs met to advance to going". Once
  // the trip is going those prereqs are already satisfied by definition,
  // so the button always shows its filled state — it's a view-only
  // recap at that point.
  const ready = stage === "going" || (hasDestination && hasLockedDate);

  return (
    <button
      onClick={onClick}
      data-testid="sidebar-write-invitation-btn"
      aria-label={ready ? "Open trip summary" : "Open trip summary (some items still incomplete)"}
      className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold transition-opacity hover:opacity-90"
      style={
        ready
          ? {
              background: "var(--color-bt-accent)",
              color: "var(--color-bt-base)",
              border: "1px solid var(--color-bt-accent)",
            }
          : {
              background: "transparent",
              color: "var(--color-bt-accent)",
              border: "1px solid var(--color-bt-accent)",
            }
      }
    >
      <Sparkles size={15} />
      Trip Summary
    </button>
  );
}
