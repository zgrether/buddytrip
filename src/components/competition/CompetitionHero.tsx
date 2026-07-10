"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Settings, Users } from "lucide-react";
import { fmtPts } from "./GameRow";
import type { LBTeam } from "./CompetitionLeaderboard";
import type { ScoringModel } from "@/lib/gameTypes";

// Measure before paint on the client; a plain effect on the server (useLayoutEffect
// warns during SSR). Standard SSR-safe isomorphic layout effect.
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

// The neutral fallback card (no two teams to tint from — a points cup's identity
// hero, or a half-built 2-team cup).
const NEUTRAL_CARD = "linear-gradient(158deg,#222e44 0%,#1a2231 100%)";

/**
 * teamGlow — the hero background: a faint two-color TEAM glow (team A from
 * the top-left, team B from the bottom-right, low alpha) over the card. The one
 * intentional hero gradient (STYLE_GUIDE hero carve-out). `color-mix` derives the
 * low-alpha tint from each team's assigned color, so it's extensible to ANY team
 * colors (not the prototype's hardcoded green/orange) — e.g. green + orange render
 * `rgba(34,197,94,0.13)` / `rgba(249,115,22,0.11)` over `--color-bt-card`.
 */
function teamGlow(a: LBTeam, b: LBTeam): string {
  return [
    `radial-gradient(135% 135% at 0% 0%, color-mix(in srgb, ${a.color} 13%, transparent), transparent 56%)`,
    `radial-gradient(135% 135% at 100% 100%, color-mix(in srgb, ${b.color} 11%, transparent), transparent 56%)`,
    "var(--color-bt-card)",
  ].join(", ");
}

/**
 * teamGlowCollapsed — the mini-bar background: a faint two-color TEAM glow (team A from
 * the top-left, team B from the bottom-right, low alpha) over the card. The one
 * intentional hero gradient (STYLE_GUIDE hero carve-out). `color-mix` derives the
 * low-alpha tint from each team's assigned color, so it's extensible to ANY team
 * colors (not the prototype's hardcoded green/orange) — e.g. green + orange render
 * `rgba(34,197,94,0.13)` / `rgba(249,115,22,0.11)` over `--color-bt-card`.
 */
function teamGlowCollapsed(a: LBTeam, b: LBTeam): string {
  return [
    `radial-gradient(90% 150% at 0% 0%, color-mix(in srgb, ${a.color} 13%, transparent), transparent 60%)`,
    `radial-gradient(85% 150% at 100% 100%, color-mix(in srgb, ${b.color} 11%, transparent), transparent 62%)`,
    "var(--color-bt-card)",
  ].join(", ");
}

/**
 * CompetitionHero — the merged competition header (Task 1). ONE elevated gradient
 * card replaces the old two surfaces (the CompetitionHeader identity/gear strip +
 * the TwoTeamHero scores/bar). "Hero gradient art" per STYLE_GUIDE's carve-out:
 * the CARD gradient, the warm glow, and the dimensional gold trophy are raw-hex
 * ART (the geometry is the approved `hero_trophy_reference.html`, verbatim); every
 * STRUCTURAL element around them uses --color-bt-* tokens, and the team scores/
 * names use the team colors (data). Dark-mode only (the app forces dark).
 *
 * Typography INHERITS --font-sans (no font is declared here) so the hero matches
 * the trip-home header by construction on every device.
 *
 * Layout (match_play): identity + gear on top; full team names (own line,
 * team-colored); the two big team-colored scores flanking the trophy (which is
 * centered behind them, cropped by overflow:hidden so it bleeds); the clinch bar;
 * and BELOW the bar ONLY the win target — the per-side "X to clinch" and "pts in
 * play" text are stripped (Task 2: the bar carries proximity).
 *
 * For POINTS comps the trophy/two-score treatment doesn't apply (N teams don't
 * flank a trophy), so the hero is the identity + gear card only; the points
 * standings body (NTeamRankedList) stays untouched below it (board-body branching
 * is separate work).
 */
