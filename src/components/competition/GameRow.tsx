"use client";

import Link from "next/link";
import { ChevronRight, Check, Radio } from "lucide-react";
import type { LBGame, LBTeam, LBCell } from "./CompetitionLeaderboard";

// ── Row helpers (own the board-row primitives) ────────────────────────────────

/** "8.5" → "8½", "14" → "14", "0.5" → "½" */
export function fmtPts(n: number): string {
  const whole = Math.floor(n);
  const isHalf = Math.abs(n - whole - 0.5) < 0.001;
  if (!isHalf) return String(whole);
  return whole === 0 ? "½" : `${whole}½`;
}

/** Map known game type IDs to their game board route segment. */
const GAME_ROUTES: Record<string, string> = {
  gtt_stroke_play: "new",
  gtt_match_play_singles: "match/new",
  gtt_match_play_doubles: "match/new",
  gtt_rack_n_stack: "rack/new",
};

export function gameHref(
  tripId: string,
  gameTypeId: string | null,
  gameId: string
): string | null {
  if (!gameTypeId) return null;
  const seg = GAME_ROUTES[gameTypeId];
  return seg ? `/trips/${tripId}/games/${seg}?game=${gameId}` : null;
}

/** The four leaderboard-row states (§7). */
export type RowState = "final" | "live" | "upcoming" | "unready";
export function rowStateOf(game: LBGame): RowState {
  if (game.status === "complete") return "final";
  if (game.status === "active") return "live";
  return game.ready === false ? "unready" : "upcoming";
}

// ── GameRow ────────────────────────────────────────────────────────────────────

/**
 * The canonical per-game board row. Today it renders the active-board layout
 * (two lines: name + a per-team score line or status text). The pre-game
 * "Schedule" variant still lives inline in EarlyState; it folds into this same
 * component behind a lifecycle-state prop next, and Phase 3 layers the §A state
 * machine on top. Extracted byte-identical from the former `SessionRow`.
 */
export function GameRow({
  game,
  teams,
  cells,
  tripId,
  mine,
  onPrefetch,
}: {
  game: LBGame;
  teams: LBTeam[];
  cells: Map<string, LBCell> | undefined;
  tripId: string;
  mine: boolean;
  onPrefetch: (gameId: string) => void;
}) {
  const href = gameHref(tripId, game.gameTypeId, game.id);
  const hasScores = cells && cells.size > 0;
  const state = rowStateOf(game);
  // Show the per-team result line only when there's a committed/in-progress
  // result; otherwise a single status line — NEVER an empty "– / –" (0–0) row.
  const showTeamLine = state === "final" || (state === "live" && hasScores);

  const inner = (
    <div className="flex flex-col gap-0.5 px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="truncate text-sm font-semibold"
            style={{ color: "var(--color-bt-text)" }}
          >
            {game.name}
          </span>
          {mine && <YoursBadge />}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <RowBadge state={state} />
          {href && (
            <ChevronRight size={14} style={{ color: "var(--color-bt-text-dim)" }} />
          )}
        </div>
      </div>

      {showTeamLine ? (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5">
          {teams.map((team) => {
            const cell = cells?.get(team.id);
            return (
              <span
                key={team.id}
                className="flex items-center gap-1 text-[12px]"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: team.color }} />
                <span style={{ color: team.color }}>{team.short_name}</span>
                <span style={{ color: "var(--color-bt-text)" }}>{cell ? fmtPts(cell.points) : "–"}</span>
              </span>
            );
          })}
        </div>
      ) : (
        <span
          className="text-[12px]"
          style={{ color: state === "unready" ? "var(--color-bt-warning)" : "var(--color-bt-text-dim)" }}
        >
          {state === "live"
            ? "Underway · scoring"
            : state === "unready"
              ? "Not scoring yet — still being set up"
              : "Not started yet"}
        </span>
      )}
    </div>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="block hover:opacity-80 transition-opacity"
        onPointerEnter={() => onPrefetch(game.id)}
        onPointerDown={() => onPrefetch(game.id)}
      >
        {inner}
      </Link>
    );
  }
  return <div>{inner}</div>;
}

export function RowBadge({ state }: { state: RowState }) {
  if (state === "final") {
    return (
      <span className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: "var(--color-bt-card-raised)", color: "var(--color-bt-text-dim)" }}>
        <Check size={9} />
        Final
      </span>
    );
  }
  if (state === "live") {
    return (
      <span className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: "var(--color-bt-accent-faint)", color: "var(--color-bt-accent)", border: "1px solid var(--color-bt-accent-border)" }}>
        <Radio size={9} />
        Live
      </span>
    );
  }
  if (state === "unready") {
    return (
      <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: "var(--color-bt-warning-faint)", color: "var(--color-bt-warning)" }}>
        Needs setup
      </span>
    );
  }
  // upcoming
  return (
    <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: "var(--color-bt-card-raised)", color: "var(--color-bt-text-dim)" }}>
      Upcoming
    </span>
  );
}

/** "Yours" — marks a game the viewer is the delegate of (§10). Display-only;
 *  the controls live on the game page, not the board row (§5). */
export function YoursBadge() {
  return (
    <span
      className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold"
      style={{
        background: "var(--color-bt-accent-faint)",
        color: "var(--color-bt-accent)",
        border: "1px solid var(--color-bt-accent-border)",
      }}
      data-testid="game-yours-badge"
    >
      Yours
    </span>
  );
}
