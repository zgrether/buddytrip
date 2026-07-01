"use client";

import { trpc } from "@/lib/trpc-client";
import { STRUCTURE_QUERY } from "@/lib/queryConfig";
import { CollapsedHero } from "./CompetitionHero";

/**
 * GamePageHeader (Spec: standard game header) — the shared header for the four
 * game-page scoreboard surfaces (stroke / match / rack / non-golf). ROW 1 is the
 * collapsed hero — IDENTICAL to the leaderboard's sticky bar (same `CollapsedHero`
 * component, one home): the cup's team names + scores + "first to X", neutral
 * chrome, NO roster button (that's leaderboard-only, competition-management).
 *
 * Sticky at the top of the game page so it pins while the match/group list scrolls
 * under it. `stickyTop` offsets it below the page's own nav bar.
 *
 * Row 2 — the per-team projection — is DEFERRED (issue #533): a uniform live
 * "project this game → per-team points" doesn't exist for match-play/stroke yet.
 * It slots directly beneath row 1 here when built.
 *
 * Reads the PERSISTED competition board (`competitions.leaderboard`) — the same
 * source the leaderboard hero reads, so the two can't diverge. Renders nothing for
 * a standalone (non-competition) game or before the board loads.
 */
export function GamePageHeader({
  tripId,
  competitionId,
  stickyTop = 0,
}: {
  tripId: string | undefined;
  competitionId: string | null | undefined;
  /** Pin offset below the page's own top bar (0 when the bar scrolls away). */
  stickyTop?: number;
}) {
  const lb = trpc.competitions.leaderboard.useQuery(
    { tripId: tripId ?? "", competitionId: competitionId ?? "" },
    { ...STRUCTURE_QUERY, enabled: !!tripId && !!competitionId }
  );
  const d = lb.data;
  if (!competitionId || !d || !d.teams?.length) return null;

  const clincher = d.teams.find((t) => (d.pointsToClinch?.[t.id] ?? 1) <= 0) ?? null;

  return (
    <div
      className="px-4 pt-3"
      style={{ position: "sticky", top: stickyTop, zIndex: 20, background: "var(--color-bt-base)" }}
      data-testid="game-page-header"
    >
      <CollapsedHero
        teams={d.teams}
        teamTotals={d.teamTotals}
        winNumber={d.winNumber}
        pointsAvailable={d.pointsAvailable}
        clincher={clincher}
      />
    </div>
  );
}
