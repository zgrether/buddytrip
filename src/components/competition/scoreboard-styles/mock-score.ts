import type {
  ScoreboardCell,
  ScoreboardData,
  ScoreboardEvent,
  ScoreboardTeam,
} from "./types";

interface EventWithDistributions extends ScoreboardEvent {
  point_distributions?: Array<{ position: number; points: number }>;
  /** JSONB `events.result` column — { placements: { teamId: place } }.
   *  Lives on the event row so all crew members see the same scores
   *  via the regular tRPC cache + realtime channel. */
  result?: { placements?: Record<string, number> } | null;
}

/** Pull placements off an event row's result JSONB. Tolerant of legacy
 *  null/empty shapes. */
export function readPlacements(
  event: EventWithDistributions | null | undefined
): Record<string, number> | null {
  const placements = event?.result?.placements;
  if (!placements || typeof placements !== "object") return null;
  return placements;
}

/**
 * Builds the scoreboard data structure from teams + events.
 *
 * Cells only carry a place/points value when the owner has saved
 * manual placements for that event via the event detail page. The
 * placements live on `events.result.placements` (JSONB) so they sync
 * across crew via the events.list query + realtime.
 *
 * Events without any saved placements render as blank cells — no
 * fake demo scores — so a freshly added event starts unscored, not
 * phantom-populated.
 */
export function buildMockData(
  tripId: string,
  teams: ScoreboardTeam[],
  events: EventWithDistributions[]
): ScoreboardData {
  const cells: ScoreboardCell[] = [];
  const totals: Record<string, number> = Object.fromEntries(
    teams.map((t) => [t.id, 0])
  );

  events.forEach((event) => {
    const dists = event.point_distributions ?? [];
    const placements = readPlacements(event);

    teams.forEach((team) => {
      const place = placements?.[team.id] ?? 0;
      const dist = place > 0 ? dists.find((d) => d.position === place) : undefined;
      const points = dist?.points ?? 0;
      cells.push({ teamId: team.id, eventId: event.id, points, place });
      totals[team.id] += points;
    });
  });

  const totalAvailable = events.reduce(
    (s, e) => s + (e.points_available ?? 0),
    0
  );

  return { tripId, teams, events, cells, totals, totalAvailable };
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

/** Round-half-even with 1-decimal display for places that allow half points. */
export function fmtPts(n: number): string {
  if (Number.isInteger(n)) return n.toString();
  return n.toFixed(1);
}
