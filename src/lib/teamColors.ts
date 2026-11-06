/**
 * The team color palette — ONE source, shared by the team editor (TeamsPanel, client)
 * and the auto-seeding of default teams at competition create (competitions.create,
 * server). Pure data, so it's safe on both sides.
 */

export interface TeamColorSwatch {
  color: string;
  colorDim: string;
  label: string;
}

/** The palette shown in the team editor's color picker. */
export const TEAM_COLORS: TeamColorSwatch[] = [
  { color: "#3b82f6", colorDim: "#0a1a2a", label: "Blue" },
  { color: "#22c55e", colorDim: "#0a2a0f", label: "Green" },
  { color: "#a855f7", colorDim: "#1a0a2a", label: "Purple" },
  { color: "#06b6d4", colorDim: "#0a1f2a", label: "Cyan" },
  { color: "#ef4444", colorDim: "#2a0a0a", label: "Red" },
  { color: "#f59e0b", colorDim: "#2a1f00", label: "Amber" },
  { color: "#ec4899", colorDim: "#2a0a1a", label: "Pink" },
  { color: "#f97316", colorDim: "#2a1200", label: "Orange" },
];

/** One team per color (migration 223): this is the most a competition can have. */
export const MAX_TEAMS = TEAM_COLORS.length;

/** Why there cannot be another team. Zach's words, 2026-11-05. */
export const TEAM_CAP_LINE = `A tournament can have ${MAX_TEAMS} teams, one per color.`;

/** Lowercased color → the short name of the team holding it. */
export type TakenTeamColors = ReadonlyMap<string, string>;

/** The colors other teams hold, by the rule the database index reads: case and
 *  surrounding spaces ignored. `ownTeamId` is the team being edited, whose own
 *  color is not taken from it. */
export function takenTeamColors(
  teams: readonly { id: string; color: string; short_name: string }[],
  ownTeamId: string | null
): TakenTeamColors {
  return new Map(teams.filter((t) => t.id !== ownTeamId).map((t) => [t.color.trim().toLowerCase(), t.short_name]));
}

/** The first palette color nobody holds, so each added team starts distinct. With
 *  none free the competition is at its cap, and the first swatch is as good as any. */
export function firstFreeColorIndex(taken: TakenTeamColors): number {
  return Math.max(0, TEAM_COLORS.findIndex((c) => !taken.has(c.color.toLowerCase())));
}

/**
 * Colors for auto-seeded default teams (Team A, Team B, …) at competition create.
 * Blue + Red lead — the classic high-contrast 2-team default, unchanged from before
 * the team-count picker — then the rest of the palette for the 3rd/4th/… team.
 */
export const SEED_TEAM_COLORS: TeamColorSwatch[] = [
  TEAM_COLORS[0], // Blue  — Team A
  TEAM_COLORS[4], // Red   — Team B
  TEAM_COLORS[1], // Green — Team C
  TEAM_COLORS[2], // Purple — Team D
  TEAM_COLORS[3], // Cyan
  TEAM_COLORS[5], // Amber
  TEAM_COLORS[6], // Pink
  TEAM_COLORS[7], // Orange
];

/** The largest team count the create picker offers (default-named A–D). More teams
 *  can be added afterward in the team editor. */
export const MAX_SEED_TEAMS = 4;

/** Default name / short name for the i-th auto-seeded team (0 → "Team A" / "A"). */
export function seedTeamName(i: number): { name: string; shortName: string } {
  const letter = String.fromCharCode(65 + i); // A, B, C, …
  return { name: `Team ${letter}`, shortName: letter };
}


/**
 * The short name the team sheet SUGGESTS for a name (the person can still type
 * their own). A leading "Team " is dropped first, as for the badge letter, so a
 * name in the app's own "Team A" / "Team B" style suggests A, B, C… rather than
 * "TEA" for every one of them — which migration 219's short-name index would
 * refuse from the second team on.
 */
export function suggestShortName(name: string): string {
  const stripped = name.trim().replace(/^team\s+/i, "");
  return (stripped || name).replace(/\s+/g, "").slice(0, 3).toUpperCase();
}
