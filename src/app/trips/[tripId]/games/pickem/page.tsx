"use client";

import { PickemGameView } from "@/components/games/PickemGameView";

/**
 * Pick'em route — a thin wrapper over the re-hostable {@link PickemGameView}
 * (CLAUDE.md #12). The view reads its own tripId (`useTripId`) + gameId
 * (`?game=`), so this route and the leaderboard's game panel render ONE
 * component. Deep links, direct URLs and refresh land here; a tap from the board
 * opens the panel instead.
 */
export default function PickemGamePage() {
  return <PickemGameView />;
}
