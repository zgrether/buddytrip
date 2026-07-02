"use client";

import { NonGolfGameView } from "@/components/games/NonGolfGameView";

/**
 * Non-golf (manual) game route — a thin wrapper over the re-hostable
 * {@link NonGolfGameView} (Spec 2 Phase 2). The view reads its own tripId
 * (`useParams`) + gameId (`?game=`), so the route and the leaderboard's game panel
 * share ONE component. Deep-links / direct URLs / refresh land here; taps from the
 * board open the panel instead.
 */
export default function ManualGamePage() {
  return <NonGolfGameView />;
}
