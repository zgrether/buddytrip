"use client";

import Link from "next/link";
import { Radio, Flag, Swords, Layers, Gamepad2, ClipboardList } from "lucide-react";
import type { LucideIcon } from "lucide-react";
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

/** §A1 format icon — the leading glyph that names the game's format, glanceable
 *  down the board. Its COLOR carries the arming tell (§A4, applied in Commit 3);
 *  the glyph itself just identifies the format. Unknown types fall back to a
 *  generic game glyph rather than going blank. */
const FORMAT_ICONS: Record<string, LucideIcon> = {
  gtt_stroke_play: Flag,
  gtt_match_play_singles: Swords,
  gtt_match_play_doubles: Swords,
  gtt_rack_n_stack: Layers,
};
export function formatIcon(gameTypeId: string | null): LucideIcon {
  return (gameTypeId && FORMAT_ICONS[gameTypeId]) || Gamepad2;
}

/** Golf games carry a scorecard (§A3 scorecard column is golf-only). Today every
 *  built format is golf — proxy "golf" by "has a known game-board route"; a
 *  manual win/lose/halve side event (no route) is correctly excluded. */
export function isGolfFormat(gameTypeId: string | null): boolean {
  return !!gameTypeId && gameTypeId in GAME_ROUTES;
}

/**
 * The §A lifecycle state the row reads — replaces the old 4-value RowState.
 * DERIVED from the game's actual status + points-config; it is the row's single
 * source of truth, not a layout flag (§A2). The two gravy sub-states are carried
 * as data ON TOP of these four, not as extra enum values: "configuring" is a
 * partial "setting-up", and "armed vs not-armed" lives inside "ready" (carried
 * by the format-icon color, §A4 — wired to this derived value, never a literal
 * board/layout string).
 */
export type LifecycleState = "setting-up" | "ready" | "live" | "final";
export function lifecycleOf(game: LBGame): LifecycleState {
  if (game.status === "complete") return "final";
  if (game.status === "active") return "live";
  return game.ready === false ? "setting-up" : "ready";
}

/**
 * §A4 arm signal: the format-icon shows full color when scoring is enabled,
 * muted while the game is still being set up. There is no `scoring_enabled`
 * field yet (Phase 2's Enable/Disable adds it), so for now arm == "structure is
 * done": muted iff setting-up/configuring, full-color otherwise. Wired to the
 * DERIVED lifecycle, so swapping in the real field later is a one-line change.
 */
export function iconArmed(lifecycle: LifecycleState): boolean {
  return lifecycle !== "setting-up";
}

// ── GameRow ────────────────────────────────────────────────────────────────────

