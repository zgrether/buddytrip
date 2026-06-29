"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc-client";
import {
  ManualPlacementEditor,
  fmtValue,
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
  initialResult,
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
  /** Seed declared outcome for the match control — a team id (that side won) or
   *  "tie", derived from the posted cells (a draw = both at place 1). */
  initialResult?: string;
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
  const [result, setResult] = useState<string>(() => initialResult ?? initialOrder[0] ?? teams[0]?.id ?? "");
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
        <NonGolfMatchControl
          teams={teams}
          pointsInPlay={game.points_total ?? 0}
          result={result}
          onPick={canEdit ? setResult : () => {}}
        />
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

/**
 * NonGolfMatchControl (Part 3) — the declared-outcome control for a non-golf
 * head-to-head, modeled as a REAL one match: Team A **vs** Team B, with the
 * N points in play shown, and a declared outcome (win, or draw-and-split). It
 * replaces the old context-free "Who won?" toggle. The outcome still feeds the
 * existing path (a team id = that side won; "tie" = draw-split) — this is the
 * STRUCTURE (a readable one-match), not the full styled control.
 *
 * NOTE (follow-on, NOT this spec): the full visual REFRESH — proper VS framing,
 * points-in-play styling, match stylings echoing the golf match control's visual
 * language — is a deferred mockup pass. This is the correct-but-basic version.
 */
function NonGolfMatchControl({
  teams, pointsInPlay, result, onPick,
}: {
  teams: LBTeamLite[]; pointsInPlay: number; result: string; onPick: (r: string) => void;
}) {
  const [a, b] = teams;
  const split = fmtValue(pointsInPlay / 2);
  const win = fmtValue(pointsInPlay);

  const options: { id: string; label: string; pays: string; testid: string }[] = [
    { id: a?.id ?? "", label: `${a?.name ?? "Team A"} wins`, pays: `+${win}`, testid: `match-win-${a?.id}` },
    { id: "tie", label: "Draw — split", pays: `${split} each`, testid: "match-draw" },
    { id: b?.id ?? "", label: `${b?.name ?? "Team B"} wins`, pays: `+${win}`, testid: `match-win-${b?.id}` },
  ];

  return (
    <div className="flex flex-col gap-3">
      {/* The match: Team A vs Team B — the framing the bare "who won?" lacked. */}
      <div
        className="flex items-center justify-between gap-2 rounded-xl px-3 py-3"
        style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
        data-testid="match-framing"
      >
        <Side team={a} align="start" />
        <span className="shrink-0 text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>vs</span>
        <Side team={b} align="end" />
      </div>

      <div className="flex items-center justify-center gap-1.5 text-[12px]" style={{ color: "var(--color-bt-text-dim)" }}>
        <span className="font-semibold tabular-nums" style={{ color: "var(--color-bt-accent)" }}>{win}</span>
        {pointsInPlay === 1 ? "point" : "points"} in play
      </div>

      <div role="radiogroup" aria-label="Match outcome" className="space-y-1.5">
        {options.map((o) => {
          const sel = result === o.id;
          return (
            <button
              key={o.id || o.testid}
              type="button"
              role="radio"
              aria-checked={sel}
              onClick={() => onPick(o.id)}
              data-testid={o.testid}
              className="flex w-full items-center justify-between gap-2.5 rounded-lg px-3 py-3 text-left"
              style={{ background: sel ? "var(--color-bt-accent-faint)" : "var(--color-bt-card-raised)", border: `1px solid ${sel ? "var(--color-bt-accent-border)" : "var(--color-bt-border)"}` }}
            >
              <span className="min-w-0 flex-1 truncate text-sm font-semibold" style={{ color: sel ? "var(--color-bt-accent)" : "var(--color-bt-text)" }}>{o.label}</span>
              <span className="shrink-0 text-xs font-bold tabular-nums" style={{ color: sel ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)" }}>{o.pays}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Side({ team, align }: { team: LBTeamLite | undefined; align: "start" | "end" }) {
  return (
    <div className={`flex min-w-0 flex-1 items-center gap-2 ${align === "end" ? "flex-row-reverse text-right" : ""}`}>
      <span className="h-3.5 w-3.5 flex-shrink-0 rounded-full" style={{ background: team?.color ?? "var(--color-bt-text-dim)" }} />
      <span className="min-w-0 truncate text-sm font-bold" style={{ color: "var(--color-bt-text)" }}>{team?.name ?? "Team"}</span>
    </div>
  );
}
