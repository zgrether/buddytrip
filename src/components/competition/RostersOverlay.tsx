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
 * card chrome + the "Rosters" title) and a "Done" button on every visit.
 *
 * "Done", not "Save": every roster change here is written the moment it is
 * made, so there is never anything to save, and Done only closes. It used to be
 * a "Save rosters" button shown only while the cup's `roster_setup` was
 * `building` — a one-way commit that then vanished, so the first visit suggested
 * edits waited on it and every later visit had no button for the same edits
 * (found in the #1529 look). `roster_setup` itself had no reader left (#445
 * removed the board signposts that read it), so it is no longer written at all;
 * the column itself was dropped in migration 201 (#1530).
 */
export function RostersOverlay({
  tripId,
  competitionId,
  canManageRoster,
  structureLocked,
  onClose,
}: {
  tripId: string;
  competitionId: string;
  /** Owner OR Organizer — everything a staff member does here: team create /
   *  delete, identity, membership, drag, and "Done". Was split from an
   *  Owner-only `isOwner` in #789; migrations 199 / 200 made the server's answer
   *  one predicate, so the split is gone. A captain's rights are resolved per
   *  team inside TeamsPanel. */
  canManageRoster: boolean;
  /** Head-to-head: team COUNT is fixed at 2 (no add/delete team) — rename + swap
   *  stay. False for points (2–N). */
  structureLocked: boolean;
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
        canManageRoster ? (
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-xl py-3 text-sm font-semibold"
            style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
            data-testid="rosters-done"
          >
            Done
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
