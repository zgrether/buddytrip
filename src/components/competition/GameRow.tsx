"use client";

import { createElement } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Radio, Flag, Swords, Layers, Gamepad2, ClipboardList } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { gameHref, isGolfFormat } from "@/lib/gameRoutes";
import type { ScoringModel } from "@/lib/gameTypes";
import type { LBGame, LBTeam, LBCell } from "./CompetitionLeaderboard";

export { gameHref, isGolfFormat } from "@/lib/gameRoutes";

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
  canEdit,
  viewerName,
  viewerAvatarIcon,
  viewerTeamColor,
  onPrefetch,
}: {
  game: LBGame;
  teams: LBTeam[];
  cells: Map<string, LBCell> | undefined;
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
  const router = useRouter();
  const setupMode = !(game.status === "complete" || game.status === "active" || game.scoringEnabled === true);
  const href = gameHref(tripId, game.gameTypeId, game.id, {
    settings: canEditThisGame && setupMode,
  });
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
  // (round-3.1 §A2). The scorecard column is golf-only and present everywhere
  // EXCEPT Final; a course set makes it a real button (opens the scorecard via
  // the row link), no course makes it a muted, inert status icon.
  const showScorecard = isGolfFormat(game.gameTypeId) && !isFinal;
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
      ? "Underway · scoring"
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
          {section === "on-tap" && <LiveBadge />}
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
              router.push(scorecardHref);
            }}
          >
            <ClipboardList size={15} />
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
            <ClipboardList size={15} />
          </span>
        ))}

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
              <span style={{ color: "var(--color-bt-text)" }}>{cell ? fmtPts(cell.points) : "–"}</span>
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

/**
 * CompletedRow (Task 5) — a finished game compressed to ONE line: format icon +
 * name (left), result (right). Recessed like the old Final tile but far shorter
 * (the old Final `GameRow` stacked the team results vertically in the outer
 * column). The result shape keys on scoring_model:
 *   match_play → each team's points, team-colored, in HERO left-right order
 *                (the `teams` array order the hero uses) so they scan against the
 *                hero. NO winner emphasis — both read at the same weight.
 *   points     → a horizontal placement podium (1st/2nd/3rd…) in the shared
 *                `--color-bt-place-*` tokens (R2 — a small inline podium, not the
 *                games-side FinalStandings screen, which doesn't fit a board row).
 */
export function CompletedRow({
  game,
  teams,
  cells,
  scoringModel,
  tripId,
  onPrefetch,
}: {
  game: LBGame;
  teams: LBTeam[];
  cells: Map<string, LBCell> | undefined;
  scoringModel: ScoringModel;
  tripId: string;
  onPrefetch: (gameId: string) => void;
}) {
  const href = gameHref(tripId, game.gameTypeId, game.id);
  const inner = (
    <div className="flex items-center gap-3 px-4 py-2.5" style={{ opacity: 0.75 }}>
      {createElement(formatIcon(game.gameTypeId), {
        size: 16,
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
        <CompletedScores teams={teams} cells={cells} />
      )}
    </div>
  );
  const panelStyle: React.CSSProperties = { border: "1px solid var(--color-bt-border)" };
  return href ? (
    <Link
      href={href}
      className="block rounded-xl overflow-hidden hover:opacity-80 transition-opacity"
      style={panelStyle}
      onPointerEnter={() => onPrefetch(game.id)}
      onPointerDown={() => onPrefetch(game.id)}
    >
      {inner}
    </Link>
  ) : (
    <div className="rounded-xl overflow-hidden" style={panelStyle}>
      {inner}
    </div>
  );
}

/** match_play completed result — each team's points as a team-color dot + the
 *  number in white, in the SAME left-right order as the hero (the `teams` array
 *  order). No winner emphasis. */
function CompletedScores({ teams, cells }: { teams: LBTeam[]; cells: Map<string, LBCell> | undefined }) {
  return (
    <div className="flex shrink-0 items-center gap-3 tabular-nums">
      {teams.map((t) => (
        <span key={t.id} className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: t.color }} />
          <span className="text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>
            {fmtPts(cells?.get(t.id)?.points ?? 0)}
          </span>
        </span>
      ))}
    </div>
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

