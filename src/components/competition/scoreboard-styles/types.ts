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
  /** Carried through so event-listing styles can link cells to the
   *  event detail page at `/trips/{tripId}/events/{eventId}`. */
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
export const PLACE_COLORS: Record<number, { bg: string; text: string }> = {
  1: { bg: "rgba(34, 197, 94, 0.20)", text: "#86efac" },
  2: { bg: "rgba(59, 130, 246, 0.22)", text: "#93c5fd" },
  3: { bg: "rgba(245, 158, 11, 0.22)", text: "#fcd34d" },
  4: { bg: "rgba(239, 68, 68, 0.20)", text: "#fca5a5" },
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
