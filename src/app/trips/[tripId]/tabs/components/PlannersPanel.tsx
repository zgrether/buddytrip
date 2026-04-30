"use client";

import { useState } from "react";
import { Users, ChevronDown, ChevronUp, Check, X, Crown, Trash2, Plus } from "lucide-react";
import { CrewSearchInput } from "@/components/CrewSearchInput";
import { UserAvatar } from "@/components/UserAvatar";
import { trpc } from "@/lib/trpc-client";

// ── Types ─────────────────────────────────────────────────────────────────

export interface PlannerWithVoteStatus {
  userId: string;
  name: string;
  email?: string | null;
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

// ── PlannerRow ────────────────────────────────────────────────────────────

function PlannerRow({
  planner,
  tripId,
  isOwner,
}: {
  planner: PlannerWithVoteStatus;
  tripId: string;
  isOwner: boolean;
}) {
  const utils = trpc.useUtils();
  const [isExpanded, setIsExpanded] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const removeMember = trpc.tripMembers.remove.useMutation({
    onSuccess() {
      utils.tripMembers.list.invalidate({ tripId });
    },
  });

  const isOwnerRow = planner.role === "owner";
  const expandable = isOwner && !planner.isMe && !isOwnerRow;

  return (
    <div
      className="border-b last:border-b-0"
      style={{
        borderColor: "var(--color-bt-border)",
        background: isExpanded
          ? "var(--color-bt-card-raised)"
          : "color-mix(in srgb, var(--color-bt-accent) 5%, transparent)",
      }}
    >
      {/* Main row */}
      <div
        className="flex items-center gap-3 py-2.5 px-3"
        style={{ cursor: expandable ? "pointer" : undefined }}
        onClick={
          expandable
            ? () => { setIsExpanded((e) => !e); setConfirmRemove(false); }
            : undefined
        }
      >
        <UserAvatar name={planner.name} avatarUrl={null} sizePx={32} />

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>
            {planner.name}
            {planner.isMe && (
              <span className="ml-1 text-xs" style={{ color: "var(--color-bt-text-dim)" }}>(you)</span>
            )}
          </p>
          {planner.email && (
            <p className="truncate text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
              {planner.email}
            </p>
          )}
        </div>

        <div className="flex flex-shrink-0 items-center gap-1.5">
          {/* Owner badge */}
          {isOwnerRow && (
            <span
              className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
              style={{
                background: "color-mix(in srgb, var(--color-bt-warning) 15%, transparent)",
                color: "var(--color-bt-warning)",
                border: "1px solid color-mix(in srgb, var(--color-bt-warning) 30%, transparent)",
              }}
            >
              <Crown size={10} />
              Owner
            </span>
          )}

          {/* Planner badge — no × button */}
          {!isOwnerRow && (
            <span
              className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
              style={{
                background: "var(--color-bt-accent-faint)",
                color: "var(--color-bt-accent)",
                border: "1px solid var(--color-bt-accent-border)",
              }}
            >
              Planner
            </span>
          )}

          {expandable && (
            <ChevronDown
              size={16}
              className="transition-transform duration-150"
              style={{
                color: "var(--color-bt-text-dim)",
                transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
              }}
            />
          )}
        </div>
      </div>

      {/* Expanded panel */}
      {isExpanded && expandable && (
        <div className="flex gap-3 px-3 pb-3">
          <div className="w-8 flex-shrink-0" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              {confirmRemove ? (
                <>
                  <span className="text-xs font-medium" style={{ color: "var(--color-bt-danger)" }}>
                    Remove {planner.name}?
                  </span>
                  <button
                    onClick={() => removeMember.mutate({ tripId, userId: planner.userId })}
                    disabled={removeMember.isPending}
                    className="rounded-lg px-2.5 py-1 text-xs font-semibold disabled:opacity-40"
                    style={{ background: "var(--color-bt-danger)", color: "white" }}
                  >
                    Yes, remove
                  </button>
                  <button
                    onClick={() => setConfirmRemove(false)}
                    className="rounded-lg border px-2.5 py-1 text-xs"
                    style={{ borderColor: "var(--color-bt-border)", color: "var(--color-bt-text-dim)" }}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setConfirmRemove(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium"
                  style={{ color: "var(--color-bt-danger)", border: "1px solid var(--color-bt-danger)", opacity: 0.75 }}
                >
                  <Trash2 size={12} />
                  Remove {planner.name} from trip
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── AddPlannerRow ─────────────────────────────────────────────────────────

function AddPlannerRow({ tripId }: { tripId: string }) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!isExpanded) {
    return (
      <button
        onClick={() => setIsExpanded(true)}
        className="flex w-full items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-medium transition-all"
        style={{
          background: "var(--color-bt-card-raised)",
          color: "var(--color-bt-text)",
          border: "1px solid var(--color-bt-border)",
        }}
      >
        <Users size={15} />
        <Plus size={12} />
        Add planner
      </button>
    );
  }

  return (
    <div
      className="rounded-xl px-3 py-2.5"
      style={{ background: "color-mix(in srgb, var(--color-bt-accent) 6%, var(--color-bt-base))" }}
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
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
        <button
          onClick={() => setIsExpanded(false)}
          className="rounded-lg border px-3 py-1.5 text-xs flex-shrink-0"
          style={{ borderColor: "var(--color-bt-border)", color: "var(--color-bt-text-dim)" }}
        >
          Cancel
        </button>
      </div>
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

  // Shared header — same markup in both expanded and empty states
  const header = (
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
        {showExpanded
          ? `Planners · ${planners.length} ${planners.length === 1 ? "person" : "people"}`
          : "Planners"}
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
  );

  // ── State 1: Empty (only owner or no planners) ──────────────────────────
  if (showEmptyState) {
    return (
      <div
        className="rounded-xl overflow-hidden"
        style={{
          background: "var(--color-bt-card)",
          border: "1.5px dashed var(--color-bt-border)",
        }}
      >
        {header}

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
        {planners.length > 0 && (
          <PlannerRow planner={planners[0]} tripId={tripId} isOwner={isOwner} />
        )}

        {/* Add planner affordance — canEdit only */}
        {canEdit && (
          <div className="px-4 py-3" style={{ borderTop: "1px solid var(--color-bt-border)" }}>
            <AddPlannerRow tripId={tripId} />
          </div>
        )}
      </div>
    );
  }

  // ── State 3: Collapsed (single line, same height as expanded header) ─────
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
        <div className="flex items-center gap-2.5 px-4 py-3">
          {/* 32px icon — matches expanded header */}
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

          {/* Label — text-sm matches expanded header */}
          <span className="text-sm font-semibold flex-shrink-0" style={{ color: "var(--color-bt-text)" }}>
            Planners
          </span>

          {/* Avatar strip with vote pips */}
          <div style={{ display: "flex", gap: 4, alignItems: "center", flex: 1, flexWrap: "wrap" }}>
            {planners.map((p) => (
              <div key={p.userId} style={{ position: "relative", width: 22, height: 22 }}>
                <UserAvatar name={p.name} avatarUrl={null} sizePx={22} />
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
      {header}

      <hr style={{ borderColor: "var(--color-bt-border)", margin: 0 }} />

      {/* Planner rows */}
      <div>
        {planners.map((p) => (
          <PlannerRow key={p.userId} planner={p} tripId={tripId} isOwner={isOwner} />
        ))}
      </div>

      {/* Add planner affordance — canEdit only */}
      {canEdit && (
        <div
          className="px-4 py-3"
          style={{ borderTop: "1px solid var(--color-bt-border)" }}
        >
          <AddPlannerRow tripId={tripId} />
        </div>
      )}
    </div>
  );
}
