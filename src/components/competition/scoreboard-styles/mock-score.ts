import type {
  ScoreboardCell,
  ScoreboardData,
  ScoreboardEvent,
  ScoreboardTeam,
} from "./types";

interface EventWithDistributions extends ScoreboardEvent {
  point_distributions?: Array<{ position: number; points: number }>;
}

/**
 * Deterministic mock score generator.
 *
 * Walks each event's `point_distributions` and assigns them to teams in
 * a rotating order so every team "finishes" in a different place across
 * events — gives the style components varied-looking data to render
 * while the actual scoring backend is still under construction.
 *
 * Once the scoring API lands, this gets replaced with a real query;
 * every style consumes `ScoreboardData` unchanged.
 */
export function buildMockData(
  teams: ScoreboardTeam[],
  events: EventWithDistributions[]
): ScoreboardData {
  const cells: ScoreboardCell[] = [];
  const totals: Record<string, number> = Object.fromEntries(
    teams.map((t) => [t.id, 0])
  );

  events.forEach((event, eIdx) => {
    const dists = event.point_distributions ?? [];
    teams.forEach((team, tIdx) => {
      // Rotate placement so team A isn't always 1st.
      const placeIdx =
        teams.length > 0 ? (tIdx + eIdx) % teams.length : 0;
      const place = placeIdx + 1;
      const dist = dists.find((d) => d.position === place);
      const points = dist?.points ?? 0;
      cells.push({ teamId: team.id, eventId: event.id, points, place });
      totals[team.id] += points;
    });
  });

  const totalAvailable = events.reduce(
    (s, e) => s + (e.points_available ?? 0),
    0
  );

  return { teams, events, cells, totals, totalAvailable };
}

export function getCell(
  data: ScoreboardData,
  teamId: string,
  eventId: string
): ScoreboardCell | undefined {
  return data.cells.find(
    (c) => c.teamId === teamId && c.eventId === eventId
  );
}

/** Round-half-even with 2-decimal display for places that allow half points. */
export function fmtPts(n: number): string {
  if (Number.isInteger(n)) return n.toString();
  return n.toFixed(1);
}
