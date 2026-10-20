import { rosterRights } from "./rosterRights";
import { UNASSIGNED_TEAM_ID } from "./teamRosterColors";
import { NOT_ON_A_TEAM_WORD } from "./vocabulary";

/**
 * WHO THE MATCH BUILDER OFFERS, AND WHO IT CAN ADD (PR 9b, ruling 2).
 *
 * Pure, so the three rules below are testable without a DOM and every builder
 * (golf match play, the non-golf Matches builder) reads the same answer.
 *
 * ── The zero-assignments fallback is gone, and only that ──────────────────
 *
 * The golf picker used to offer the WHOLE trip crew whenever a cup had no team
 * assignments, and in a Match Play cup the server then refused every one of
 * them (migration 193, "isn't on either team in this cup"). The builder was
 * offering what the backend refuses. Now a cup that HAS teams offers its
 * rosters, and everyone else appears under "Not on a team".
 *
 * Two pools that look like the fallback are NOT it, and stay the whole crew:
 *  - a SIDE GAME (no cup): there is no team to be on;
 *  - a TEAMLESS RACE (a points cup with zero teams, PR 7): its units are
 *    people, so the crew is its roster (`competitionLeaderboard.ts`).
 * In both, "Not on a team" would be a section about a thing that does not
 * exist, so it is empty.
 */

export interface BuilderTeam {
  id: string;
  name: string;
  color: string;
}

/** Does this game pair from team rosters? A cup with at least one team. */
export function pairsFromRosters(p: { inCup: boolean; teamCount: number }): boolean {
  return p.inCup && p.teamCount > 0;
}

/** The picker's main pool for one slot. */
export function builderPool(p: {
  /** Head to head: the slot's own team. Otherwise undefined. */
  slotTeamId?: string;
  rostersApply: boolean;
  rosterOfTeam: (teamId: string) => string[];
  /** Everyone on any team of this cup. */
  rosterIds: string[];
  /** Everyone on the trip. */
  crewIds: string[];
}): string[] {
  if (p.slotTeamId) return p.rosterOfTeam(p.slotTeamId);
  return p.rostersApply ? p.rosterIds : p.crewIds;
}

/**
 * The GROUPINGS picker's section for everyone on no team (stroke, skins).
 *
 * Unlike match play, these formats can PLAY someone on no team (their result
 * counts for no team), so the picker offers them in their own section. In a
 * cup with teams it is "Not on a team" (#1668 look); in a side game or a
 * teamless race nobody has a team, and it is simply the crew.
 *
 * Skins built its picker from team rosters alone and had no such section, so
 * a skins game with no teams offered NOBODY and could never be grouped
 * (#1669). Both views read this one answer now.
 */
export function unteamedSection<P extends { id: string }>(p: {
  rostersApply: boolean;
  crew: P[];
  teamOf: (userId: string) => string | undefined;
}): { id: string; name: string; color: string; players: P[] } | null {
  const players = p.crew.filter((c) => !p.teamOf(c.id));
  if (players.length === 0) return null;
  return {
    id: UNASSIGNED_TEAM_ID,
    name: p.rostersApply ? NOT_ON_A_TEAM_WORD : "Crew",
    color: "var(--color-bt-text-dim)",
    players,
  };
}

/** Trip members on no team of this cup — the "Not on a team" section. */
export function notOnATeamIds(p: {
  rostersApply: boolean;
  crewIds: string[];
  teamOf: (userId: string) => string | undefined;
}): string[] {
  if (!p.rostersApply) return [];
  return p.crewIds.filter((id) => !p.teamOf(id));
}

/**
 * The teams this viewer may add someone to from the builder: whoever the
 * server allows, and only by a path the server accepts.
 *
 *  - Head to head, only the slot's OWN team: adding a person to the other side
 *    from this side's picker would put them somewhere this slot cannot use.
 *  - Owner and Organizers, any team; a captain, their own team, before results
 *    (`rosterRights`, the same answer the Rosters screen reads).
 *  - After results an add changes what unfinished games count for, so it goes
 *    through the 8b preview and never as a bare add. Where the preview is not
 *    mounted (a game opened on its standalone route), no add is offered — the
 *    server would refuse it for lacking the preview's fingerprint.
 */
/**
 * What the section says when this viewer has NO add — every viewer who can
 * build matches sees who is not on a team (9b look: hiding them brought back
 * the silent-missing bug for delegates, who are often the ones building), and a
 * viewer who cannot add is told who can.
 *
 * The exception names a place instead: an Owner or Organizer with results in
 * but no preview mounted (a game opened on its standalone route). "An
 * organizer can add them" would send them looking for themselves.
 *
 * That exception is a WORKAROUND, not the design: the real fix is the preview
 * working wherever an add can happen, which deletes the "rosters" arm (#1594).
 */
export const NOT_ON_A_TEAM_NOTE = "An organizer can add them to a team.";
/** "Add them to a team in [Rosters]." — the word is a LINK that opens Rosters:
 *  a message that names the fix takes you there (9b look; same lesson as
 *  "Open {game}" on the roster preview's blocked sheet). */
export const NOT_ON_A_TEAM_ROSTERS_LEAD = "Add them to a team in";
export const NOT_ON_A_TEAM_ROSTERS_LINK = "Rosters";

export type NotOnATeamNote = "organizer" | "rosters" | null;

export function notOnATeamNote(p: {
  targets: BuilderTeam[];
  staff: boolean;
  hasResults: boolean;
  previewAvailable: boolean;
}): NotOnATeamNote {
  if (p.targets.length > 0) return null;
  if (p.staff && p.hasResults && !p.previewAvailable) return "rosters";
  return "organizer";
}

export function builderAddTargets(p: {
  teams: BuilderTeam[];
  slotTeamId?: string;
  staff: boolean;
  captainOf: (teamId: string) => boolean;
  hasResults: boolean;
  previewAvailable: boolean;
}): BuilderTeam[] {
  const candidates = p.slotTeamId ? p.teams.filter((t) => t.id === p.slotTeamId) : p.teams;
  return candidates.filter((t) => {
    const rights = rosterRights({
      staff: p.staff,
      captainOfTeam: p.captainOf(t.id),
      locked: p.hasResults,
      viewerId: null,
    });
    if (!rights.add) return false;
    return !p.hasResults || p.previewAvailable;
  });
}
