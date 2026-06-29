"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc-client";
import {
  WinLoseTieEditor,
  ManualPlacementEditor,
  type GameRow,
  type LBTeamLite,
} from "@/components/competition/CompetitionGamesPanel";
import type { ScoringModel } from "@/lib/gameTypes";

/**
 * NonGolfScoreboard — the scoring-mode body of the non-golf scoreboard page
 * (W-NONGOLF lifecycle surface). This is the **promoted post-results modal**: the
 * old `RunSheet` body, lifted out of the modal to become the live board you land
 * on from the leaderboard. It owns its own post like the modal did (the non-golf
 * world keeps tRPC in the surface — these aren't the pure golf scorecard
 * components), branching the result editor on the competition's `scoring_model`:
 *  - **match_play** (head-to-head, 2 teams): the declared-outcome control
 *    (Part 3 gives it Team-A-vs-B framing + points-in-play).
 *  - **points** / >2 teams: the finishing-order placement editor (#430).
 *
 * Posting feeds the EXISTING `games.post` path (winner→pos 1 / tie→both pos 1 /
 * placement order) — no second points mechanism. Members get the read-only board;
 * the post CTA is owner/delegate-only (the server enforces it too).
 */
export function NonGolfScoreboard({
  tripId,
  competitionId,
  game,
  teams,
  scoringModel,
  initialOrder,
  canEdit,
  onPosted,
}: {
  tripId: string;
  competitionId: string;
  game: GameRow;
  teams: LBTeamLite[];
  scoringModel: ScoringModel;
  /** Seed order for the placement editor (posted cells when correcting, else roster). */
  initialOrder: string[];
  canEdit: boolean;
  /** Posted successfully — the page navigates back to the leaderboard. */
  onPosted: () => void;
}) {
  const utils = trpc.useUtils();
  // Head-to-head win/lose/tie is a manual match-play game with exactly two sides;
  // anything else (points model, >2 teams) keeps the finishing-order editor.
  const winLoseTie = scoringModel === "match_play" && teams.length === 2;
  const dist = game.points_distribution?.type === "placement" ? game.points_distribution.values : [];

  const [order, setOrder] = useState<string[]>(initialOrder.length ? initialOrder : teams.map((t) => t.id));
  const [result, setResult] = useState<string>(() => initialOrder[0] ?? teams[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);

  // complete + !corrections_open → "posted" (re-post re-runs the compute); active
  // → "open"; pending shouldn't reach the board (setup mode), but treat as open.
  const correcting = game.status === "complete";

  const post = trpc.games.post.useMutation();
  const busy = post.isPending;

  function teamById(id: string) {
    return teams.find((t) => t.id === id);
  }
  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    setOrder(next);
  }

  async function commit() {
    setError(null);
    try {
      const placements = winLoseTie
        ? result === "tie"
          ? teams.map((t) => ({ entityId: t.id, position: 1 }))
          : teams.map((t) => ({ entityId: t.id, position: t.id === result ? 1 : 2 }))
        : order.map((id, i) => ({ entityId: id, position: i + 1 }));
      await post.mutateAsync({ tripId, gameId: game.id, placements });
      utils.games.listByTrip.invalidate({ tripId });
      utils.competitions.leaderboard.invalidate({ tripId, competitionId });
      // The Live face seeds its board from faceBootstrap — invalidate it so the
      // posted result lands without a hard refresh (CLAUDE.md #10).
      utils.competitions.faceBootstrap.invalidate({ tripId });
      onPosted();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to post");
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-3 px-4 py-5">
      {correcting && (
        <div
          className="rounded-lg px-3 py-2.5 text-[11px] leading-relaxed"
          style={{ background: "var(--color-bt-warning-faint)", border: "1px solid var(--color-bt-warning)", color: "var(--color-bt-warning)" }}
        >
          This game is posted — re-posting recomputes the leaderboard.
        </div>
      )}

      {winLoseTie ? (
        <WinLoseTieEditor teams={teams} result={result} onPick={canEdit ? setResult : () => {}} />
      ) : (
        <ManualPlacementEditor order={order} teams={teams} dist={dist} teamById={teamById} move={canEdit ? move : () => {}} />
      )}

      {error && <p className="text-xs" style={{ color: "var(--color-bt-danger)" }}>{error}</p>}

      {canEdit && (
        <button
          type="button"
          onClick={commit}
          disabled={busy}
          data-testid="nongolf-post"
          className="w-full rounded-xl py-3 text-sm font-bold disabled:opacity-50"
          style={{ background: correcting ? "var(--color-bt-warning)" : "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
        >
          {correcting ? "Re-post" : "Post results"}
        </button>
      )}
    </div>
  );
}
