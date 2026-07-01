"use client";

import { MemberSetupView } from "./MemberSetupView";
import type { GameRow } from "@/components/competition/CompetitionGamesPanel";

/**
 * MemberNotReady — the golf match page's member-facing not-ready surface. Now a
 * thin wrapper over the shared `MemberSetupView` so it renders identically to the
 * stroke/rack/manual member placeholder (`SetupPlaceholder`'s member path).
 *
 * The two entry components (this + SetupPlaceholder) are intentionally NOT
 * consolidated in this PR — the shared body is dropped into both; the
 * consolidation is logged as debt (DEFERRED.md).
 */
export function MemberNotReady({
  tripId,
  game,
}: {
  tripId: string;
  game: GameRow | null | undefined;
}) {
  return <MemberSetupView tripId={tripId} game={game} />;
}
