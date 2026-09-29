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
 *    team) are Owner OR Organizer (migrations 199 / 200 — they were Owner-only
 *    here while the server admitted Organizers);
 *  - a team's CAPTAIN edits their own team: identity and order, and until
 *    results, adding unassigned players and removing their own (`rosterRights`).
 *
 * It hosts the relocated TeamsPanel in `embedded` mode (this overlay owns the
 * card chrome + the "Rosters" title) and carries the one-way "Save rosters"
 * commit (staff, during the roster-build phase) that used to live in Settings.
 */
export function RostersOverlay({
  tripId,
  competitionId,
  canManageRoster,
  structureLocked,
  rosterBuilding,
  onSaveRosters,
  onClose,
}: {
  tripId: string;
  competitionId: string;
  /** Owner OR Organizer — everything a staff member does here: team create /
   *  delete, identity, membership, drag, and "Save rosters". Was split from an
   *  Owner-only `isOwner` in #789; migrations 199 / 200 made the server's answer
   *  one predicate, so the split is gone. A captain's rights are resolved per
   *  team inside TeamsPanel. */
  canManageRoster: boolean;
  /** Head-to-head: team COUNT is fixed at 2 (no add/delete team) — rename + swap
   *  stay. False for points (2–N). */
  structureLocked: boolean;
  /** Roster-build phase: show the one-way "Save rosters" commit (Owner or
   *  Organizer — it is `competitions.update`, which admits both). */
  rosterBuilding: boolean;
  /** Commit the roster build (advances roster_setup → saved) + closes. */
  onSaveRosters: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet
      title="Rosters"
      subtitle={canManageRoster ? "Tap a team to edit · drag a player onto a team to assign" : "Who’s on which team"}
      onClose={onClose}
      testId="rosters-overlay"
      maxWidthClass="max-w-3xl"
      footer={
        canManageRoster && rosterBuilding ? (
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
      {/* The relocated team-builder (read-only for everyone but staff and, on
          their own team, its captain). */}
      <TeamsPanel
        tripId={tripId}
        competitionId={competitionId}
        canManageRoster={canManageRoster}
        structureLocked={structureLocked}
        embedded
      />
    </Sheet>
  );
}
