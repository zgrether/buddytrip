/**
 * What the Rosters screen offers one viewer on one team: the client mirror of
 * the server's roster rules after PR 8's permissions pass (migrations 199/200).
 * Pure, so the team card and the Edit Team modal read the SAME answer, and so
 * the rules are testable without a DOM.
 *
 * The server is the authority; this only decides what to SHOW. Each branch
 * matches a refusal the server makes, so nothing offered here is refused there:
 *
 *  - STAFF (trip Owner or Organizer): add, remove, move. After results, adds
 *    stay open, while removals and moves lock (the × is shown disabled, with
 *    why, so it reads as intentional). `assertRosterUnlocked`.
 *  - CAPTAIN of THIS team (and not staff): until results, add an UNASSIGNED
 *    player and remove their own players, never themselves (the team would be
 *    left captainless — that is `setCaptain`'s job). After results, nothing,
 *    and one line says who can still act. `captain_add_player` /
 *    `captain_remove_player`. A captain never moves a player: pulling someone
 *    off another team is a trade, which is Organizer-level.
 *  - Anyone else: read-only. Delegation grants no roster rights.
 *
 * The lock is ONE moment for both (`game_started`, via `rosterLocked`).
 */

export type RemoveControl = "hidden" | "enabled" | "locked";

export interface RosterRights {
  /** "+ Add player" from the unassigned pool. */
  add: boolean;
  /** Drag a player between teams — a move, i.e. a trade. */
  trade: boolean;
  /** The per-row × for this player. */
  remove(userId: string): RemoveControl;
  /** The viewer is this team's captain and results are in: say who can still act. */
  captainLocked: boolean;
}

export function rosterRights(p: {
  /** Trip Owner or Organizer. */
  staff: boolean;
  /** The viewer captains THIS team. */
  captainOfTeam: boolean;
  /** Results are in (`teamAssignments.rosterLocked`). */
  locked: boolean;
  viewerId: string | null | undefined;
}): RosterRights {
  if (p.staff) {
    return {
      add: true,
      trade: !p.locked,
      remove: () => (p.locked ? "locked" : "enabled"),
      captainLocked: false,
    };
  }
  if (p.captainOfTeam) {
    return {
      add: !p.locked,
      trade: false,
      remove: (userId) => (p.locked || userId === p.viewerId ? "hidden" : "enabled"),
      captainLocked: p.locked,
    };
  }
  return { add: false, trade: false, remove: () => "hidden", captainLocked: false };
}

/** The line a captain sees once results are in. Names who can still act. */
export const CAPTAIN_LOCKED_NOTE = "Results are in, so only an organizer can change rosters now.";