/**
 * The canonical per-game board row (§A1). One column skeleton for every
 * lifecycle state:
 *
 *   [format icon] [ name + delegate / subtitle ] [scorecard btn] [ pts-or-result ]
 *
 * - `pts-or-result` is the outermost column, pinned to the right edge and
 *   right-aligned (§A4): `N PTS` (potential) while unresolved, the stacked team
 *   result at Final. It is ALWAYS present, so the right edge never reflows.
 * - `scorecard btn` sits just inboard of it — golf-only, and dropped at Final —
 *   so the column that vanishes is the inner one and the outer edge holds steady.
 * - the format icon's color is the arming tell (§A4); the name never gets
 *   crowded out (§A6). The full §A3 layer table (outline / name strength / the
 *   one Live background / LIVE badge) lands in Commit 3.
 *
 * Subtitle and name+delegate stack vertically inside the name column (mobile —
 * keeps the name uncrowded); the delegate chip travels with the name (§A1) and
 * drops at Final alongside the scorecard (round-3.1 §A2).
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
  // The row's single source of truth — the game's actual lifecycle, not a board
  // context flag. Layout + (Commit 3) every layer key off this one value.
  const lifecycle = lifecycleOf(game);
  const isFinal = lifecycle === "final";

  const Icon = formatIcon(game.gameTypeId);
  // Final sheds the operational layer (scorecard + delegate), keeps the result
  // (round-3.1 §A2). The scorecard column is golf-only and present everywhere
  // EXCEPT Final.
  const showScorecard = isGolfFormat(game.gameTypeId) && !isFinal;
  const showDelegate = mine && !isFinal;

  // Subtitle / running state (§A3). Setting-up + Final carry none — the dashed
  // outline (Commit 3) and the outer result speak for them. Live's real running
  // state ("Blue 2 up · thru 13") is deferred to a state-driven slot.
  const subtitle =
    lifecycle === "live"
      ? "Underway · scoring"
      : lifecycle === "ready"
      ? "Ready to play"
      : null;

  const inner = (
    <div className="flex items-center gap-3 px-4 py-3">
      {/* Format icon */}
      <Icon
        size={18}
        className="shrink-0"
        style={{
          color: iconArmed(lifecycle)
            ? "var(--color-bt-text)"
            : "var(--color-bt-text-dim)",
        }}
      />

      {/* Name + delegate, subtitle stacked beneath */}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="truncate text-sm font-semibold"
            style={{ color: "var(--color-bt-text)" }}
          >
            {game.name}
          </span>
          {showDelegate && <YoursBadge />}
          {lifecycle === "live" && <LiveBadge />}
        </div>
        {subtitle && (
          <span className="text-[12px]" style={{ color: "var(--color-bt-text-dim)" }}>
            {subtitle}
          </span>
        )}
      </div>

      {/* Scorecard button (golf-only, dropped at Final) — inboard of the outer
          column so the right edge holds when it vanishes. */}
      {showScorecard && (
        <span
          className="flex shrink-0 items-center justify-center rounded-lg"
          style={{
            width: 30,
            height: 30,
            background: "var(--color-bt-card-raised)",
            color: "var(--color-bt-text-dim)",
          }}
          aria-hidden
        >
          <ClipboardList size={15} />
        </span>
      )}

      {/* Outer column — pts-or-result, pinned right, right-aligned (§A5). */}
      <div className="flex shrink-0 flex-col items-end" style={{ minWidth: 44 }}>
        <OuterColumn game={game} teams={teams} cells={cells} isFinal={isFinal} hasScores={!!hasScores} />
      </div>
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

/** §A5 outer column: `—` when nothing's in play, `N PTS` while unresolved, the
 *  stacked team result at Final (team-color dots — the existing result widget,
 *  not redesigned). Data-driven: Final → result; else points in play → `N PTS`;
 *  else `—`. */
function OuterColumn({
  game,
  teams,
  cells,
  isFinal,
  hasScores,
}: {
  game: LBGame;
  teams: LBTeam[];
  cells: Map<string, LBCell> | undefined;
  isFinal: boolean;
  hasScores: boolean;
}) {
  if (isFinal && hasScores) {
    return (
      <div className="flex flex-col items-end gap-0.5">
        {teams.map((team) => {
          const cell = cells?.get(team.id);
          return (
            <span key={team.id} className="flex items-center gap-1 text-[13px] font-semibold tabular-nums">
              <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: team.color }} />
              <span style={{ color: "var(--color-bt-text)" }}>{cell ? fmtPts(cell.points) : "–"}</span>
            </span>
          );
        })}
      </div>
    );
  }

  const pts = game.pointsTotal;
  if (pts != null && pts > 0) {
    return (
      <span className="text-[13px] font-semibold tabular-nums" style={{ color: "var(--color-bt-text)" }}>
        {fmtPts(pts)} <span className="text-[10px] font-medium" style={{ color: "var(--color-bt-text-dim)" }}>PTS</span>
      </span>
    );
  }
  return (
    <span className="text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
      —
    </span>
  );
}

/** §A2 — LIVE is the one surviving word-badge (the OPEN badge is removed; arming
 *  is carried by the format-icon color, §A4). */
export function LiveBadge() {
  return (
    <span
      className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold"
      style={{
        background: "var(--color-bt-accent-faint)",
        color: "var(--color-bt-accent)",
        border: "1px solid var(--color-bt-accent-border)",
      }}
    >
      <Radio size={9} />
      Live
    </span>
  );
}

/** "Yours"— marks a game the viewer is the delegate of (§10). Display-only;
 *  the controls live on the game page, not the board row (§5). Dropped at Final
 *  alongside the scorecard (round-3.1 §A2 — Final sheds operational chrome). */
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
