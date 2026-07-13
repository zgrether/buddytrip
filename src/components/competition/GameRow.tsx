"use client";

import { createElement } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Table2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { gameHref, isGolfFormat, opensAsPanel } from "@/lib/gameRoutes";
import { categoryIcon } from "@/lib/gameCategoryIcon";
import type { ScoringModel } from "@/lib/gameTypes";
import type { LBGame, LBTeam, LBCell } from "./CompetitionLeaderboard";

export { gameHref, isGolfFormat } from "@/lib/gameRoutes";

/**
 * Open a panel-capable game as a layered panel over the persistent board (Spec 2):
 * set `?game=<id>` on the CURRENT url via the History API — Next syncs it to
 * `useSearchParams` with NO server round-trip, so the board stays mounted + warm
 * and CompetitionFace's derived-open host renders the game's view. Shared by the
 * live GameRow and the compressed CompletedRow so both open the panel identically.
 */
function openGamePanel(pathname: string, gameId: string, settings: boolean) {
  const q = `?game=${gameId}${settings ? "&settings=1" : ""}`;
  window.history.pushState(null, "", `${pathname}${q}`);
}

/**
 * Open the scorecard as an OVERLAY over the board (not a route navigation): push
 * `?scorecard=<id>` onto the current url via the History API — Next syncs it to
 * `useSearchParams` with no round-trip, so the board stays warm underneath and
 * CompetitionFace renders the scorecard Sheet on top. Back pops this entry.
 * (Mirrors `openGamePanel`; the standalone `/games/scorecard` route stays as the
 * cold deep-link fallback.)
 */
function openScorecardOverlay(pathname: string, gameId: string) {
  window.history.pushState(null, "", `${pathname}?scorecard=${gameId}`);
}

// ── Row helpers (own the board-row primitives) ────────────────────────────────

/** "8.5" → "8½", "14" → "14", "0.5" → "½" */
export function fmtPts(n: number): string {
  const whole = Math.floor(n);
  const isHalf = Math.abs(n - whole - 0.5) < 0.001;
  if (!isHalf) return String(whole);
  return whole === 0 ? "½" : `${whole}½`;
}

/** §A1 format icon — the leading glyph that names the game's format, glanceable
 *  down the board. Its COLOR carries the arming tell (§A4, applied in Commit 3);
 *  the glyph itself identifies the game's CATEGORY (golf/card/yard/bar/other),
 *  not its scoring format — sourced from the same shared map the add-game
 *  picker uses (`gameCategoryIcon.ts`), so the two surfaces can't drift. All
 *  golf formats (stroke/singles/doubles/rack) share the flag; format-specific
 *  glyphs (swords/layers) read as "combat/stack" on a board that's half
 *  non-golf, which this fixes. Unknown types fall back to a generic game glyph
 *  rather than going blank. */
export function formatIcon(gameTypeId: string | null): LucideIcon {
  return categoryIcon(gameTypeId);
}

/**
 * The board SECTION a game belongs to — the SINGLE source of truth for both the
 * section grouping (CompetitionLeaderboard) and this row's presentation, so a row
 * can never render a treatment that disagrees with its section header.
 *
 * A2-core (#500) made enable ≡ active (`enableScoring` sets scoring_enabled AND
 * status='active' in one write), so `status` alone gives only four reachable
 * states; the fifth section (On Tap ↔ Ready for Play) splits `active` on
 * `started` (≥1 score entry, R1):
 *   complete              → completed   (done)
 *   active  &  started    → on-tap      (scores flowing — genuinely underway)
 *   active  & !started    → ready       (Ready for Play — enabled/pairings up, unscored)
 *   pending &  configured → preparing   (Preparing for Gameplay — roster set, not enabled)
 *   pending & !configured → skeleton    (barely configured)
 * Total + disjoint = a clean 5-way partition (every game in exactly one section).
 *
 * `configured` (roster earned, server-derived) gates preparing↔skeleton; it also
 * feeds the outer `N PTS`/`—` column so the two can't disagree. Course/handicaps
 * never gate this (locked, readiness model).
 */
