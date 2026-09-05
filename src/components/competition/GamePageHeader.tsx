"use client";

import { trpc } from "@/lib/trpc-client";
import { LEADERBOARD_QUERY } from "@/lib/queryConfig";
import { useRealtimeScoreEvents } from "@/hooks/useRealtimeScoreEvents";
import { CollapsedHero, ProjectionRow } from "./CompetitionHero";

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
 * Row 2 — the per-team PROJECTION (#533) — is an optional second row inside the
 * same card: "if this game ended now, what does each team add to the cup?" The
 * PAGE computes it (a presentation rollup of the results already on the scoreboard
 * — match strips / rack projection / non-golf cells; see gameProjection.ts) and
 * passes it in via `projection`. There is no row 2 for stroke (nothing on-page to
 * roll up) and none in setup mode — the page just omits the prop. `final` swaps
 * the desaturated "projected" tone for the solid contribution once complete.
 *
 * Reads the PERSISTED competition board (`competitions.leaderboard`) — the same
 * source the leaderboard hero reads, so the two can't diverge. Renders nothing for
 * a standalone (non-competition) game or before the board loads.
 */
export function GamePageHeader({
  tripId,
  competitionId,
  stickyTop = 0,
  projection,
}: {
  tripId: string | undefined;
  competitionId: string | null | undefined;
  /** Pin offset below the page's own top bar (0 when the bar scrolls away). */
  stickyTop?: number;
  /** Row 2 — the per-team projected/final contribution for THIS game (#533).
   *  Omit for stroke or in setup mode (no row 2 renders). */
  projection?: { perTeam: Record<string, number>; gameName: string; final: boolean };
}) {
  // Live standings on the game surface too — otherwise this header would sit on
  // the 5-minute backstop alone. Under the panel model (#12) the board is often
  // still mounted underneath, subscribed to this same topic; the hook
  // ref-counts, so that's one shared channel, not two.
  useRealtimeScoreEvents(tripId, competitionId);

  // STATE query, not STRUCTURE — this is the same live `competitions.leaderboard`
  // key CompetitionLeaderboard reads; LEADERBOARD_QUERY is that exact policy
  // (queryConfig.ts) so standings don't freeze on the standalone game routes
  // where that's the only observer on this key.
  const lb = trpc.competitions.leaderboard.useQuery(
    { tripId: tripId ?? "", competitionId: competitionId ?? "" },
    { ...LEADERBOARD_QUERY, enabled: !!tripId && !!competitionId }
  );
  const d = lb.data;
  if (!competitionId || !d || !d.teams?.length) return null;

  const clincher = d.teams.find((t) => (d.pointsToClinch?.[t.id] ?? 1) <= 0) ?? null;

  return (
    <div
      /*
       * `py-3`, not `pt-3` — the bottom half was missing and this header is
       * STICKY, so content scrolls up to meet its edge with no gap at all. It
       * reads as sliding through the header, and it was reported that way.
       *
       * NOTHING IS TRANSPARENT. This box is opaque `--color-bt-base`, and a
       * sweep of every sticky element on these surfaces found all six correctly
       * backed. The defect is the absent gap; the occlusion was working the
       * whole time.
       *
       * Same shape as `GameLifecycleActions`' finalize arm, fixed in the same
       * pass: a gap that other surfaces supplied from a neighbour, so the
       * element never carried its own. Twice in one session — when a sticky
       * element meets scrolling content the gap belongs to the STICKY one,
       * because it is the only participant that knows it is being scrolled
       * under.
       */
      className="px-4 py-3"
      style={{ position: "sticky", top: stickyTop, zIndex: 20, background: "var(--color-bt-base)" }}
      data-testid="game-page-header"
    >
      <CollapsedHero
        teams={d.teams}
        teamTotals={d.teamTotals}
        winNumber={d.winNumber}
        pointsAvailable={d.pointsAvailable}
        clincher={clincher}
        // Type-gate the "first to X" target line off for points cups — the same
        // gate #655 applied to the competition board (points has no clinch ceiling).
        scoringModel={d.scoringModel}
        footer={
          projection ? (
            <ProjectionRow
              teams={d.teams}

              perTeam={projection.perTeam}
              final={projection.final}
            />
          ) : undefined
        }
      />
    </div>
  );
}
