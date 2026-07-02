"use client";

import { RackGameView } from "@/components/games/RackGameView";

/**
 * Rack-n-stack game route — a thin wrapper over the re-hostable {@link RackGameView}
 * (Spec 2 Phase 2). The view reads its own tripId (`useParams`) + gameId (`?game=`),
 * so the route and the leaderboard's game panel share ONE component. Deep-links /
 * direct URLs / refresh land here; taps from the board open the panel instead.
 */
export default function RackNStackPage() {
  return <RackGameView />;
}
