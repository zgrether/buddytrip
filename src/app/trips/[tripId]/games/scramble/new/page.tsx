"use client";

import { StrokeGameView } from "@/components/games/StrokeGameView";

/**
 * Scramble game route — a thin wrapper over the SAME {@link StrokeGameView} the
 * stroke-play route renders (CLAUDE.md #12: the route is a thin wrapper, the
 * leaderboard opens the identical component as a panel).
 *
 * It is the same component and not a `ScrambleGameView` deliberately. Scramble
 * is stroke play with a different SCORER: the participant is the team's
 * play_group instead of a user, which is an INPUT to that view rather than a
 * different structure. A second view would be a fifth private copy of the
 * lifecycle gate, the chrome publisher, the config-sync poll, the score outbox
 * and the settings draft — CLAUDE.md #24 counts seven incidents of exactly that
 * shape, and it names the eighth arriving as a new per-format surface reading
 * the same state privately.
 *
 * The view learns which it is from `games.game_type_id` on the row it already
 * fetches, never from a prop. A prop would be a second source of that fact that
 * has to agree with the row, which is the drift this file exists to avoid.
 */
export default function ScrambleGamePage() {
  return <StrokeGameView />;
}
