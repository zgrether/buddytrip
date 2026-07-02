"use client";

import { StrokeGameView } from "@/components/games/StrokeGameView";

/**
 * Stroke-play game route — a thin wrapper over the re-hostable {@link StrokeGameView}
 * (Spec 2 Phase 3). The view reads its own tripId (`useParams`) + gameId (`?game=`),
 * so the route and the leaderboard's game panel share ONE component. Deep-links /
 * direct URLs / refresh land here; taps from the board open the panel instead.
 */
export default function NewGamePage() {
  return <StrokeGameView />;
}
