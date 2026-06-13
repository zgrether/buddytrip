// ── Shared types & metadata for scoreboard style variants ─────────────────
//
// Every style component takes the same `ScoreboardData` so swapping
// between them is a one-line change in the orchestrator. The mock-score
// builder produces deterministic placeholder scores while the actual
// scoring backend is still under construction.

export type ScoreboardStyleId =
  | "grid"
  | "leaderboard"
  | "heatmap"
  | "cards"
  | "bars"
  | "podium"
  | "stadium"
  | "minimal";

export const DEFAULT_STYLE: ScoreboardStyleId = "grid";

export interface ScoreboardTeam {
  id: string;
  name: string;
  short_name: string;
  color: string;
}

export interface ScoreboardEvent {
  id: string;
  title: string;
  points_available: number | null;
}

export interface ScoreboardCell {
  teamId: string;
  eventId: string;
  points: number;
  /** 1-based finishing place within this event. */
  place: number;
}

export interface ScoreboardData {
  /** Carried through for styles that need trip-scoped routing (a per-game
   *  detail/placement page is a follow-on; cells are non-navigating for now). */
  tripId: string;
  teams: ScoreboardTeam[];
  events: ScoreboardEvent[];
  cells: ScoreboardCell[];
  /** teamId → total points across all events. */
  totals: Record<string, number>;
  /** Sum of `points_available` across all events. */
  totalAvailable: number;
}

export interface StyleProps {
  data: ScoreboardData;
}

export const STYLE_META: Record<
  ScoreboardStyleId,
  { label: string; description: string }
> = {
  grid: {
    label: "Grid",
    description: "Classic table — events down, teams across",
  },
  leaderboard: {
    label: "Leaderboard",
    description: "Teams ranked by total, biggest at the top",
  },
  heatmap: {
    label: "Heatmap",
    description: "Grid with cells colored by finishing place",
  },
  cards: {
    label: "Cards",
    description: "One card per event, teams ranked inside",
  },
  bars: {
    label: "Bars",
    description: "Horizontal bars showing each team's share",
  },
  podium: {
    label: "Podium",
    description: "Top three on a podium, rest below",
  },
  stadium: {
    label: "Stadium",
    description: "Jumbotron-style giant numbers",
  },
  minimal: {
    label: "Minimal",
    description: "Stripped down — names and numbers only",
  },
};

// ── Place colors — used by Heatmap and any other style that wants to
// communicate finishing position via color. Matches the spreadsheet
// convention (green = 1st, blue = 2nd, amber = 3rd, red = 4th+).
// Resolves to CSS variables defined in globals.css so the actual
// colors swap between light and dark mode (dark text on tinted bg
// in light mode; pastel text on slightly deeper tints in dark mode).
export const PLACE_COLORS: Record<number, { bg: string; text: string }> = {
  1: { bg: "var(--color-bt-place-1-bg)", text: "var(--color-bt-place-1-text)" },
  2: { bg: "var(--color-bt-place-2-bg)", text: "var(--color-bt-place-2-text)" },
  3: { bg: "var(--color-bt-place-3-bg)", text: "var(--color-bt-place-3-text)" },
  4: { bg: "var(--color-bt-place-4-bg)", text: "var(--color-bt-place-4-text)" },
};

/** Neutral cell style for unscored placements (place === 0). */
const PLACE_NEUTRAL = {
  bg: "transparent",
  text: "var(--color-bt-text-dim)",
};

export function placeStyle(place: number) {
  if (place <= 0) return PLACE_NEUTRAL;
  return PLACE_COLORS[place] ?? PLACE_COLORS[4];
}

export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
