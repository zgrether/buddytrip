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
