"use client";

import { useEffect, useRef, useState } from "react";
import { Trophy, Settings, Users } from "lucide-react";
import { fmtPts } from "./GameRow";
import type { LBTeam } from "./CompetitionLeaderboard";
import type { ScoringModel } from "@/lib/gameTypes";

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
        // ART: gradient card + soft float shadow (raw hex per the hero carve-out).
        position: "relative",
        overflow: "hidden", // crops the trophy so it bleeds top/bottom
        borderRadius: 16,
        border: "1px solid var(--color-bt-border)",
        background: "linear-gradient(158deg,#222e44 0%,#1a2231 100%)",
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
        {/* Top row: identity (left) + gear (right). */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2.5">
            <span
              className="flex flex-shrink-0 items-center justify-center rounded-xl"
              style={{
                width: 36,
                height: 36,
                background: "var(--color-bt-accent-faint)",
                color: "var(--color-bt-accent)",
              }}
            >
              <Trophy size={18} />
            </span>
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

            {/* Below the bar: ONLY the win target (Task 2). */}
            <p className="mt-2 text-center" style={{ fontSize: 12, color: "var(--color-bt-text-dim)" }}>
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
 * `stickyTop` offsets the pin below any fixed nav (the leaderboard's TopNav is 56px).
 */
export function StickyCollapseHero({
  stickyTop = 0,
  ...hero
}: React.ComponentProps<typeof CompetitionHero> & { stickyTop?: number }) {
  const collapsedRef = useRef<HTMLDivElement>(null);
  const [collapsedH, setCollapsedH] = useState(64); // sensible seed → no first-paint jump
  useEffect(() => {
    const el = collapsedRef.current;
    if (!el) return;
    const measure = () => setCollapsedH(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div style={{ position: "relative" }}>
      <div ref={collapsedRef} style={{ position: "sticky", top: stickyTop, zIndex: 10 }}>
        <CompetitionHero {...hero} variant="collapsed" />
      </div>
      <div style={{ position: "relative", zIndex: 20, marginTop: -collapsedH }}>
        <CompetitionHero {...hero} variant="expanded" />
      </div>
    </div>
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
}: {
  teams: LBTeam[];
  teamTotals: Record<string, number>;
  winNumber: number;
  pointsAvailable: number;
  clincher: LBTeam | null;
}) {
  const targetLabel = clincher
    ? `${clincher.short_name ?? clincher.name} wins`
    : pointsAvailable > 0
      ? `First to ${fmtPts(winNumber)}`
      : "No points yet";
  const card: React.CSSProperties = {
    borderRadius: 12,
    // NEUTRAL chrome — the same hero gradient art as expanded (STYLE_GUIDE hero
    // carve-out), NO team-color wash. Team color lives on the scores/names only.
    border: "1px solid var(--color-bt-border)",
    background: "linear-gradient(158deg,#212c40 0%,#1a2231 100%)",
    boxShadow: "0 4px 14px rgba(0,0,0,0.35)",
    padding: "11px 18px",
  };
  const target = (
    <span
      className="uppercase"
      style={{ fontSize: 10, fontWeight: 600, letterSpacing: ".04em", color: "var(--color-bt-text-dim)" }}
    >
      {targetLabel}
    </span>
  );

  // Two teams (match-play cup) → the mock: name/score flanking a centered target.
  if (teams.length <= 2) {
    const [a, b] = teams;
    return (
      <div style={card} data-testid="competition-hero-collapsed">
        <div className="flex items-center justify-between gap-2">
          <CollapsedTeam team={a} points={a ? teamTotals[a.id] ?? 0 : 0} name={a?.name} align="left" />
          <div className="flex-1 text-center">{target}</div>
          <CollapsedTeam team={b} points={b ? teamTotals[b.id] ?? 0 : 0} name={b?.name} align="right" />
        </div>
      </div>
    );
  }

  // N teams (points cup) → an evenly-spaced row + the target on its own line.
  return (
    <div style={card} data-testid="competition-hero-collapsed">
      <div className="flex items-stretch justify-between gap-2.5">
        {teams.map((t) => (
          <CollapsedTeam key={t.id} team={t} points={teamTotals[t.id] ?? 0} name={t.short_name ?? t.name} align="left" />
        ))}
      </div>
      <div className="mt-1.5 text-center">{target}</div>
    </div>
  );
}

/** One team's name-over-score block in the collapsed bar (team-colored data). */
function CollapsedTeam({
  team,
  points,
  name,
  align,
}: {
  team: LBTeam | undefined;
  points: number;
  name: string | undefined;
  align: "left" | "right";
}) {
  if (!team) return <div style={{ minWidth: 100 }} />;
  return (
    <div className="min-w-0 flex-1" style={{ textAlign: align, minWidth: 96 }}>
      <div className="truncate" style={{ fontSize: 11, fontWeight: 600, color: team.color, lineHeight: 1.1 }}>
        {name ?? team.name}
      </div>
      <div className="tabular-nums" style={{ fontSize: 26, fontWeight: 800, color: team.color, lineHeight: 1, marginTop: 1 }}>
        {fmtPts(points)}
      </div>
    </div>
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