export function CompetitionHero({
  cupName,
  tagline,
  teams,
  teamTotals,
  pointsAvailable,
  winNumber,
  clincher,
  scoringModel,
  canEdit,
  onSettings,
  onEditTeam,
  variant = "expanded",
}: {
  cupName: string;
  tagline: string | null;
  teams: LBTeam[];
  teamTotals: Record<string, number>;
  pointsAvailable: number;
  winNumber: number;
  clincher: LBTeam | null;
  scoringModel: ScoringModel;
  /** Editors get the gear (opens competition settings via the #522 history-back
   *  overlay — same handler, so back-nav is unchanged). */
  canEdit: boolean;
  onSettings?: () => void;
  /** Tap a team name → that team's identity editor (owner / its captain). */
  onEditTeam?: (teamId: string) => void;
  /** `collapsed` (Spec: standard game header) — a compact score bar: team
   *  name OVER score + "first to X" centered, NEUTRAL chrome, NO trophy / tagline
   *  / gear / roster. Same DATA as expanded (a restyle, not new data). Used as the
   *  leaderboard's sticky bar and row 1 of the game-page header. */
  variant?: "expanded" | "collapsed";
}) {
  // The two-score + trophy treatment is the match_play hero; points keeps its own
  // standings body below (untouched), so the hero there is identity + gear only.
  const showScores = scoringModel === "match_play" && teams.length >= 2;
  const [a, b] = teams;

  if (variant === "collapsed") {
    return (
      <CollapsedHero
        teams={teams}
        teamTotals={teamTotals}
        winNumber={winNumber}
        pointsAvailable={pointsAvailable}
        clincher={clincher}
        onEditTeam={onEditTeam}
      />
    );
  }

  const aTotal = a ? teamTotals[a.id] ?? 0 : 0;
  const bTotal = b ? teamTotals[b.id] ?? 0 : 0;
  // Each team's share of the points in play → the two end-fills. A marker sits at
  // the relative-lead point so the bar reads as a live race (tied → centered).
  const aWidth = pointsAvailable > 0 ? Math.min(100, (aTotal / pointsAvailable) * 100) : 0;
  const bWidth = pointsAvailable > 0 ? Math.min(100, (bTotal / pointsAvailable) * 100) : 0;

  return (
    <div
      style={{
        // ART: the two-color TEAM glow (team A top-left, team B bottom-right) over
        // the card + a soft float shadow. Falls back to the neutral card for a
        // points cup / half-built cup (no two teams to tint from).
        position: "relative",
        overflow: "hidden", // clip the gradient to the card radius
        borderRadius: 16,
        border: "1px solid var(--color-bt-border)",
        background: showScores && a && b ? teamGlow(a, b) : NEUTRAL_CARD,
        boxShadow: "0 10px 28px rgba(0,0,0,0.40)",
      }}
      data-testid="competition-hero"
    >
      {/* Warm gold glow behind the trophy — ties it into the surface (ART). */}
      {showScores && (
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(ellipse 52% 82% at 50% 50%, rgba(216,180,82,0.14), transparent 64%)",
            pointerEvents: "none",
          }}
        />
      )}

      {/* Dimensional gold trophy — authoritative geometry from
          hero_trophy_reference.html, group opacity 0.17, centered + cropped. */}
      {showScores && <HeroTrophy />}

      {/* CONTENT — sharp, in front of the art. Horizontal padding matches the
          trip-header card (16px) rather than the mockup's standalone 24px, since
          the Live-face main already insets the card — keeps content off the edges
          without the doubled gap. */}
      <div style={{ position: "relative", padding: "18px 16px 20px" }}>
        {/* Top row: identity (left) + gear (right). The inline trophy TILE next to
            the cup name is dropped (the hero already carries the big trophy). */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p style={{ fontSize: 22, fontWeight: 600, lineHeight: 1.1, color: "var(--color-bt-text)" }}>
              {cupName}
            </p>
            {tagline && tagline.trim() && (
              <p className="mt-0.5" style={{ fontSize: 13, color: "var(--color-bt-text-dim)" }}>
                {tagline}
              </p>
            )}
          </div>
          {onSettings && canEdit && (
            <button
              type="button"
              onClick={onSettings}
              aria-label="Competition settings"
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg transition-colors"
              // Semi-transparent white pill, matching the trip header's gear on its
              // gradient (rgba over the hero art — same treatment, same values).
              style={{ background: "rgba(255,255,255,0.08)", color: "rgba(241,245,249,0.6)" }}
              data-testid="competition-settings-btn"
            >
              <Settings size={16} />
            </button>
          )}
        </div>

        {showScores && (
          <>
            {/* Team names row — FULL names (dedicated-row → full-name rule),
                team-colored, each on its side, tappable → that team's editor. */}
            <div className="mt-4 flex items-center justify-between gap-3">
              <TeamName team={a} onEditTeam={onEditTeam} align="left" />
              <TeamName team={b} onEditTeam={onEditTeam} align="right" />
            </div>

            {/* Scores — the two big team-colored numbers flanking the trophy. */}
            <div className="mt-1 flex items-baseline justify-between gap-4">
              <span style={{ fontSize: 74, fontWeight: 700, lineHeight: 1, color: a.color }} className="tabular-nums">
                {fmtPts(aTotal)}
              </span>
              <span style={{ fontSize: 74, fontWeight: 700, lineHeight: 1, color: b.color }} className="tabular-nums">
                {fmtPts(bTotal)}
              </span>
            </div>

            {/* Clinch bar — track + each team's end-fill + a lead marker. */}
            <div
              className="relative mt-4 flex h-2 w-full overflow-hidden rounded-full"
              style={{ background: "var(--color-bt-card-raised)" }}
            >
              <div
                className="h-full rounded-l-full transition-all duration-500"
                style={{ width: `${aWidth}%`, background: a.color }}
              />
              <div
                className="ml-auto h-full rounded-r-full transition-all duration-500"
                style={{ width: `${bWidth}%`, background: b.color }}
              />
              {/* Center divider — a FIXED halfway reference. Each team's fill
                  grows from its own end toward it, so a fill crossing the center
                  is what shows the lead (the marker itself never moves). */}
              <div
                className="absolute left-1/2 top-1/2 h-full w-0.5 -translate-x-1/2 -translate-y-1/2"
                style={{ background: "var(--color-bt-text)" }}
              />
            </div>

            {/* Below the bar: ONLY the win target. Sized as a peer of the
                mini-bar's labels (13/600), not a tiny afterthought. */}
            <p className="mt-2 text-center" style={{ fontSize: 13, fontWeight: 600, color: "var(--color-bt-text-dim)" }}>
              {clincher
                ? `Final · ${clincher.name} wins`
                : pointsAvailable > 0
                ? `First to ${fmtPts(winNumber)} wins`
                : "No points in play yet"}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * StickyCollapseHero — the leaderboard's expanded→collapsed swap (Spec Piece 1),
 * PURE `position: sticky` (no scroll-listener, no size-interpolation): the collapsed
 * bar is pinned (`sticky; top`) BEHIND the expanded hero, which sits OVER it (a
 * negative margin equal to the collapsed bar's measured height) with its opaque
 * gradient. Scrolling the expanded hero away REVEALS the pinned collapsed bar; no
 * layout shift (the negative margin absorbs the collapsed bar's height). The height
 * is measured (ResizeObserver) so it works for the 2-team bar AND the taller N-team
 * (points-cup) bar without a magic number.
 *
 * ⚠ Renders as a FRAGMENT, NOT a wrapping element — deliberately. A `position:
 * sticky` element can only pin WITHIN its containing block (its parent's box); it
 * can't outlive it. An earlier wrapping `<div>` was only as tall as the expanded
 * hero (the negative margin collapsed the wrapper's height to the hero's), so the
 * whole wrapper scrolled off the top and took the sticky child with it — the bar
 * never pinned (the shipped bug). By spreading these two nodes straight into the
 * leaderboard's LONG scrolling column (which also holds the games list), the sticky
 * bar's containing block is that tall column, so it pins at `top` and stays while
 * the games scroll under it. Keep this a fragment; do not re-wrap it.
 *
 * `stickyTop` offsets the pin below any fixed nav (the leaderboard's TopNav is 56px).
 */
export function StickyCollapseHero({
  stickyTop = 0,
  ...hero
}: React.ComponentProps<typeof CompetitionHero> & { stickyTop?: number }) {
  const collapsedRef = useRef<HTMLDivElement>(null);
  const expandedRef = useRef<HTMLDivElement>(null);
  const [pull, setPull] = useState(64); // sensible seed → no first-paint jump
  // Pull the expanded hero UP over the pinned collapsed bar. The earlier version
  // pulled by exactly the collapsed bar's own height (`-(collapsedH + 1)`) on the
  // assumption the two fragment nodes are flush — but they render into the
  // leaderboard's spacing column, which inserts ~12px of vertical rhythm between
  // them, so the pull fell short and the collapsed bar PEEKED ~11px above the hero
  // at rest. Instead of guessing that offset, MEASURE the rendered gap between the
  // hero's top and the collapsed bar's top and close it — robust to whatever
  // ambient spacing sits between them, and to the taller N-team bar. Converges in
  // one step (moving the margin by X moves the hero's top by X) to a 1px
  // over-cover (no peek), and re-corrects if the collapsed bar's height changes
  // (ResizeObserver). Layout effect on the client so the correction lands before
  // paint; SSR-safe (useEffect fallback).
  //
  // ⚠ Measure with `offsetTop` (layout position vs the shared offsetParent), NOT
  // `getBoundingClientRect().top` (viewport-relative). The two nodes are adjacent
  // siblings in the same column → same offsetParent → their offsetTop difference is
  // the pure layout gap, INVARIANT under scroll and under the collapsed bar's
  // sticky pinning. `rect.top` is not: once the bar is pinned and the hero has
  // scrolled (or on a soft-nav that restores a scrolled position), rect.top reads a
  // huge bogus gap, and any re-measure that fires there (a ResizeObserver tick)
  // corrupts `pull` into a large value that shoves the hero — and all content below
  // it — way down the page (only a hard refresh, which resets scroll to 0, healed
  // it). offsetTop can't drift that way.
  useIsoLayoutEffect(() => {
    const c = collapsedRef.current;
    const e = expandedRef.current;
    if (!c || !e) return;
    const measure = () => {
      // gap > 0 → the collapsed bar's top peeks above the hero; target a 1px
      // over-cover (gap = -1) so sub-pixel rounding never leaves a sliver.
      const gap = e.offsetTop - c.offsetTop;
      if (Math.abs(gap + 1) > 1) setPull((p) => p + gap + 1);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(c);
    ro.observe(e);
    return () => ro.disconnect();
  }, []);
  return (
    <>
      <div ref={collapsedRef} style={{ position: "sticky", top: stickyTop, zIndex: 10 }}>
        <CompetitionHero {...hero} variant="collapsed" />
      </div>
      <div ref={expandedRef} style={{ position: "relative", zIndex: 20, marginTop: -pull }}>
        <CompetitionHero {...hero} variant="expanded" />
      </div>
    </>
  );
}

/**
 * CollapsedHero — the compact score bar (Spec: standard game header, mock state
 * B/C). Team name OVER score, "first to X" centered, NEUTRAL chrome (the same hero
 * gradient art, no team wash), NO trophy / tagline / gear / roster. Same data as
 * the expanded hero — a restyle. Used as the leaderboard's sticky bar and row 1 of
 * the game-page header (ONE component, one home).
 *
 * N-team-aware: exactly-two → the mock's name/score flanking a centered target;
 * N>2 (points cups) → an evenly-spaced row of N name/score blocks with the target
 * on its own line below (short names there to fit). Never 2-team-hardcoded.
 */
export function CollapsedHero({
  teams,
  teamTotals,
  winNumber,
  pointsAvailable,
  clincher,
  footer,
  onEditTeam,
}: {
  teams: LBTeam[];
  teamTotals: Record<string, number>;
  winNumber: number;
  pointsAvailable: number;
  clincher: LBTeam | null;
  /** Optional projected tier INSIDE the same card, as a flush card-raised row —
   *  the game-page header's projection (#533). Omitted on the leaderboard's sticky
   *  bar. */
  footer?: React.ReactNode;
  /** Tap a team name → that team's identity editor (owner / its captain), same as
   *  the expanded hero. Omitted where team editing isn't wired (the game page) →
   *  the names render non-interactive. */
  onEditTeam?: (teamId: string) => void;
}) {
  const targetLabel = clincher
    ? `${clincher.short_name ?? clincher.name} wins`
    : pointsAvailable > 0
      ? `First to ${fmtPts(winNumber)} wins`
      : "No points yet";
  const card: React.CSSProperties = {
    borderRadius: 12,
    // Same two-color TEAM glow as the expanded hero (2-team cup) so the two
    // surfaces read as one system; neutral fallback for a points cup.
    border: "1px solid var(--color-bt-border)",
    background: teams.length <= 2 && teams[0] && teams[1] ? teamGlowCollapsed(teams[0], teams[1]) : NEUTRAL_CARD,
    boxShadow: "0 4px 14px rgba(0,0,0,0.35)",
    overflow: "hidden", // clip the flush projected-tier row to the card radius
  };
  // The projected tier is its OWN flush row (card-raised fill + top hairline), not
  // a plain divider — so it reads as a distinct tier of the same card.
  const footerBlock = footer ? (
    <div
      style={{
        background: "var(--color-bt-card-raised)",
        borderTop: "1px solid var(--color-bt-subtle-border)",
        padding: "9px 14px",
      }}
    >
      {footer}
    </div>
  ) : null;

  // Two teams (match-play cup) → the tweaked bar: names on their own row (wrap
  // toward center), then the two scores flanking the target + an INLINE progress
  // bar (the bar rides between the scores here, not on its own row — that's what
  // keeps the collapsed bar short).
  if (teams.length <= 2) {
    const [a, b] = teams;
    const aTotal = a ? teamTotals[a.id] ?? 0 : 0;
    const bTotal = b ? teamTotals[b.id] ?? 0 : 0;
    const aWidth = pointsAvailable > 0 ? Math.min(100, (aTotal / pointsAvailable) * 100) : 0;
    const bWidth = pointsAvailable > 0 ? Math.min(100, (bTotal / pointsAvailable) * 100) : 0;
    return (
      <div style={card} data-testid="competition-hero-collapsed">
        <div style={{ padding: "11px 14px 12px" }}>
          {/* Names — own row, wrap toward center, team-colored, group icon,
              tappable → that team's editor (same as the expanded hero). */}
          <div className="flex items-start justify-between gap-3.5">
            <MiniName team={a} align="left" onEditTeam={onEditTeam} />
            <MiniName team={b} align="right" onEditTeam={onEditTeam} />
          </div>
          {/* Scores flank the target + inline bar. */}
          <div className="flex items-center gap-3.5" style={{ marginTop: 5 }}>
            <MiniScore team={a} points={aTotal} />
            <div className="min-w-0 flex-1">
              <div
                className="text-center"
                style={{ fontSize: 11, fontWeight: 500, lineHeight: 1, color: "var(--color-bt-text-dim)" }}
              >
                {targetLabel}
              </div>
              {pointsAvailable > 0 && a && b && (
                <div
                  className="relative mt-[7px] flex h-1 w-full overflow-hidden rounded-full"
                  style={{ background: "rgba(148,163,184,0.18)" }}
                >
                  <div className="h-full rounded-l-full transition-all duration-500" style={{ width: `${aWidth}%`, background: a.color }} />
                  <div className="ml-auto h-full rounded-r-full transition-all duration-500" style={{ width: `${bWidth}%`, background: b.color }} />
                  <div
                    className="absolute left-1/2 top-1/2 h-full w-0.5 -translate-x-1/2 -translate-y-1/2"
                    style={{ background: "var(--color-bt-text)", opacity: 0.45 }}
                  />
                </div>
              )}
            </div>
            <MiniScore team={b} points={bTotal} />
          </div>
        </div>
        {footerBlock}
      </div>
    );
  }

  // N teams (points cup) → an evenly-spaced name-over-score row + target below.
  return (
    <div style={card} data-testid="competition-hero-collapsed">
      <div style={{ padding: "11px 14px 12px" }}>
        <div className="flex items-stretch justify-between gap-2.5">
          {teams.map((t) => (
            <CollapsedTeam key={t.id} team={t} points={teamTotals[t.id] ?? 0} name={t.short_name ?? t.name} align="left" onEditTeam={onEditTeam} />
          ))}
        </div>
        <div className="mt-1.5 text-center">
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-bt-text-dim)" }}>{targetLabel}</span>
        </div>
      </div>
      {footerBlock}
    </div>
  );
}

/** One team's big score in the collapsed bar's scores row (team-colored). */
function MiniScore({ team, points }: { team: LBTeam | undefined; points: number }) {
  if (!team) return <span style={{ width: 1 }} />;
  return (
    <span
      className="tabular-nums"
      style={{ fontSize: 28, fontWeight: 800, lineHeight: 1, letterSpacing: "-0.02em", color: team.color }}
    >
      {fmtPts(points)}
    </span>
  );
}

/** A team name on its side of the collapsed bar — team-colored, group icon,
 *  wraps toward center (no truncate), capped so it never crowds the scores.
 *  Tappable → that team's editor (disabled/inert where onEditTeam is omitted). */
function MiniName({
  team,
  align,
  onEditTeam,
}: {
  team: LBTeam | undefined;
  align: "left" | "right";
  onEditTeam?: (teamId: string) => void;
}) {
  if (!team) return <div style={{ maxWidth: "38%" }} />;
  return (
    <button
      type="button"
      onClick={() => onEditTeam?.(team.id)}
      disabled={!onEditTeam}
      className={`flex min-w-0 items-center gap-1.5 disabled:cursor-default ${align === "right" ? "justify-end text-right" : ""}`}
      style={{ maxWidth: "38%" }}
      data-testid={`comp-team-name-collapsed-${align === "left" ? "a" : "b"}`}
    >
      {align === "left" && <Users size={13} style={{ color: team.color, flexShrink: 0 }} />}
      <span style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.25, color: team.color }}>{team.name}</span>
      {align === "right" && <Users size={13} style={{ color: team.color, flexShrink: 0 }} />}
    </button>
  );
}

/**
 * ProjectionRow — the game-page header's ROW 2 (#533): each team's PROJECTED
 * contribution to the cup if this game ended now (a presentation rollup of the
 * scoreboard's on-page results — see gameProjection.ts). Provisional styling:
 * DESATURATED team tone (the team color at reduced opacity — recognizably the
 * team, clearly not final) while live, SOLID (full color, no "projected") once
 * the game is complete. One tight line: contributions flank a centered game name +
 * "projected". N-team-aware. Neutral chrome (color on the numbers only).
 */
export function ProjectionRow({
  teams,
  teamTotals,
  perTeam,
  final,
}: {
  teams: LBTeam[];
  /** Current realized cup totals per team — the projected TOTAL = this + the
   *  game's projected delta (perTeam). In-progress games aren't yet in the
   *  totals, so total = realized + projected reads correctly. */
  teamTotals: Record<string, number>;
  perTeam: Record<string, number>;
  final: boolean;
  // gameName dropped: the app bar (#550) now carries the game title, so repeating
  // it here was redundant. Kept off the projected tier per the tweaked design.
}) {
  const label = (
    <div className="flex-shrink-0 text-center">
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.14em", color: "var(--color-bt-text-dim)", lineHeight: 1 }}>
        {final ? "FINAL" : "PROJECTED"}
      </div>
      <div style={{ fontSize: 11, fontWeight: 400, color: "var(--color-bt-text-dim)", lineHeight: 1.2, marginTop: 3 }}>
        {final ? "this game" : "if today holds"}
      </div>
    </div>
  );

  if (teams.length <= 2) {
    const [a, b] = teams;
    return (
      <div className="flex items-center justify-between gap-3" data-testid="header-projection">
        <ProjTeam team={a} perTeam={perTeam} teamTotals={teamTotals} final={final} align="left" />
        {label}
        <ProjTeam team={b} perTeam={perTeam} teamTotals={teamTotals} final={final} align="right" />
      </div>
    );
  }
  return (
    <div data-testid="header-projection">
      <div className="flex items-stretch justify-between gap-2.5">
        {teams.map((t) => (
          <ProjTeam key={t.id} team={t} perTeam={perTeam} teamTotals={teamTotals} final={final} align="left" />
        ))}
      </div>
      <div className="mt-1.5">{label}</div>
    </div>
  );
}

/** One team's projected tier block: the projected TOTAL (team-colored) + a delta
 *  chip for this game's contribution. While live the total = realized + projected
 *  delta; once final the game's points are already in the realized total, so the
 *  total is realized and the chip shows what this game added. */
function ProjTeam({
  team,
  perTeam,
  teamTotals,
  final,
  align,
}: {
  team: LBTeam | undefined;
  perTeam: Record<string, number>;
  teamTotals: Record<string, number>;
  final: boolean;
  align: "left" | "right";
}) {
  if (!team) return <div style={{ minWidth: 80 }} />;
  const p = perTeam[team.id] ?? 0;
  const total = final ? teamTotals[team.id] ?? 0 : (teamTotals[team.id] ?? 0) + p;
  const num = (
    <span
      className="tabular-nums"
      style={{ fontSize: 24, fontWeight: 800, lineHeight: 1, letterSpacing: "-0.02em", color: team.color }}
    >
      {fmtPts(total)}
    </span>
  );
  const chip = <DeltaChip color={team.color} delta={p} />;
  return (
    <div
      className={`flex min-w-0 items-baseline gap-2 ${align === "right" ? "justify-end" : ""}`}
      style={{ minWidth: 80 }}
    >
      {align === "left" ? (<>{num}{chip}</>) : (<>{chip}{num}</>)}
    </div>
  );
}

/** Delta chip — this game's point contribution, as a team-tinted pill (team color
 *  on a 16%-alpha team fill). ▲ for a positive contribution; a plain 0 when the
 *  game hasn't moved the team yet (match-play contributions are never negative). */
function DeltaChip({ color, delta }: { color: string; delta: number }) {
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
      {delta > 0 && <span style={{ fontSize: 8 }}>&#9650;</span>}
      {fmtPts(delta)}
    </span>
  );
}

/** One team's name-over-score block in the collapsed bar (team-colored data).
 *  Tappable → that team's editor (inert where onEditTeam is omitted). */
function CollapsedTeam({
  team,
  points,
  name,
  align,
  onEditTeam,
}: {
  team: LBTeam | undefined;
  points: number;
  name: string | undefined;
  align: "left" | "right";
  onEditTeam?: (teamId: string) => void;
}) {
  if (!team) return <div style={{ minWidth: 100 }} />;
  return (
    <button
      type="button"
      onClick={() => onEditTeam?.(team.id)}
      disabled={!onEditTeam}
      className="min-w-0 flex-1 disabled:cursor-default"
      style={{ textAlign: align, minWidth: 96 }}
      data-testid={`comp-team-name-collapsed-${team.id}`}
    >
      <div className="truncate" style={{ fontSize: 11, fontWeight: 600, color: team.color, lineHeight: 1.1 }}>
        {name ?? team.name}
      </div>
      <div className="tabular-nums" style={{ fontSize: 26, fontWeight: 800, color: team.color, lineHeight: 1, marginTop: 1 }}>
        {fmtPts(points)}
      </div>
    </button>
  );
}

/** A team name on its side of the hero — full name, team-colored, group icon,
 *  tappable to that team's identity editor (owner / its captain). */
function TeamName({
  team,
  onEditTeam,
  align,
}: {
  team: LBTeam;
  onEditTeam?: (teamId: string) => void;
  align: "left" | "right";
}) {
  const content = (
    <>
      {align === "left" && <Users size={14} style={{ color: team.color, flexShrink: 0 }} />}
      <span className="truncate" style={{ fontSize: 15, fontWeight: 600, color: team.color }}>
        {team.name}
      </span>
      {align === "right" && <Users size={14} style={{ color: team.color, flexShrink: 0 }} />}
    </>
  );
  return (
    <button
      type="button"
      onClick={() => onEditTeam?.(team.id)}
      disabled={!onEditTeam}
      className={`flex min-w-0 items-center gap-1.5 disabled:cursor-default ${align === "right" ? "justify-end text-right" : ""}`}
      data-testid={`comp-team-name-${align === "left" ? "a" : "b"}`}
    >
      {content}
    </button>
  );
}

/** The dimensional gold trophy — verbatim geometry from the approved
 *  hero_trophy_reference.html (viewBox 0 0 300 380, group opacity 0.17). Open
 *  modeled mouth, gradient-lit round body, slim knopped pedestal, engraved star.
 *  Raw hex is the sanctioned hero art. IDs are prefixed to avoid <defs> clashes. */
function HeroTrophy() {
  return (
    <svg
      width="300"
      viewBox="0 0 300 380"
      aria-hidden="true"
      style={{
        position: "absolute",
        left: "50%",
        top: "50%",
        transform: "translate(-50%,-46%)",
        pointerEvents: "none",
      }}
    >
      <defs>
        <linearGradient id="btHeroBowl" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#f6e0a0" />
          <stop offset="0.42" stopColor="#d9b350" />
          <stop offset="1" stopColor="#8a6a24" />
        </linearGradient>
        <linearGradient id="btHeroBase" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#ecd282" />
          <stop offset="1" stopColor="#87682a" />
        </linearGradient>
      </defs>
      <g opacity="0.17">
        {/* base (two tiers) + knop + narrow tall pedestal */}
        <rect x="96" y="320" width="108" height="24" rx="6" fill="url(#btHeroBase)" />
        <rect x="120" y="305" width="60" height="15" rx="4" fill="url(#btHeroBase)" />
        <ellipse cx="150" cy="298" rx="19" ry="8" fill="url(#btHeroBase)" />
        <rect x="142" y="258" width="16" height="42" fill="url(#btHeroBase)" />
        {/* slim handles (lit left / shadow right) */}
        <path d="M60,104 Q24,114 32,166 Q38,204 82,198" fill="none" stroke="#cfa94e" strokeWidth="13" strokeLinecap="round" />
        <path d="M240,104 Q276,114 268,166 Q262,204 218,198" fill="none" stroke="#a5822f" strokeWidth="13" strokeLinecap="round" />
        {/* bowl body: left->right gradient = round modeling */}
        <path d="M58,88 Q58,228 150,260 Q242,228 242,88 Z" fill="url(#btHeroBowl)" />
        {/* soft highlight on the lit side */}
        <ellipse cx="106" cy="152" rx="11" ry="52" fill="#fff0bf" opacity="0.5" />
        {/* engraved 5-point star (darker gold = recessed) */}
        <path
          d="M150,132 L157.6,151.5 L178.5,152.7 L162.4,166 L167.6,186.3 L150,175 L132.4,186.3 L137.6,166 L121.5,152.7 L142.4,151.5 Z"
          fill="#57411a"
        />
        {/* open mouth: light rim ellipse + dark inner hollow + faint far-wall shadow */}
        <ellipse cx="150" cy="86" rx="92" ry="19" fill="url(#btHeroBowl)" />
        <ellipse cx="150" cy="85" rx="75" ry="13" fill="#4a3915" />
        <ellipse cx="133" cy="82" rx="38" ry="6" fill="#6b5320" opacity="0.7" />
      </g>
    </svg>
  );
}

