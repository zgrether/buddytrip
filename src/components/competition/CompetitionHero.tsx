"use client";

import { useState } from "react";
import { Settings, Trophy } from "lucide-react";
import { fmtPts, ProjectionPill } from "./GameRow";
import { ClinchCelebration } from "./ClinchCelebration";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import type { TrophySlot } from "./CupTrophy";
import type { LBTeam } from "./CompetitionLeaderboard";
import type { ScoringModel } from "@/lib/gameTypes";

// `useIsoLayoutEffect` lived here to drive StickyCollapseHero's measured pull.
// That mechanism is gone (see StickyCollapseHero), and with it the only layout
// measurement in this file — so the helper went too rather than sitting unused.

// The neutral fallback card (no two teams to tint from — a points cup's identity
// hero, or a half-built 2-team cup).
/**
 * Is this cup a RACE — two sides running at a win number?
 *
 * Every match-play construct on this surface is gated on it: the trophy, the
 * glow, the two-score treatment, the "first to X" target, the clinch
 * celebration, and now the collapsed mini-bar. A points cup accrues open-endedly
 * and has placements rather than a race, so those constructs have nothing to
 * say there.
 *
 * ONE function rather than the expression repeated per construct, because the
 * ones written separately are the ones that drift: the clinch banner rendered
 * unconditionally for a while and announced a clinch above a hero that had no
 * clinch treatment at all, and the mini-bar was doing the same thing until this
 * commit.
 */
