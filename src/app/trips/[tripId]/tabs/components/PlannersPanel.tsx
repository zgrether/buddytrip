"use client";

import { Users, ChevronDown, ChevronUp, Check, X } from "lucide-react";
import { CrewSearchInput } from "@/components/CrewSearchInput";
import { UserAvatar } from "@/components/UserAvatar";

// ── Types ─────────────────────────────────────────────────────────────────

export interface PlannerWithVoteStatus {
  userId: string;
  name: string;
  role: "owner" | "planner";
  hasVoted: boolean;
  isMe: boolean;
}

interface PlannersPanelProps {
  tripId: string;
  planners: PlannerWithVoteStatus[];
  isOwner: boolean;
  canEdit: boolean;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

// ── VoteBadge ─────────────────────────────────────────────────────────────

function VoteBadge({ hasVoted, isOwner }: { hasVoted: boolean; isOwner: boolean }) {
  if (isOwner) {
    return (
      <span
        className="text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0"
        style={{
          background: "rgba(251,191,36,0.1)",
          color: "var(--color-bt-warning)",
          border: "1px solid rgba(251,191,36,0.25)",
        }}
      >
        Owner
      </span>
    );
  }
  if (hasVoted) {
    return (
      <span
        className="text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0"
        style={{
          background: "var(--color-bt-accent-faint)",
          color: "var(--color-bt-accent)",
          border: "1px solid var(--color-bt-accent-border)",
        }}
      >
        Voted
      </span>
    );
  }
  return (
    <span
      className="text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0"
      style={{
        background: "var(--color-bt-warning-faint)",
        color: "var(--color-bt-warning)",
        border: "1px solid rgba(251,191,36,0.25)",
      }}
    >
      Not voted
    </span>
  );
}

// ── PlannerRow ────────────────────────────────────────────────────────────

function PlannerRow({ planner }: { planner: PlannerWithVoteStatus }) {
  return (
    <div className="flex items-center gap-2.5 px-4 py-2.5">
      <UserAvatar name={planner.name} avatarUrl={null} sizePx={28} />
      <span
        className="flex-1 text-sm truncate"
        style={{ color: "var(--color-bt-text)" }}
      >
        {planner.name}
        {planner.isMe && (
          <span style={{ color: "var(--color-bt-text-dim)", marginLeft: 4 }}>
            (you)
          </span>
        )}
      </span>
      <VoteBadge hasVoted={planner.hasVoted} isOwner={planner.role === "owner"} />
    </div>
  );
}

// ── PlannersPanel ─────────────────────────────────────────────────────────

export function PlannersPanel({
  tripId,
  planners,
  isOwner,
  canEdit,
  isCollapsed,
  onToggleCollapse,
}: PlannersPanelProps) {
  const showCollapsed = isCollapsed;
  const showEmptyState = !isCollapsed && planners.length <= 1;
  const showExpanded = !isCollapsed && planners.length > 1;

  // ── State 1: Empty (only owner or no planners) ──────────────────────────
  if (showEmptyState) {
    return (
      <div
        className="rounded-xl overflow-hidden"
        style={{
          background: "rgba(255,255,255,0.02)",
          border: "1.5px dashed var(--color-bt-border)",
        }}
      >
        {/* Header */}
        <div className="flex items-center gap-2.5 px-4 py-3">
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 9,
              background: "var(--color-bt-accent-faint)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Users size={16} style={{ color: "var(--color-bt-accent)" }} />
          </div>
          <span className="flex-1 text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>
            Planners
          </span>
          <button
            onClick={onToggleCollapse}
            style={{
              width: 26,
              height: 26,
              borderRadius: 7,
              border: "none",
              background: "var(--color-bt-card-raised)",
              color: "var(--color-bt-text-dim)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              flexShrink: 0,
            }}
            aria-label="Collapse planners"
          >
            <ChevronUp size={13} />
          </button>
        </div>

        {/* Description */}
        <p
          style={{
            fontSize: 12,
            color: "var(--color-bt-text-dim)",
            lineHeight: 1.5,
            padding: "0 16px 12px",
            borderBottom: "1px solid var(--color-bt-border)",
          }}
        >
          Invite people who want to help shape the trip. They can add ideas, vote, and weigh
          in before the trip is officially on. Everyone else gets added when you&apos;re ready to go.
        </p>

        {/* Owner row */}
        {planners.length > 0 && <PlannerRow planner={planners[0]} />}

        {/* Search row — canEdit only */}
        {canEdit && (
          <div className="px-4 py-3" style={{ borderTop: "1px solid var(--color-bt-border)" }}>
            <CrewSearchInput
              tripId={tripId}
              defaultRole="Planner"
              defaultStatus="draft"
              allowGhost={false}
              allowInvite
              showSearchIcon
              placeholder="Search by email..."
              frequentTripmates={[]}
            />
          </div>
        )}
      </div>
    );
  }

  // ── State 3: Collapsed (single line) ────────────────────────────────────
  if (showCollapsed) {
    return (
      <div
        className="rounded-xl overflow-hidden cursor-pointer"
        style={{
          border: "1px solid var(--color-bt-border)",
          background: "var(--color-bt-card)",
        }}
        onClick={onToggleCollapse}
      >
        <div
          className="flex items-center gap-2.5"
          style={{ padding: "10px 14px" }}
        >
          {/* Icon */}
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: 7,
              background: "var(--color-bt-accent-faint)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Users size={13} style={{ color: "var(--color-bt-accent)" }} />
          </div>

          {/* Label */}
          <span style={{ fontSize: 13, fontWeight: 600, flexShrink: 0, color: "var(--color-bt-text)" }}>
            Planners
          </span>

          {/* Avatar strip with vote pips */}
          <div style={{ display: "flex", gap: 4, alignItems: "center", flex: 1, flexWrap: "wrap" }}>
            {planners.map((p) => (
              <div key={p.userId} style={{ position: "relative", width: 22, height: 22 }}>
                <UserAvatar name={p.name} avatarUrl={null} sizePx={22} />
                {/* Vote pip */}
                <div
                  style={{
                    position: "absolute",
                    bottom: -1,
                    right: -1,
                    width: 9,
                    height: 9,
                    borderRadius: "50%",
                    border: "1.5px solid var(--color-bt-card)",
                    background: p.hasVoted ? "var(--color-bt-accent)" : "var(--color-bt-warning)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {p.hasVoted ? (
                    <Check size={5} color="#0d1f1a" strokeWidth={3} />
                  ) : (
                    <X size={5} color="#0d1f1a" strokeWidth={3} />
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Expand button */}
          <button
            style={{
              width: 26,
              height: 26,
              borderRadius: 7,
              border: "none",
              background: "var(--color-bt-card-raised)",
              color: "var(--color-bt-text-dim)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              flexShrink: 0,
            }}
            onClick={(e) => { e.stopPropagation(); onToggleCollapse(); }}
            aria-label="Expand planners"
          >
            <ChevronDown size={13} />
          </button>
        </div>
      </div>
    );
  }

  // ── State 2: Expanded (has planners) ─────────────────────────────────────
  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{
        border: "1px solid var(--color-bt-border)",
        background: "var(--color-bt-card)",
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 py-3">
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 9,
            background: "var(--color-bt-accent-faint)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <Users size={16} style={{ color: "var(--color-bt-accent)" }} />
        </div>
        <span className="flex-1 text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>
          Planners · {planners.length} {planners.length === 1 ? "person" : "people"}
        </span>
        <button
          onClick={onToggleCollapse}
          style={{
            width: 26,
            height: 26,
            borderRadius: 7,
            border: "none",
            background: "var(--color-bt-card-raised)",
            color: "var(--color-bt-text-dim)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            flexShrink: 0,
          }}
          aria-label="Collapse planners"
        >
          <ChevronUp size={13} />
        </button>
      </div>

      <hr style={{ borderColor: "var(--color-bt-border)", margin: 0 }} />

      {/* Planner rows */}
      <div className="py-1">
        {planners.map((p) => (
          <PlannerRow key={p.userId} planner={p} />
        ))}
      </div>

      {/* Search row — canEdit only */}
      {canEdit && (
        <div
          className="px-4 py-3"
          style={{ borderTop: "1px solid var(--color-bt-border)" }}
        >
          <CrewSearchInput
            tripId={tripId}
            defaultRole="Planner"
            defaultStatus="draft"
            allowGhost={false}
            allowInvite
            showSearchIcon
            placeholder="Search by email..."
            frequentTripmates={[]}
          />
        </div>
      )}
    </div>
  );
}
