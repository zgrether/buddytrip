"use client";

/**
 * useRealtimeLeaderboard — STUBBED in Phase A.
 *
 * The legacy hook subscribed to `group_results` (filtered by event_id) and
 * `side_events` to refresh the live leaderboard. Migration 062 retired the
 * old events shape and dropped the `side_events` table; the new event
 * model isn't wired through to scoring yet (Phase B).
 *
 * Exporting a no-op keeps the existing imports compiling. The leaderboard
 * page itself renders a placeholder until Phase B rebuilds scoring.
 */
export function useRealtimeLeaderboard(_tripId: string, _eventId: string) {
  // intentionally empty — Phase B re-implements against the new schema.
}
