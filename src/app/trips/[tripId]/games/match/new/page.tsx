"use client";

import { MatchGameView } from "@/components/games/MatchGameView";

/**
 * Match-play game route — a thin wrapper over the re-hostable {@link MatchGameView}
 * (Spec 2 Phase 1). The view reads its own tripId (`useParams`) + gameId (`?game=`),
 * so the route and the leaderboard's game panel share ONE component. Deep-links /
 * direct URLs / refresh still land here; taps from the board open the panel instead.
 */
export default function NewMatchGamePage() {
  return <MatchGameView />;
}
