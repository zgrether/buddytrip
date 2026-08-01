"use client";

import { Sheet } from "@/components/Sheet";
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
  canManageRoster,
  structureLocked,
  rosterBuilding,
  onSaveRosters,
  onClose,
}: {
  tripId: string;
  competitionId: string;
  /** Owner gates TEAM structure (create / delete) and captaincy; everyone else
   *  gets a read-only view of those. IDENTITY editing (name/short/color)
   *  additionally opens to a team's captain, resolved inside TeamsPanel (the
   *  per-card pencil). */
  isOwner: boolean;
  /** Owner OR Organizer — ROSTER MEMBERSHIP (assign / remove). Split from
   *  `isOwner` in #789: `teamAssignments.assign` has always been Organizer-gated
   *  server-side and `remove` moved there in #788, so an Organizer already held
   *  this and was shown a read-only roster. Team create/delete are NOT this flag
   *  (still Owner-only at the server), which is why it is a second prop rather
   *  than a loosened `isOwner`. */
  canManageRoster: boolean;
  /** Head-to-head: team COUNT is fixed at 2 (no add/delete team) — rename + swap
   *  stay. False for points (2–N). */
  structureLocked: boolean;
  /** Roster-build phase: show the one-way "Save rosters" commit (owner only). */
  rosterBuilding: boolean;
  /** Commit the roster build (advances roster_setup → saved) + closes. */
  onSaveRosters: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet
      title="Rosters"
      subtitle={isOwner ? "Tap a team to edit · drag a player onto a team to assign" : "Who’s on which team"}
      onClose={onClose}
      testId="rosters-overlay"
      maxWidthClass="max-w-3xl"
      footer={
        isOwner && rosterBuilding ? (
          <button
            type="button"
            onClick={onSaveRosters}
            className="w-full rounded-xl py-3 text-sm font-semibold"
            style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
            data-testid="rosters-save"
          >
            Save rosters
          </button>
        ) : undefined
      }
    >
      {/* The relocated team-builder (read-only for non-owners). */}
      <TeamsPanel
        tripId={tripId}
        competitionId={competitionId}
        canEdit={isOwner}
        canManageRoster={canManageRoster}
        structureLocked={structureLocked}
        embedded
      />
    </Sheet>
  );
}