export function isRace(scoringModel: ScoringModel, teamCount: number): boolean {
  return scoringModel === "match_play" && teamCount >= 2;
}

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
  projectedTeamTotals,
  hasLiveProjection = false,
  pointsAvailable,
  winNumber,
  clincher,
  gamesRemaining,
  scoringModel,
  canEdit,
  onSettings,
  onEditTeam,
  variant = "expanded",
  cupComplete = false,
  celebrateFirstView = false,
  canReplayCelebration = false,
  onCelebrated,
  trophy,
}: {
  cupName: string;
  tagline: string | null;
  teams: LBTeam[];
  teamTotals: Record<string, number>;
  /** Per-team projected total ("if today holds") = banked + Σ live projections
   *  (server-summed). Absent on callers with no projection (game-page header). */
  projectedTeamTotals?: Record<string, number>;
  /** ≥1 game live → render the projected tier at all (independent of any delta).
   *  Default false → no tier (the between-rounds / points-cup / collapsed cases). */
  hasLiveProjection?: boolean;
  pointsAvailable: number;
  winNumber: number;
  clincher: LBTeam | null;
  /** How many games have NOT reached a final, locked result — the count the
   *  "clinched · N games remain" line names (`gamesRemaining` from
   *  `@/lib/cupCompletion`, same `data.games` the `cupComplete` gate reads).
   *  Only consulted when `clincher` is set and `cupComplete` is false — the
   *  message previously read the literal words "games remain" with no count
   *  interpolated at all. */
  gamesRemaining: number;
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
  /** The cup is decided AND finished (`isCupComplete`) — not merely clinched.
   *  Drives the lit trophy + winner-colour wash. Clinched-with-games-remaining
   *  stays on the resting watermark; that distinction is the whole feature. */
  cupComplete?: boolean;
  /** This device hasn't seen this cup's celebration yet → play the burst once.
   *  Only ever true alongside `cupComplete` and `variant === "expanded"`. */
  celebrateFirstView?: boolean;
  /** The viewer is on the winning team → offer the "set off the fireworks"
   *  re-fire. Same gate as the automatic burst: sparks belong to whoever won. */
  canReplayCelebration?: boolean;
  /** Fired once the burst has rendered, so the caller can record the showing. */
  onCelebrated?: () => void;
  /** Swap the centrepiece artwork (defaults to the gold cup). One line — the
   *  animation wraps the slot and never references its geometry. */
  trophy?: TrophySlot;
}) {
  // The two-score + trophy treatment is the match_play hero; points keeps its own
  // standings body below (untouched), so the hero there is identity + gear only.
  const showScores = isRace(scoringModel, teams.length);
  const [a, b] = teams;

  // Manual re-fire (winners only). A counter, not a boolean — see
  // `ClinchCelebration`'s `replayNonce` doc for why.
  const [replayNonce, setReplayNonce] = useState(0);
  // The button is HIDDEN, not merely inert, under reduced motion: the CSS
  // suppresses the burst there, so the control would be tappable and do
  // visibly nothing. Offering nothing is better than offering a lie.
  const reducedMotion = usePrefersReducedMotion();
  const showReplay = showScores && cupComplete && canReplayCelebration && !reducedMotion;

  if (variant === "collapsed") {
    return (
      <CollapsedHero
        teams={teams}
        teamTotals={teamTotals}
        winNumber={winNumber}
        pointsAvailable={pointsAvailable}
        clincher={clincher}
        scoringModel={scoringModel}
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
      {/* The hero's centre: glow + trophy, in one component so the resting
          watermark and the lit celebration share a single placement. Was two
          separate blocks here (a warm gold wash and the trophy); they moved
          together because the celebration changes both and drifting them apart
          is how the trophy ends up lit but off-centre.

          `celebrate` is gated on `variant === "expanded"` at the callsite —
          `StickyCollapseHero` renders this component TWICE (the pinned collapsed
          bar and the expanded card), and an ungated burst would fire in both. */}
      {showScores && (
        <ClinchCelebration
          cupComplete={cupComplete}
          winnerColor={clincher?.color ?? null}
          celebrate={celebrateFirstView}
          replayNonce={replayNonce}
          onCelebrated={onCelebrated}
          trophy={trophy}
        />
      )}

      {/* CONTENT — sharp, in front of the art. Horizontal padding matches the
          trip-header card (16px) rather than the mockup's standalone 24px, since
          the Live-face main already insets the card — keeps content off the edges
          without the doubled gap. */}
      <div style={{ position: "relative", padding: "18px 16px 20px" }}>
        {/* Top row: identity (left) + gear (right). The inline trophy TILE next to
            the cup name is dropped (the hero already carries the big trophy). */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.1, color: "var(--color-bt-text)" }}>
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
            {/* Team names row — FULL names: this is a SUBJECT slot, the one
                place the crew's own names are the content rather than a key
                (STYLE_GUIDE "Team names — subject slots vs label slots").
                Team-colored, each on its side, tappable → that team's editor.

                `mt-3` here and `mt-2` on the progress bar below (both were
                `mt-4`) pay for most of the second reserved name line: 20px of
                new height against 12px of reclaimed slack, so the panel grows
                ~8px rather than ~20px. */}
            <div className="mt-3 flex items-center justify-between gap-3">
              <TeamName team={a} onEditTeam={onEditTeam} align="left" />
              <TeamName team={b} onEditTeam={onEditTeam} align="right" />
            </div>

            {/* Scores — the two big team-colored numbers flanking the trophy.
                Sized by CONTENT, not viewport. At a fixed 74px a two-decimal pair
                ("18.75" – "28.75") needs roughly 460px of digits and gap, so the
                right-hand number ran off a 375px screen. A media query would fix
                the phone and still clip a long value on a wider one; the length of
                the number is what actually decides. Both sides take the SAME size
                so they stay a matched pair rather than one shrinking alone. */}
            <div className="mt-1 flex items-baseline justify-between gap-4">
              {(() => {
                const aStr = fmtPts(aTotal);
                const bStr = fmtPts(bTotal);
                // tabular digits run ~0.6em wide, so N chars ≈ 0.6·N·size per side;
                // these steps keep the pair inside 375px minus the card's padding.
                const longest = Math.max(aStr.length, bStr.length);
                const size = longest >= 5 ? 46 : longest === 4 ? 58 : longest === 3 ? 66 : 74;
                // On a FINISHED cup the loser's number steps back to 62% — the
                // winner reads first, but 39½–28 stays a scoreline. It is dimmed,
                // never removed or greyed to the muted token: keeping the team's
                // own colour is what makes this read as emphasis on the winner
                // rather than an error state on the loser. Only on `cupComplete`
                // — dimming a team while games remain would be editorialising
                // about a result that isn't in yet.
                const loserOpacity = 0.62;
                const aDim = cupComplete && clincher != null && clincher.id !== a.id;
                const bDim = cupComplete && clincher != null && clincher.id !== b.id;
                return (
                  <>
                    <span
                      style={{ fontSize: size, fontWeight: 700, lineHeight: 1, letterSpacing: "-0.02em", color: a.color, opacity: aDim ? loserOpacity : 1 }}
                      className="tabular-nums"
                      data-testid={aDim ? "hero-score-dimmed" : undefined}
                    >
                      {aStr}
                    </span>
                    <span
                      style={{ fontSize: size, fontWeight: 700, lineHeight: 1, letterSpacing: "-0.02em", color: b.color, opacity: bDim ? loserOpacity : 1 }}
                      className="tabular-nums"
                      data-testid={bDim ? "hero-score-dimmed" : undefined}
                    >
                      {bStr}
                    </span>
                  </>
                );
              })()}
            </div>

            {/* Clinch bar — track + each team's end-fill + a lead marker. */}
            <div
              className="relative mt-2 flex h-2 w-full overflow-hidden rounded-full"
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
            {/* "Final" is claimed ONLY when the cup is actually finished.
                Previously this read `Final · X wins` the moment anyone clinched,
                which is wrong in the common clinch-early case: the cup is
                DECIDED, the games keep being played, and the hero announced the
                event was over while people were still on the course. Deciding
                and finishing are different, and this line now says which. */}
            <p className="mt-2 text-center" style={{ fontSize: 13, fontWeight: 600, color: "var(--color-bt-text-dim)" }}>
              {clincher
                ? cupComplete
                  ? `Final · ${clincher.name} wins`
                  : `${clincher.name} has clinched · ${gamesRemaining} game${gamesRemaining === 1 ? "" : "s"} remain${gamesRemaining === 1 ? "s" : ""}`
                : pointsAvailable > 0
                ? `First to ${fmtPts(winNumber)} wins`
                : "No points in play yet"}
            </p>

            {/* Set off the fireworks — the winning team's own re-fire.
                Deliberately quiet: a ghost pill in the winner's colour, not a
                filled CTA. The screen's job is announcing the result; this is a
                small toy underneath it, and a loud button would compete with
                the scoreline it sits below. */}
            {showReplay && (
              <div className="mt-2.5 flex justify-center">
                <button
                  type="button"
                  onClick={() => setReplayNonce((n) => n + 1)}
                  data-testid="clinch-replay-btn"
                  className="rounded-full px-3 py-1.5 text-[12px] font-semibold transition-[background-color,transform] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-bt-accent)]"
                  style={{
                    color: clincher?.color ?? "var(--color-bt-text)",
                    background: "rgba(255,255,255,0.07)",
                    border: `1px solid ${clincher ? `color-mix(in srgb, ${clincher.color} 40%, transparent)` : "var(--color-bt-border)"}`,
                  }}
                >
                  Set off the fireworks
                </button>
              </div>
            )}

            {/* PROJECTED "if today holds" tier (Path A) — banked + Σ live-game
                projections per team, with a ▲ delta pill. TIER GATE: only when ≥1
                game is live (hasLiveProjection); nothing live → the hero collapses to
                just the banked score above. */}
            {hasLiveProjection && a && b && (
              <div
                className="mt-3.5 pt-3.5"
                style={{ borderTop: "1px solid var(--color-bt-subtle-border)" }}
                data-testid="hero-projected-tier"
              >
                <p
                  className="mb-2 text-center"
                  style={{ fontSize: 10.5, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 700, color: "var(--color-bt-text-dim)" }}
                >
                  Projected if today holds
                </p>
                <div className="flex items-center justify-between">
                  <HeroProjSide team={a} projected={projectedTeamTotals?.[a.id] ?? aTotal} banked={aTotal} winNumber={winNumber} align="left" />
                  <HeroProjSide team={b} projected={projectedTeamTotals?.[b.id] ?? bTotal} banked={bTotal} winNumber={winNumber} align="right" />
                </div>
              </div>
            )}
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
 * ── WHERE IT PINS is a breakpoint question, not a number a caller passes ────
 * This took a `stickyTop` prop and the leaderboard passed 56, to clear the app
 * bar. That was right when the board scrolled the PAGE under a `sticky top-0`
 * 56px `TopNav` — still the model on mobile, so `top-14` stays there.
 *
 * At `lg+` it has been wrong since the shell became a bounded column: the
 * scroller is the board pane itself, which already BEGINS below the bar, so 56
 * is pure gap. And it is not only the pinned state — `position: sticky` pushes
 * an element DOWN even at rest when its natural offset inside the scrollport is
 * less than `top`, which for a box at the top of the column is always. That is
 * the ~50px the mini sat below the header.
 *
 * Expressed as `top-14 lg:top-0` rather than a prop: the answer depends on which
 * element scrolls, which is a layout fact the component can read from the
 * breakpoint and a caller can only guess at. It is also NOT a measurement — the
 * measured pull this file used to carry is gone for good, and this must not
 * become its replacement.
 */
export function StickyCollapseHero(hero: React.ComponentProps<typeof CompetitionHero>) {
  /**
   * ── NO MEASUREMENT. That is the whole change. ───────────────────────────────
   *
   * This used to render the collapsed bar and the expanded hero as two IN-FLOW
   * siblings and pull the hero up over the bar with a measured negative margin:
   * a `pull` state seeded at 64, corrected by a layout effect, a
   * `ResizeObserver` on both nodes, and a scroll listener, with a guard that
   * skipped the measure while the bar was pinned.
   *
   * It produced the same class of bug three times — "leaderboard sits halfway
   * down", "padding above the hero keeps growing", and most recently Cup
   * rendering ~50px low after a resize or a tab switch. The last one is the
   * clearest statement of why the mechanism was never going to hold: the
   * pinned-state guard tests `rect.top <= stickyTop + 1`, and a HIDDEN element's
   * rect is all zeros — so `0 <= 1` and the measure silently skipped for as long
   * as Cup sat on the inactive tab, leaving `pull` stale across exactly the
   * relayouts (maximise, switch back to Cup) that needed it most. Every fix
   * added another condition to a loop that reads the layout it is writing.
   *
   * The structure replaces it. The collapsed bar sits in a `height: 0` sticky
   * box with its content absolutely positioned, so:
   *
   *   - it contributes NOTHING to flow, so the expanded hero already sits where
   *     the pull was trying to drag it — no correction to compute, no seed, no
   *     frame of the wrong offset;
   *   - it still pins, and still travels the whole board, because a `height: 0`
   *     sticky box is constrained by its CONTAINING BLOCK (the leaderboard's
   *     column), not by its own height;
   *   - the hero's `zIndex: 20` covers it at rest and reveals it on scroll,
   *     which is the same visual contract as before.
   *
   * KEEP THIS A FRAGMENT. Wrapping the two in a div would make that wrapper the
   * sticky box's containing block, and the bar would unstick the moment the hero
   * scrolled past instead of riding the whole list.
   *
   * `-mt-3` cancels the 12px of `space-y-3` rhythm the leaderboard's column puts
   * between its children — which the zero-height bar would otherwise open as a
   * gap above the hero. It is a coupled constant and it is named as one: if that
   * column's spacing changes, this changes with it. It is deliberately a
   * constant rather than a measurement, because it fails VISIBLY (a 12px gap)
   * rather than silently, which is the property the old mechanism lacked.
   */
  /**
   * NO MINI-BAR on a points cup. It is a race construct — two teams and a
   * target — and a points cup has neither, so there is nothing for it to show
   * that the board's own standings don't already say.
   *
   * What it rendered before this: for N>2 an evenly-spaced row of name/score
   * blocks (coherent, but a second copy of the standings directly above them),
   * and — worse — for a TWO-team points cup it fell into the two-team branch and
   * drew the two-score race bar complete with a progress fill. A race UI for
   * something that is not a race.
   *
   * The expanded hero stays either way; only the pinned mini goes. Gated on the
   * SAME `isRace` the hero's own constructs read, so the two cannot disagree
   * about what a points cup is.
   */
  if (!isRace(hero.scoringModel, hero.teams.length)) {
    return <CompetitionHero {...hero} variant="expanded" />;
  }

  return (
    <>
      <div className="sticky top-14 z-10 h-0 lg:top-0">
        <div style={{ position: "absolute", insetInline: 0, top: 0 }}>
          <CompetitionHero
            {...hero}
            variant="collapsed"
            /* TWO CompetitionHero instances render here, and the celebration must
               fire in exactly ONE. Cut off at the prop rather than relying on
               `CollapsedHero`'s early return two hundred lines away — a future
               collapsed bar that grew a trophy would otherwise silently burn the
               one showing from a pinned strip. */
            celebrateFirstView={false}
            onCelebrated={undefined}
          />
        </div>
      </div>
      <div className="-mt-3" style={{ position: "relative", zIndex: 20 }}>
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
  scoringModel = "match_play",
  footer,
  onEditTeam,
}: {
  teams: LBTeam[];
  teamTotals: Record<string, number>;
  winNumber: number;
  pointsAvailable: number;
  clincher: LBTeam | null;
  /** Points cups have no clinch target ("first to X" isn't calculable) — for points the
   *  collapsed bar drops the target line + the race-bar, showing just the team scores.
   *  Defaults to match_play (the game-page header usage keeps its behavior). */
  scoringModel?: ScoringModel;
  /** Optional projected tier INSIDE the same card, as a flush card-raised row —
   *  the game-page header's projection (#533). Omitted on the leaderboard's sticky
   *  bar. */
  footer?: React.ReactNode;
  /** Tap a team name → that team's identity editor (owner / its captain), same as
   *  the expanded hero. Omitted where team editing isn't wired (the game page) →
   *  the names render non-interactive. */
  onEditTeam?: (teamId: string) => void;
}) {
  // "First to X" / clinch is match-play only (a fixed points ceiling makes it calculable);
  // points accrues open-endedly, so no target. `null` → the collapsed bar shows no target line.
  const targetLabel =
    scoringModel === "points"
      ? null
      : clincher
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
              tappable → that team's editor (same as the expanded hero).

              `items-end`, not `items-start`. This is what keeps the two sides
              aligned when one name wraps to two lines and the other does not:
              bottom-aligning the buttons lands their ROSTER labels on the same
              line. It replaces `MiniName`'s two-line reserve, which bought the
              same alignment by padding EVERY short name down a line — 16px on
              every surface that mounts this bar, including the three game pages
              that render it in flow. Same guarantee, natural height.

              With `items-start` and no reserve, a 1-line side's ROSTER would sit
              a line above the 2-line side's. That is the case to keep in mind if
              anyone is tempted back to `items-start`. */}
          <div className="flex items-end justify-between gap-3.5">
            <MiniName team={a} align="left" onEditTeam={onEditTeam} />
            <MiniName team={b} align="right" onEditTeam={onEditTeam} />
          </div>
          {/* Scores flank the target + inline bar. */}
          <div className="flex items-center gap-3.5" style={{ marginTop: 5 }}>
            <MiniScore team={a} points={aTotal} />
            <div className="min-w-0 flex-1">
              {targetLabel && (
                <div
                  className="text-center"
                  style={{ fontSize: 11, fontWeight: 500, lineHeight: 1, color: "var(--color-bt-text-dim)" }}
                >
                  {targetLabel}
                </div>
              )}
              {/* The race-bar is match-play's clinch viz (share of a fixed total); points has
                  no ceiling, so it's dropped there (targetLabel is null). */}
              {targetLabel && pointsAvailable > 0 && a && b && (
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
        {targetLabel && (
          <div className="mt-1.5 text-center">
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-bt-text-dim)" }}>{targetLabel}</span>
          </div>
        )}
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

/**
 * The "ROSTER" affordance label under a tappable team name.
 *
 * Replaces the `Users` glyph that used to sit beside the name. An icon isn't a
 * verb — a person outline next to a team name reads as decoration (or as "team",
 * which the name already says), not as "tap here to open the roster". The word
 * says what the tap does.
 *
 * Rendered ONLY when the name is actually tappable. `GamePageHeader` mounts the
 * same `CollapsedHero` WITHOUT `onEditTeam`, so its names are inert; labelling an
 * inert control is the same failure as an unlabelled one, in the other direction.
 * This is a display rule, not a permission one — who may open the sheet, and what
 * they can do inside it, is unchanged and still decided by `TeamSheet`/`useCanEditTeam`.
 *
 * `--color-bt-text-dim` matches the hero's other secondary text (the tagline, the
 * "First to X wins" line) rather than tinting to the team color, which would
 * compete with the name it labels.
 */
function RosterLabel({ size = 10 }: { size?: number }) {
  return (
    <span
      style={{
        display: "block",
        fontSize: size,
        fontWeight: 600,
        letterSpacing: "0.09em",
        lineHeight: 1.1,
        color: "var(--color-bt-text-dim)",
      }}
    >
      ROSTER
    </span>
  );
}

/** A team name on its side of the collapsed bar — team-colored, wraps toward
 *  center (no truncate), capped so it never crowds the scores. The name + its
 *  ROSTER label are one tap target → that team's editor (inert, and unlabelled,
 *  where onEditTeam is omitted). */
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
      className={`flex min-w-0 flex-col gap-0.5 disabled:cursor-default ${align === "right" ? "items-end text-right" : "items-start text-left"}`}
      style={{ maxWidth: "38%" }}
      data-testid={`comp-team-name-collapsed-${align === "left" ? "a" : "b"}`}
    >
      {/* NO two-line reserve here — clamped, but not padded to two lines.
          The row bottom-aligns instead (`items-end`, see CollapsedHero).

          The reserve was copied down from the expanded hero's `TeamName` on the
          reasoning that the sticky bar and the expanded card are one surface in
          two components. The COPY was right; the reserve was not, because both
          of its justifications are properties of the expanded card and neither
          holds here:

            - a truncation bug — this bar never truncated, it wrapped;
            - two big scores sharing a baseline — the collapsed bar's scores are
              in their OWN row below (`MiniScore`), so they share a baseline with
              each other however tall the names get.

          What is genuinely at risk is the two ROSTER labels landing level when
          one name wraps and the other does not — and that is what `items-end` on
          the names row buys, at natural height, without padding every short name
          down by a line. Removing the cause rather than compensating for it.

          It cost 16px on EVERY surface that mounts this: the bar went 87px ->
          103px for a short name (measured, 375px viewport), and `GamePageHeader`
          renders it IN FLOW, so match / rack / non-golf all shifted down by that
          much. Note the inversion — a LONG name was 103px before this fix and
          after it, because it already wrapped to two lines. The reserve only
          ever changed the SHORT-name case, which is the case to check.

          `line-clamp-2` STAYS, and is strictly better than what preceded the
          reserve: before #1212 this had no clamp at all and a long legacy name
          could wrap to three lines or more. Bounded, not padded. */}
      {/* `break-normal`, matching `TeamName` — the SECOND render site of the
          same label, and the reason this is in the same commit rather than a
          follow-up. The defect is "a team name breaks mid-word", and this
          component has the tighter column of the two (capped at 38%), so it is
          if anything the likelier place to see it. Fixing the reported site and
          leaving this one is the half-sweep CLAUDE.md keeps recording — the
          sweep unit is the shared thing (a team name in a narrow slot), not the
          file the report happened to name. */}
      <span
        className="line-clamp-2 w-full break-normal"
        style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.2, color: team.color }}
      >
        {team.name}
      </span>
      {onEditTeam && <RosterLabel size={9} />}
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
  perTeam,
  final,
}: {
  teams: LBTeam[];
  // `teamTotals` is GONE: it existed only to compute the projected TOTAL that this
  // row no longer shows. The realized totals are already the hero's own number
  // directly above, so carrying them down here was what produced the duplicate.
  perTeam: Record<string, number>;
  /** Drives the label only ("FINAL / this game" vs "PROJECTED / if today holds"). */
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
        <ProjTeam team={a} perTeam={perTeam} align="left" />
        {label}
        <ProjTeam team={b} perTeam={perTeam} align="right" />
      </div>
    );
  }
  return (
    <div data-testid="header-projection">
      <div className="flex items-stretch justify-between gap-2.5">
        {teams.map((t) => (
          <ProjTeam key={t.id} team={t} perTeam={perTeam} align="left" />
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
  align,
}: {
  team: LBTeam | undefined;
  perTeam: Record<string, number>;
  align: "left" | "right";
}) {
  if (!team) return <div style={{ minWidth: 80 }} />;
  const p = perTeam[team.id] ?? 0;
  // THE DELTA ONLY. This used to lead with the projected TOTAL (realized + this
  // game's delta) and trail a small chip. On a finished game that total is the
  // number already shown directly above it in the hero — the same figure twice,
  // and the bigger of the two was the duplicate. What this row is FOR is the one
  // thing not shown anywhere else: what THIS game contributes.
  //
  // Sized `lg` so the pill carries the side on its own, matched to the two label
  // lines it sits beside rather than to the number it replaced — this row is also
  // the reduction in the projection bar's overall weight, not a swap.
  return (
    <div
      className={`flex min-w-0 items-baseline gap-2 ${align === "right" ? "justify-end" : ""}`}
      style={{ minWidth: 80 }}
    >
      <ProjectionPill color={team.color} value={p} size="lg" />
    </div>
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

/** A team name on its side of the hero — full name, team-colored, with the ROSTER
 *  affordance label beneath it. The whole block is one tap target → that team's
 *  editor (owner / its captain edit; a member gets it read-only). */
function TeamName({
  team,
  onEditTeam,
  align,
}: {
  team: LBTeam;
  onEditTeam?: (teamId: string) => void;
  align: "left" | "right";
}) {
  return (
    <button
      type="button"
      onClick={() => onEditTeam?.(team.id)}
      disabled={!onEditTeam}
      className={`flex min-w-0 flex-col gap-0.5 disabled:cursor-default ${align === "right" ? "items-end text-right" : "items-start text-left"}`}
      data-testid={`comp-team-name-${align === "left" ? "a" : "b"}`}
    >
      {/* 17 (was 15) — the name carries the block now that the icon is gone, and
          it has to stay the dominant element over the ROSTER label beneath it.

          TWO-LINE RESERVE, and the reserve is the point rather than the wrap.
          These are the crew's own names — the joke IS the content — so the name
          wraps instead of truncating. That makes the block's height depend on
          the name unless something pins it, and if one side wrapped while the
          other did not, `ROSTER` and the two big scores below would land on
          different baselines: worse than the truncation this replaces. So the
          block reserves two lines whether or not the second is used, bottom-
          aligns its content so a short name sits against the ROSTER label
          rather than floating above it, and clamps at two as the ellipsis
          floor. With the 34-char input cap the clamp should never fire; it is
          here so a longer legacy name degrades to the old behaviour instead of
          pushing the panel around.

          UNCONDITIONAL at every width. The hero has no breakpoint and fills a
          content column up to 1280px, where nothing wraps and this leaves a
          quiet dead line. A panel that changes height across breakpoints is a
          thing you notice; 20px of desktop space is not. */}
      <span className="flex w-full items-end" style={{ fontSize: 17, minHeight: "2.4em" }}>
        {/* `break-normal`, was `break-words`.

            `break-words` (overflow-wrap: break-word) breaks INSIDE a word when
            it will not fit, and this row is `justify-between` with two flexible
            children — so a long name on one side squeezes the other, and a
            5-letter name in the leftover 43px came out as "Bank" / "s" across
            two lines. That reads as broken rather than tight, and it fires for
            any name whose longest WORD does not fit the column it is left with.

            A team name is a short label, not prose: it should stay whole and
            take the consequences at its edge. Measured on the pair that produced
            it ("Booty Hunters and Scurvy Hookers" / "Banks", 375px): the short
            side goes from 41px over two lines to 20px on one.

            KNOWN LIMIT, stated rather than hidden: at that extreme the short
            name is clipped by 2px (scrollWidth 45 into a 43px box), because the
            long side takes 254px of the row and this only changes WHERE the
            overflow goes, not that there is any. A 2px shave beats a nonsense
            line break, and the real cause — the flex row handing one side four
            times the width of the other — is a distribution question this PR
            does not open. */}
        <span
          className="line-clamp-2 w-full break-normal"
          style={{ fontWeight: 600, lineHeight: 1.2, color: team.color }}
        >
          {team.name}
        </span>
      </span>
      {onEditTeam && <RosterLabel />}
    </button>
  );
}

/**
 * HeroProjSide — one team's projected "if today holds" block: the projected TOTAL
 * (team-colored, the OUTER element) + a ▲ delta pill on the INNER side (toward center),
 * mirrored on each side. The number is always outermost so it stays aligned with the
 * banked score directly above it — nothing is placed on its outer edge.
 *
 * Per-team pill GATE: the pill shows ONLY when delta > 0. A team the live games add
 * nothing to shows a BARE projected number (which equals its banked number) — the
 * absent pill is the signal that it projects no gain (the matching number is correct,
 * not a bug). The shared `ProjectionPill` carries the ▲ grammar.
 *
 * Projected-win FLAIR: a small cup icon on the INNER side of the pill (toward center:
 * to the right of the pill for the left team, to the left of the pill for the right
 * team), when the projected total crosses the win threshold ("if today holds, they
 * clinch"). Innermost so it never sits on the score's outer edge → the score stays
 * aligned. Threshold comparison ONLY — this is not clinch detection (no terminal state
 * / once-fire / correction-safety); it's a purely presentational icon.
 *
 * Order is [number, pill, cup] with the row REVERSED for the right team, so the number
 * is always outermost (aligned with the banked score above) and the cup is innermost.
 */
function HeroProjSide({
  team,
  projected,
  banked,
  winNumber,
  align,
}: {
  team: LBTeam;
  projected: number;
  banked: number;
  winNumber: number;
  align: "left" | "right";
}) {
  const delta = projected - banked; // ≥ 0 (projections are awarded points)
  const projectsWin = projected >= winNumber;
  const num = (
    <span className="tabular-nums" style={{ fontSize: 30, fontWeight: 800, lineHeight: 1, color: team.color }}>
      {fmtPts(projected)}
    </span>
  );
  // Pill only when the team projects a gain; delta 0 → bare number (no pill).
  const pill = delta > 0 ? <ProjectionPill color={team.color} value={delta} /> : null;
  const cup = projectsWin ? (
    <Trophy size={15} style={{ color: team.color }} aria-label="Projected to win" data-testid={`hero-proj-cup-${align === "left" ? "a" : "b"}`} />
  ) : null;
  // [number, pill, cup] → the row reverses for the right team, keeping the number
  // outermost (aligned) and the cup innermost (toward center, inner side of the pill).
  return (
    <div
      className={`flex items-center gap-2 ${align === "right" ? "flex-row-reverse" : ""}`}
      data-testid={`hero-proj-${align === "left" ? "a" : "b"}`}
    >
      {num}
      {pill}
      {cup}
    </div>
  );
}


