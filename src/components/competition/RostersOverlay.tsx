"use client";

import { X } from "lucide-react";
import { ScrollLock } from "@/hooks/useScrollLock";
import { TeamsPanel } from "./TeamsPanel";

/**
 * RostersOverlay (W-TEAMSURFACE-01) — the one home for team management, opened
 * from the leaderboard header (stadium-scoreboard model: glance up to see the
 * lineup). It floats ON TOP of the leaderboard (the board is never demoted), with
 * the lighter drawer scrim so the standings read as still-present context.
 *
 * ONE surface, role-gated:
 *  - any trip member opens it and SEES the rosters (reads are member-accessible);
 *  - edit affordances (add/remove/move players, add/delete team, tap-to-edit a
 *    team) are OWNER-only — `canEdit={isOwner}` flows into TeamsPanel, which
 *    already renders view-only when canEdit is false.
 *
 * It hosts the relocated TeamsPanel in `embedded` mode (this overlay owns the
 * card chrome + the "Rosters" title) and carries the one-way "Save rosters"
 * commit (owner, during the roster-build phase) that used to live in Settings.
 */
export function RostersOverlay({
  tripId,
  competitionId,
  isOwner,
  structureLocked,
  rosterBuilding,
  onSaveRosters,
  onClose,
}: {
  tripId: string;
  competitionId: string;
  /** Owner gates every STRUCTURE affordance; everyone else gets a read-only view.
   *  IDENTITY editing (name/short/color) additionally opens to a team's captain,
   *  resolved inside TeamsPanel (the per-card pencil). */
  isOwner: boolean;
  /** Live: team STRUCTURE is frozen (no add/delete team) — rename + swap stay. */
  structureLocked: boolean;
  /** Roster-build phase: show the one-way "Save rosters" commit (owner only). */
  rosterBuilding: boolean;
  /** Commit the roster build (advances roster_setup → saved) + closes. */
  onSaveRosters: () => void;
  onClose: () => void;
}) {
  return (
    <ScrollLock>
      <div
        className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
        style={{ background: "var(--color-bt-overlay-drawer)" }}
        onClick={onClose}
        data-testid="rosters-overlay"
      >
        <div
          className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-t-2xl sm:rounded-2xl"
          style={{ background: "var(--color-bt-card-float)", border: "1px solid var(--color-bt-border)" }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between px-4 py-3"
            style={{ borderBottom: "1px solid var(--color-bt-border)" }}
          >
            <div>
              <h3 className="text-base font-bold" style={{ color: "var(--color-bt-text)" }}>
                Rosters
              </h3>
              <p className="text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>
                {isOwner
                  ? "Tap a team to edit · drag a player onto a team to assign"
                  : "Who’s on which team"}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex h-8 w-8 items-center justify-center rounded-lg"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              <X size={16} />
            </button>
          </div>

          {/* Body — the relocated team-builder (read-only for non-owners). */}
          <div className="flex-1 overflow-y-auto p-4">
            <TeamsPanel
              tripId={tripId}
              competitionId={competitionId}
              canEdit={isOwner}
              structureLocked={structureLocked}
              embedded
            />
          </div>

          {/* Footer — the one-way roster-build commit (owner, building phase). */}
          {isOwner && rosterBuilding && (
            <div className="border-t p-4" style={{ borderColor: "var(--color-bt-border)" }}>
              <button
                type="button"
                onClick={onSaveRosters}
                className="w-full rounded-xl py-3 text-sm font-semibold"
                style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
                data-testid="rosters-save"
              >
                Save rosters
              </button>
            </div>
          )}
        </div>
      </div>
    </ScrollLock>
  );
}
