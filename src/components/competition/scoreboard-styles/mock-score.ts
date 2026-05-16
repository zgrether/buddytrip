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
 * Where the owner's manual event-placement entries live until the
 * real scoring API ships. Shared between the event detail page (which
 * writes them) and `buildMockData` (which reads them).
 *
 * Shape: teamId → 1-based finishing place for this event.
 */
export const placementsKey = (eventId: string) =>
  `bt-event-placements-${eventId}`;

export function loadPlacements(
  eventId: string
): Record<string, number> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(placementsKey(eventId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, number>;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function savePlacements(
  eventId: string,
  placements: Record<string, number>
): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    placementsKey(eventId),
    JSON.stringify(placements)
  );
}

/**
 * Deterministic mock score generator.
 *
 * For each event:
 *   - If the owner saved manual placements via the event detail page,
 *     use those (teamId → place lookup).
 *   - Otherwise fall back to a rotating pattern that distributes the
 *     event's point_distributions across teams so the scoreboard
 *     styles render with varied-looking data even before any input.
 *
 * Once the scoring API lands, this gets replaced with a real query;
 * every style consumes `ScoreboardData` unchanged.
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

  events.forEach((event, eIdx) => {
    const dists = event.point_distributions ?? [];
    const overrides = loadPlacements(event.id);

    teams.forEach((team, tIdx) => {
      const override = overrides?.[team.id];
      const place =
        override && override > 0
          ? override
          : teams.length > 0
          ? ((tIdx + eIdx) % teams.length) + 1
          : 1;
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