export type GameSection = "completed" | "on-tap" | "ready" | "preparing" | "skeleton";
export function sectionOf(game: LBGame): GameSection {
  if (game.status === "complete") return "completed";
  if (game.status === "active") return game.started === true ? "on-tap" : "ready";
  return game.configured ? "preparing" : "skeleton";
}

/**
 * §A4 arm signal: the format-icon shows full color once scoring is ENABLED,
 * muted before. Phase 2B.1 wired this to the real `scoring_enabled` field, so the
 * two §A signals diverge on a real state: a Preparing game (configured, not
 * enabled) reads full name (structure done) + muted icon (not enabled) until the
 * owner enables. On Tap / Ready for Play (both `active`) read armed.
 */
export function iconArmed(game: LBGame): boolean {
  return game.scoringEnabled === true;
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
 *   crowded out (§A6). The §A3 layer table is outline / name strength / the one
 *   Live background — no per-row LIVE badge (the teal LIVE section header now
 *   carries that signal once, at the section level; leaderboard-grid pass).
 *
 * Subtitle and name+delegate stack vertically inside the name column (mobile —
 * keeps the name uncrowded); the delegate chip travels with the name (§A1) and
 * drops at Final alongside the scorecard (round-3.1 §A2).
 */
export function GameRow({
  game,
  teams,
  cells,
  scoringModel,
  projection,
  tripId,
  mine,
  canEdit,
  viewerName,
  viewerAvatarIcon,
  viewerTeamColor,
  onPrefetch,
}: {
  game: LBGame;
  teams: LBTeam[];
  cells: Map<string, LBCell> | undefined;
  /** The competition's scoring model — gates the LIVE projected-points pill grid
   *  to match_play boards (the same boards whose completed rows use the team-column
   *  grid). Points cups keep the plain outer column on live rows. */
  scoringModel: ScoringModel;
  /** teamId → projected points for THIS game (LIVE match/rack only). Present →
   *  the row renders the ▲ pill grid instead of the outer `N PTS` column. */
  projection?: Record<string, number>;
  tripId: string;
  mine: boolean;
  /** Trip-level edit access (Owner/Organizer). ORed with `mine` (this game's
   *  delegate) it IS useGameEditAccess/canEditGame — the gate for the deep link
   *  to a setup-mode game's settings page. */
  canEdit?: boolean;
  /** The viewer's display name + chosen avatar icon + competition-team color —
   *  rendered as the delegate marker when `mine` (the viewer's avatar in their
   *  team color, §10). Only needed when the viewer delegates this game. */
  viewerName?: string | null;
  viewerAvatarIcon?: string | null;
  viewerTeamColor?: string | null;
  onPrefetch: (gameId: string) => void;
}) {
  // Deep-link to SETTINGS when the viewer can edit this game (Owner/Organizer OR
  // its delegate — mirrors useGameEditAccess) AND it's still in SETUP (nothing on
  // the scoreboard yet). Otherwise the normal target (scoreboard / placeholder).
  // Once scoring is on (live/final), everyone gets the scoreboard. Members never
  // get the settings link — they hit the server-walled placeholder.
  const canEditThisGame = !!canEdit || mine;
  const pathname = usePathname();
  const setupMode = !(game.status === "complete" || game.status === "active" || game.scoringEnabled === true);
  const href = gameHref(tripId, game.gameTypeId, game.id, {
    settings: canEditThisGame && setupMode,
  });
  // Spec 2: panel-capable games (match play + rack + non-golf — Phase 1 & 2) open
  // as a PANEL over the persistent board (no route teardown), driven by `?game=`
  // on the CURRENT url via the History API — which Next syncs to `useSearchParams`
  // with no server round-trip, so the board stays mounted + warm underneath. The
  // same `settings=1` marker the route href carries rides along, so an owner
  // opening a setup-mode game still lands in its settings (CompetitionFace hosts
  // the panel; back pops this entry). STROKE still navigates via `href` below (its
  // full-screen-overlay re-host is a separate phase).
  const panelFormat = opensAsPanel(game.gameTypeId);
  const openPanel = () => openGamePanel(pathname, game.id, canEditThisGame && setupMode);
  // The scorecard icon opens the EMPTY scorecard PREVIEW (Spec 5a) — its own
  // destination, distinct from the row's game link. Golf-with-course only (null
  // for non-golf, which never shows the icon anyway).
  const scorecardHref = gameHref(tripId, game.gameTypeId, game.id, { scorecard: true });
  const hasScores = cells && cells.size > 0;
  // The row's single source of truth — the game's board SECTION (shared with the
  // section grouping so row + header always agree). Layout + every §A3 layer key
  // off this one value.
  const section = sectionOf(game);
  const isFinal = section === "completed";

  // Final sheds the operational layer (scorecard + delegate), keeps the result
  // (round-3.1 §A2). The scorecard column is golf-only, present in the SETUP /
  // upcoming states (skeleton/preparing/ready). It's ALSO suppressed once the
  // game is LIVE (on-tap) — the icon is a course PREVIEW, which is noise next to
  // live scoring context (W3-LB6) — and at Final. A course set makes it a real
  // button (opens the scorecard via the row link); no course = a muted status icon.
  const showScorecard = isGolfFormat(game.gameTypeId) && !isFinal && section !== "on-tap";
  const scorecardOpens = showScorecard && game.hasCourse === true && !!href;
  const showDelegate = mine && !isFinal;
  // A row is tappable when it has a route (golf OR the non-golf manual page) —
  // gates the setting-up CTA subtitle (an inert, routeless row gets no "tap to…").
  const tappable = !!href;

  // §A3 arm tell: the format icon goes full-color once scoring is enabled
  // (armed). The same signal splits the Ready subtitle (see below); Final quiets
  // it back down (sheds the arm tell).
  const armed = iconArmed(game);
  const armedIcon = armed && !isFinal;

  // LIVE projected-points pill grid (leaderboard grid Phase 2). A live (on-tap)
  // match/rack game in a match_play cup carries a per-team projection → the row
  // trades its outer `N PTS` column for a ▲ pill in each team column (aligned to
  // the completed grid's short-name header). No projection (stroke, not-yet-
  // started, a points cup) → the plain outer column stays. Gated on match_play so
  // the pills line up with the completed team-column grid (points cups use a
  // podium there, not team columns).
  const showProjectionPills = section === "on-tap" && scoringModel === "match_play" && projection != null;

  // Subtitle / running state (§A3), all keyed off the one derived section:
  //  - on-tap    → running state (the real "Blue 2 up · thru 13" is deferred).
  //  - ready     → Ready for Play: enabled + pairings up, waiting on the first score.
  //  - preparing → the one remaining step is ENABLING scoring (the roster IS
  //                assigned — that's what `configured` means — handicaps never gate,
  //                readiness rework P1a). (The old `ready && armed → "Ready to play"`
  //                branch was dead under A2-core — a pending game can't be armed —
  //                and is gone; "Ready to play" now lives on the `ready` section.)
  //  - skeleton  → a tap-to-continue CTA, but only when the row is tappable; an
  //                inert crew row leans on the dashed outline alone (§A3).
  //  - completed → none; the compressed row + outer result speak for it.
  const subtitle =
    section === "on-tap"
      ? showProjectionPills
        ? "Projected results" // the cells now carry projections → the subtitle says so
        : "Underway · scoring"
      : section === "ready"
      ? "Ready to play"
      : section === "preparing"
      ? "Ready — enable scoring"
      : section === "skeleton"
      ? tappable
        ? "Tap to keep setting up"
        : null
      : null;

  // Panel surface — each game is its own standalone card (not a row inside a
  // shared panel). On Tap carries the one reserved accent-faint "act now" fill
  // (§A2); Ready for Play + Preparing are solid cards ("built + waiting");
  // Skeleton and Completed get NO fill — skeleton is an outline-only dashed shell
  // ("not built yet"), completed a recessed, dimmed record. The border lives on
  // the panel so the inner content never shifts.
  const panelStyle: React.CSSProperties = {
    background:
      section === "ready" || section === "preparing"
        ? "var(--color-bt-card)"
        : section === "on-tap"
        ? "var(--color-bt-accent-faint)"
        : undefined, // skeleton + completed: no fill
    border:
      section === "skeleton"
        ? "1.5px dashed var(--color-bt-border)"
        : "1px solid var(--color-bt-border)",
  };
  const rowStyle: React.CSSProperties = {
    // Completed is a quiet record — recess the whole tile (§A3 "recessed").
    opacity: isFinal ? 0.72 : 1,
  };
  // Name-text strength = "is the structure done?" — dim only while Skeleton, full
  // the moment it's built (§A3). Completed keeps the name full but the tile recedes.
  const nameColor =
    section === "skeleton" ? "var(--color-bt-text-dim)" : "var(--color-bt-text)";

  const inner = (
    <div className="flex items-center gap-3 px-4 py-3" style={rowStyle}>
      {/* Format icon — color carries the arming tell (§A4). Rendered via
          createElement so the icon component isn't re-created during render. */}
      {createElement(formatIcon(game.gameTypeId), {
        size: 18,
        className: "shrink-0",
        style: {
          color: armedIcon ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)",
        },
      })}

      {/* Name + delegate, subtitle stacked beneath */}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="truncate text-sm font-semibold"
            style={{ color: nameColor }}
          >
            {game.name}
          </span>
          {showDelegate && (
            // The delegate marker IS the viewer's avatar in their COMPETITION-TEAM
            // color (§10) — competition identity, not a separate "Yours" word-chip.
            // Reuses the one Avatar primitive (R3). teamColor null (viewer not on a
            // team) → Avatar's accent ("you") fallback.
            <Avatar
              name={viewerName || "You"}
              avatarIcon={viewerAvatarIcon ?? null}
              teamColor={viewerTeamColor ?? null}
              accent
              sizePx={20}
              className="shrink-0"
            />
          )}
        </div>
        {subtitle && (
          <span className="text-[12px]" style={{ color: "var(--color-bt-text-dim)" }}>
            {subtitle}
          </span>
        )}
      </div>

      {/* Scorecard column (golf-only, dropped at Final) — inboard of the outer
          column so the right edge holds when it vanishes. Course set → a real
          button that opens the EMPTY SCORECARD PREVIEW (Spec 5a — its own route,
          NOT the game): the span intercepts the tap (preventDefault +
          stopPropagation so the row's game link doesn't also fire) and navigates
          to the scorecard. No course → a muted, inert status icon. */}
      {showScorecard &&
        (scorecardOpens && scorecardHref ? (
          <span
            role="button"
            tabIndex={0}
            aria-label="View scorecard"
            title="View scorecard"
            className="flex shrink-0 cursor-pointer items-center justify-center rounded-lg"
            style={{
              width: 30,
              height: 30,
              background: "var(--color-bt-card-raised)",
              border: "1px solid var(--color-bt-border)",
              color: "var(--color-bt-text)",
            }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              openScorecardOverlay(pathname, game.id);
            }}
          >
            <Table2 size={15} />
          </span>
        ) : (
          <span
            className="flex shrink-0 items-center justify-center"
            style={{ width: 30, height: 30, color: "var(--color-bt-text-dim)", opacity: 0.5 }}
            // No course yet — status only, never a tap target (the row stays
            // navigable around it for games that are otherwise reachable).
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            title="No course set"
          >
            <Table2 size={15} />
          </span>
        ))}

      {/* LIVE → the ▲ projected-points pill in each team column (aligned to the
          completed grid's GRID_COLW columns via the shared width). Else the outer
          pts-or-result column, pinned right (§A5). */}
      {showProjectionPills ? (
        teams.map((t) => (
          <span
            key={t.id}
            className="flex shrink-0 items-center justify-center"
            style={{ width: GRID_COLW }}
          >
            <ProjectionPill color={t.color} value={projection![t.id] ?? 0} alwaysTriangle />
          </span>
        ))
      ) : (
        <div className="flex shrink-0 flex-col items-end" style={{ minWidth: 44 }}>
          <OuterColumn game={game} teams={teams} cells={cells} isFinal={isFinal} hasScores={!!hasScores} />
        </div>
      )}
    </div>
  );

  // Panel-capable (match play + rack + non-golf) → open the layered panel over the
  // board (Spec 2); the pointer-intent prefetch still warms the game's cold data so
  // the panel paints instantly. Stroke keeps the route <Link> below.
  if (panelFormat) {
    return (
      <button
        type="button"
        onClick={openPanel}
        onPointerEnter={() => onPrefetch(game.id)}
        onPointerDown={() => onPrefetch(game.id)}
        className="block w-full rounded-xl overflow-hidden text-left hover:opacity-80 transition-opacity"
        style={panelStyle}
        data-testid="open-game-panel"
      >
        {inner}
      </button>
    );
  }

  if (href) {
    return (
      <Link
        href={href}
        className="block rounded-xl overflow-hidden hover:opacity-80 transition-opacity"
        style={panelStyle}
        onPointerEnter={() => onPrefetch(game.id)}
        onPointerDown={() => onPrefetch(game.id)}
      >
        {inner}
      </Link>
    );
  }
  // No route → an inert tile. (Non-golf games now HAVE a route — the manual
  // scoreboard page — so they take the <Link> branch above like golf; the old
  // tap-to-open-modal-in-place path was retired with the post-results modal.)
  return <div className="rounded-xl overflow-hidden" style={panelStyle}>{inner}</div>;
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
              {/* Completed game: a team with no cell scored a real zero, not
                  "not-applicable" — show 0, reserve the dash for unplayed (W3-LB5). */}
              <span style={{ color: "var(--color-bt-text)" }}>{cell ? fmtPts(cell.points) : "0"}</span>
            </span>
          );
        })}
      </div>
    );
  }

  // `N PTS` only once the game is configured (the SAME gate as Ready) — a
  // setting-up game reads `—` even if it carries a stray points value, so the
  // column and the state always agree.
  const pts = game.pointsTotal;
  if (game.configured && pts != null && pts > 0) {
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

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

/** Fixed column width shared between `GridColumnHeader` and each completed
 *  row's grid cells (match_play only) — the two can never misalign since both
 *  read the same constant. Sized for a short-name (≤5 char) column. */
const GRID_COLW = 56;

/**
 * ProjectionPill — the ▲ projected-points pill (leaderboard grid Phase 2). A
 * team-tinted pill: team color on a 16%-alpha team fill, the value in team color.
 * The SAME visual grammar as the game-page projection strip (this is the extracted
 * home of `CompetitionHero`'s old `DeltaChip`, which now delegates here so the two
 * surfaces share one pill).
 *
 * `alwaysTriangle`: the board's live cell shows ▲ even at 0 (unambiguously a
 * PROJECTION, distinct from a completed score of 0). The hero's contribution chip
 * omits it (shows the ▲ only for a positive delta, a plain 0 otherwise).
 */
export function ProjectionPill({
  color,
  value,
  alwaysTriangle = false,
}: {
  color: string;
  value: number;
  alwaysTriangle?: boolean;
}) {
  const triangle = alwaysTriangle || value > 0;
  return (
    <span
      className="inline-flex items-center tabular-nums"
      style={{
        gap: 2,
        padding: "2px 8px",
        borderRadius: 9999,
        fontSize: 11.5,
        fontWeight: 700,
        lineHeight: 1,
        background: `color-mix(in srgb, ${color} 16%, transparent)`,
        color,
      }}
    >
      {triangle && <span style={{ fontSize: 8 }}>&#9650;</span>}
      {fmtPts(value)}
    </span>
  );
}

/**
 * GridColumnHeader — team short-name column labels (team-colored, small caps,
 * an underline tab), sitting directly above the COMPLETED block ONLY. Not
 * top-pinned across sections: the sections below (Live/Ready/Configuring/New)
 * either don't award team points yet or are still being set up, so there's no
 * team-column meaning to label there — header lives where team-vs-team scoring
 * lives. match_play only (points cups get their own team-column header inside
 * `PointsMatrix`'s game-by-game table — no duplicate header here).
 */
export function GridColumnHeader({ teams }: { teams: LBTeam[] }) {
  return (
    <div
      className="flex items-center gap-3 px-4 pb-2"
      style={{ borderBottom: "1px solid var(--color-bt-border)" }}
    >
      <span
        className="min-w-0 flex-1 text-[10px] font-semibold uppercase tracking-wider"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        Game
      </span>
      {teams.map((t) => (
        <span
          key={t.id}
          className="relative shrink-0 pb-1 text-center text-[11px] font-extrabold uppercase tracking-wide"
          style={{ width: GRID_COLW, color: t.color }}
        >
          {t.short_name}
          <span
            className="absolute bottom-0 left-1/2 h-[2px] w-5 -translate-x-1/2 rounded-full"
            style={{ background: "currentColor", opacity: 0.9 }}
          />
        </span>
      ))}
    </div>
  );
}

/**
 * CompletedRow — a finished game compressed to ONE flat, single-line row: no
 * card background, no border box, no icon tile, no status subtitle (leaderboard-
 * grid pass §1.1). A faint hairline sits BETWEEN completed rows (suppressed on
 * the last) so the flat list stays scannable. The result shape keys on
 * scoring_model:
 *   match_play → CompletedGridCells — each team's points as a bare, bold,
 *                team-colored number in a column that aligns to
 *                `GridColumnHeader` above. Winner gets a faint team-tinted
 *                chip; loser is dimmed; a tie gives both equal weight (no chip).
 *   points     → the existing horizontal placement podium (1st/2nd/3rd…) — left
 *                as-is; `PointsMatrix` (the collapsible games×teams audit table)
 *                already gives points cups the full per-game team-column grid,
 *                so this compact row isn't duplicating that.
 */
export function CompletedRow({
  game,
  teams,
  cells,
  scoringModel,
  tripId,
  isLast,
  onPrefetch,
}: {
  game: LBGame;
  teams: LBTeam[];
  cells: Map<string, LBCell> | undefined;
  scoringModel: ScoringModel;
  tripId: string;
  /** Suppresses the between-rows hairline on the last completed row. */
  isLast?: boolean;
  onPrefetch: (gameId: string) => void;
}) {
  const pathname = usePathname();
  const href = gameHref(tripId, game.gameTypeId, game.id);
  // A completed panel-capable game (match/rack/non-golf) opens its final scoreboard
  // as the SAME panel a live game does (Spec 2) — no full-page nav to view results.
  // Complete → never setup, so no `?settings=1`. Stroke keeps the route <Link>.
  const panelFormat = opensAsPanel(game.gameTypeId);
  const inner = (
    <div
      className="flex items-center gap-3 px-4 py-2"
      style={{ borderBottom: isLast ? undefined : "1px solid var(--color-bt-border)" }}
    >
      {createElement(formatIcon(game.gameTypeId), {
        size: 15,
        className: "shrink-0",
        style: { color: "var(--color-bt-text-dim)" },
      })}
      <span
        className="min-w-0 flex-1 truncate text-[13px] font-medium"
        style={{ color: "var(--color-bt-text)" }}
      >
        {game.name}
      </span>
      {scoringModel === "points" ? (
        <CompletedPodium teams={teams} cells={cells} />
      ) : (
        <CompletedGridCells teams={teams} cells={cells} />
      )}
    </div>
  );
  if (panelFormat) {
    return (
      <button
        type="button"
        onClick={() => openGamePanel(pathname, game.id, false)}
        onPointerEnter={() => onPrefetch(game.id)}
        onPointerDown={() => onPrefetch(game.id)}
        className="block w-full text-left hover:opacity-80 transition-opacity"
        data-testid="open-game-panel"
      >
        {inner}
      </button>
    );
  }
  return href ? (
    <Link
      href={href}
      className="block hover:opacity-80 transition-opacity"
      onPointerEnter={() => onPrefetch(game.id)}
      onPointerDown={() => onPrefetch(game.id)}
    >
      {inner}
    </Link>
  ) : (
    <div>{inner}</div>
  );
}

/** match_play completed grid cells — each team's points as a bare, bold,
 *  team-colored number in a fixed-width column aligned to `GridColumnHeader`.
 *  The winner's cell carries a faint team-tinted chip (fill + 1px team
 *  border); the loser's number is team-colored at reduced opacity; a tie gives
 *  both equal weight (no chip) — the colorblind-safe distinction is the chip's
 *  FILL, not a hue. */
function CompletedGridCells({ teams, cells }: { teams: LBTeam[]; cells: Map<string, LBCell> | undefined }) {
  const values = teams.map((t) => cells?.get(t.id)?.points ?? null);
  const numeric = values.filter((v): v is number => v != null);
  const max = numeric.length ? Math.max(...numeric) : null;
  const isTie = max != null && numeric.filter((v) => v === max).length > 1;
  return (
    <>
      {teams.map((t, i) => {
        const v = values[i];
        const isWinner = !isTie && v != null && max != null && v === max;
        const isLoser = v != null && max != null && v !== max;
        return (
          <span
            key={t.id}
            className="shrink-0 rounded-lg text-center text-[15px] font-extrabold tabular-nums"
            style={{
              width: GRID_COLW,
              padding: "3px 0",
              color: t.color,
              opacity: isLoser ? 0.62 : 1,
              background: isWinner
                ? `color-mix(in srgb, ${t.color} 14%, transparent)`
                : undefined,
              boxShadow: isWinner
                ? `inset 0 0 0 1px color-mix(in srgb, ${t.color} 45%, transparent)`
                : undefined,
            }}
          >
            {/* completed → a no-score team is a real 0, not unplayed (W3-LB5). */}
            {v != null ? fmtPts(v) : "0"}
          </span>
        );
      })}
    </>
  );
}

/** points completed result — a horizontal placement podium (1st/2nd/3rd…) in the
 *  shared place tokens; each pill = place chip (gold/silver/bronze bg) + team
 *  color dot + short name. Only teams with a resolved place are shown. */
function CompletedPodium({ teams, cells }: { teams: LBTeam[]; cells: Map<string, LBCell> | undefined }) {
  const ranked = teams
    .map((t) => ({ team: t, place: cells?.get(t.id)?.place }))
    .filter((x): x is { team: LBTeam; place: number } => x.place != null)
    .sort((a, b) => a.place - b.place);
  if (ranked.length === 0) return null;
  return (
    <div className="flex shrink-0 items-center gap-1">
      {ranked.map(({ team, place }) => {
        const p = Math.min(Math.max(place, 1), 4);
        return (
          <span
            key={team.id}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold"
            style={{
              background: `var(--color-bt-place-${p}-bg)`,
              color: `var(--color-bt-place-${p}-text)`,
            }}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: team.color }} />
            {ordinal(place)} {team.short_name}
          </span>
        );
      })}
    </div>
  );
}

