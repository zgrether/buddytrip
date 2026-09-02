"use client";

import { useEffect, useState } from "react";
import { CupTrophy, type TrophySlot } from "./CupTrophy";

/**
 * ClinchCelebration — the hero's centre, in all three of its states.
 *
 * ONE component owns the trophy's placement so the resting watermark and the
 * lit celebration can't drift apart in position or size. What changes between
 * states is opacity, tint, a colour wash, and (once) a spark burst — never the
 * geometry, which belongs to the swappable slot.
 *
 *   RESTING      cupComplete false → the 0.17 gold watermark, exactly as before.
 *   CELEBRATING  first view of a finished, decided cup → lit trophy in the
 *                winner's colour, a radial wash of that colour, one spark burst.
 *   STILL        every view after → identical to CELEBRATING minus the burst,
 *                and with no entry animation. The dignified final state.
 *
 * ── Reduced motion ─────────────────────────────────────────────────────────
 * The still state is the celebration with the motion removed, so honouring
 * `prefers-reduced-motion` costs nothing structurally: the CSS drops every
 * animation to `none` and hides the sparks outright (a frozen burst is a ring of
 * dots stuck over the score). The lit trophy and the wash — the parts that carry
 * the meaning — are static in the first place and survive untouched.
 */

/** Fourteen sparks, spec'd. Fixed angles rather than random: the burst must look
 *  identical every time it plays, and a random ring can clump. The two radii
 *  alternate so it reads as a burst rather than a dial face. */
const SPARK_COUNT = 14;
const SPARKS = Array.from({ length: SPARK_COUNT }, (_, i) => {
  // Offset the ring so no spark fires straight down the vertical axis, where it
  // would track along the pedestal and read as a glitch rather than a spark.
  const angle = (i / SPARK_COUNT) * Math.PI * 2 + Math.PI / SPARK_COUNT;
  const radius = i % 2 === 0 ? 132 : 96;
  return {
    dx: Math.round(Math.cos(angle) * radius),
    dy: Math.round(Math.sin(angle) * radius),
    // Stagger so the ring doesn't leave as one solid wall.
    delay: (i % 5) * 0.045,
    size: i % 3 === 0 ? 7 : 5,
  };
});

export function ClinchCelebration({
  cupComplete,
  winnerColor,
  winnerSide = null,
  celebrate,
  replayNonce = 0,
  onCelebrated,
  trophy: Trophy = CupTrophy,
}: {
  /** Decided AND finished (`isCupComplete`). False → the resting watermark. */
  cupComplete: boolean;
  /** The winning team's colour — tints the trophy and the wash. */
  winnerColor: string | null;
  /**
   * Which SIDE won — the cup tips their way once the result is final.
   *
   * A direction, not a decoration: the trophy leaning toward a team is the
   * card saying it has been AWARDED to them, which the tint alone does not.
   * Two teams can be close in hue and nothing about a colour says "the
   * right-hand one".
   *
   * Null until there is a winner, and only acted on with `cupComplete` — a
   * clinch that is not yet finished has not been awarded.
   */
  winnerSide?: "A" | "B" | null;
  /** First view: play the burst. False → the still state, no burst, no replay. */
  celebrate: boolean;
  /**
   * Manual re-fire, from the winning team's "set off the fireworks" button.
   * A COUNTER, not a boolean: the whole point is repeatability, and a boolean
   * would need a reset edge between presses (press → true → must go false
   * before the next press registers), which is exactly the kind of state that
   * ends up stuck. Every increment is a new burst; 0 means never pressed.
   *
   * Deliberately separate from `celebrate` and from the seen-flag: the flag
   * records the one AUTOMATIC showing, and manual replays neither consume it
   * nor are limited by it.
   */
  replayNonce?: number;
  /** Called once when the burst has been rendered, so the caller can record
   *  that this device has now seen it. Fires on mount of the celebrating
   *  render — not on the still one — so nothing is marked seen unseen. */
  onCelebrated?: () => void;
  /** The swappable centrepiece. Defaults to the gold cup; pass a replacement to
   *  change the artwork without touching any of the animation above. */
  trophy?: TrophySlot;
}) {
  /**
   * ── Why the burst is LATCHED and not driven by the prop ────────────────────
   *
   * Marking the showing seen is what makes `celebrate` go false — the parent's
   * `isFirstView` flips the instant `onCelebrated` runs. Rendering the sparks
   * directly from the prop therefore unmounted them on the very next commit:
   * the burst appeared for a single frame and vanished, ~1.4s short of its own
   * animation. (Caught by counting `.cup-spark` nodes in the browser; the
   * server-rendered tests hold the prop fixed and cannot see it.)
   *
   * So the prop is an EDGE — "start now" — and this state is the duration. Once
   * started the burst owns its own lifetime and finishes regardless of what the
   * flag does underneath it.
   */
  const [bursting, setBursting] = useState(false);

  useEffect(() => {
    if (!celebrate) return;
    setBursting(true);
    // Record the showing immediately, not when the burst ends: a viewer who
    // navigates away mid-animation has still seen it, and a flag written only
    // on completion would replay in full next time.
    onCelebrated?.();
    // Drop the spark nodes once the longest particle has finished (1.5s + the
    // 0.18s max stagger, rounded up). They are `both`-filled at opacity 0 by
    // then, so this is cleanup rather than anything visible.
    const t = setTimeout(() => setBursting(false), 1800);
    return () => clearTimeout(t);
    // `onCelebrated` is deliberately out of the deps — its identity churns with
    // the parent's render, and re-running this would restart the burst on every
    // re-render. `celebrate` is the only real trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [celebrate]);

  // Manual re-fire. Same latch, its own trigger, and NO `onCelebrated` — a
  // replay is not the first view and must not touch the seen-flag.
  //
  // Keyed on the nonce so React remounts the spark nodes on every press: CSS
  // animations don't restart when an already-animating element is merely
  // re-rendered, so pressing the button twice inside 1.8s would otherwise do
  // nothing the second time. The `key` on the spark container below is what
  // makes each press a genuinely new set of elements.
  useEffect(() => {
    if (replayNonce <= 0) return;
    setBursting(true);
    const t = setTimeout(() => setBursting(false), 1800);
    return () => clearTimeout(t);
  }, [replayNonce]);

  const lit = cupComplete;
  // The prop starts it; the latch sustains it. Either one alone is a bug: the
  // prop alone truncates (above), the latch alone would replay after a remount.
  const showBurst = lit && (celebrate || bursting);

  return (
    <>
      {/* The wash. Resting: the long-standing warm gold. Complete: the winner's
          colour, wider and stronger, as a RADIAL gradient — a flat fill would
          read as a coloured card rather than a lit one. */}
      <div
        aria-hidden
        className={showBurst ? "cup-glow-in" : undefined}
        style={{
          position: "absolute",
          inset: 0,
          background:
            lit && winnerColor
              ? `radial-gradient(ellipse 74% 96% at 50% 46%, color-mix(in srgb, ${winnerColor} 24%, transparent), transparent 70%)`
              : "radial-gradient(ellipse 52% 82% at 50% 50%, rgba(216,180,82,0.14), transparent 64%)",
          pointerEvents: "none",
        }}
        data-testid={lit ? "clinch-glow" : undefined}
      />

      {/* The trophy, positioned here so resting and lit share one placement. */}
      <div
        aria-hidden
        className={showBurst ? "cup-trophy-rise" : undefined}
        style={{
          position: "absolute",
          left: "50%",
          /**
           * ── ANCHORED TO THE CARD'S TOP EDGE, NOT ITS CENTRE ──────────────
           *
           * `top: 0` with a pull of 14% of the ARTWORK's own height (0.14 × 380
           * ≈ 53px), replacing `top: 50%` + `translateY(-46%)`.
           *
           * Centre-anchoring made the composition a function of card height.
           * The hero grows when the projected row appears, and
           * `0.5H − 0.46 × 380` moves the whole trophy DOWN ~30px on the taller
           * card — so the same artwork framed itself two different ways and the
           * base came into view only on one of them. That is what read as "the
           * trophy displays two different ways": one drawing, two compositions.
           *
           * Anchored to the top, the framing is IDENTICAL at every card height
           * and growth simply reveals more at the bottom. That is a CROP — a
           * property of the container — rather than a second layout to keep in
           * sync with the first.
           *
           * IT IS ALSO WHAT MAKES THE BILL FIX SOUND. `BILL_NUDGE_BELOW_NAMES`
           * clears the first name line by a measured pixel, and under
           * centre-anchoring that clearance varied by ~30px between the two card
           * shapes — it was tuned on the short card, which happens to be the
           * tighter one, so it held by luck of direction. Now the names sit at a
           * fixed offset from the card top and so does the trophy, so the
           * clearance is a constant.
           *
           * The value preserves today's framing on the short card exactly
           * (0.5 × 243 − 174.8 = −53.2, measured −53), so nothing moves on the
           * card people have been looking at.
           *
           * DO NOT move this to get the golfer out from behind a name — that
           * was tried (#1237) and reverted: it dragged the pedestal and base off
           * the card and let the bowl fill it, turning a quiet watermark into
           * the loudest thing on screen. Bill's own offset inside the SVG is the
           * lever for that; see `BILL_Y`.
           */
          top: 0,
          /**
           * ── THE AWARDED TILT ────────────────────────────────────────────
           *
           * Once the cup is finished and decided, the trophy LEANS toward the
           * winning side and stays there. It is the card saying the thing has
           * been handed over — a state, not an animation, so it holds for every
           * later view rather than playing once like the burst.
           *
           * Sign: `A` is the left team, so it tips left (negative). Reading the
           * side rather than the colour is deliberate — see `winnerSide`.
           *
           * PIVOTS AT THE FOOT, not the centre (`transform-origin` below). A
           * trophy tilts on the thing it stands on; rotating about the middle
           * swings the base out the other way and reads as the whole object
           * sliding rather than leaning. The foot is also the part most likely
           * to be cropped, so the movement is concentrated where nothing is
           * being protected — the bowl travels, the base barely does.
           *
           * 12°, in the middle of the 10–15 asked for: enough to read as
           * deliberate at 0.17 opacity behind two big numbers, short of the
           * angle where the rim ellipse starts to look wrong for its own
           * horizon.
           *
           * The transition means a cup that finishes while you are looking at
           * it tips rather than jumps. `cup-trophy-rise` (the burst's entry)
           * animates the same element, so the tilt is composed into the same
           * transform rather than fighting it.
           */
          transformOrigin: "50% 92%",
          /**
           * The angle rides a CSS VARIABLE rather than being written straight
           * into `transform`, because `cupTrophyRise` replaces the whole
           * transform for the duration of the burst — a literal here would be
           * dropped for those 0.72s and reappear after, which is exactly the
           * kind of one-frame-only defect that never shows up in a static test.
           * The keyframes read the same variable, so the lean survives the
           * animation and there is one value to keep in step instead of two.
           */
          ["--cup-tilt" as string]:
            cupComplete && winnerSide ? `${winnerSide === "A" ? -12 : 12}deg` : "0deg",
          transform: "translate(-50%,-14%) rotate(var(--cup-tilt, 0deg))",
          transition: "transform 700ms cubic-bezier(0.22, 1, 0.36, 1)",
          pointerEvents: "none",
        }}
        data-testid="hero-trophy"
      >
        {/* 0.17 → 0.42, not → 1. "Lit and brought forward" is a step up from a
            watermark, not an opaque object: at 0.9 the cup became the subject and
            the two scores read as decoration on top of it — the winning team's
            NAME was unreadable where it crossed the bowl. 0.42 is the point where
            the trophy is unmistakably present and the scoreline still wins the
            eye, which is the right order for a screen whose job is announcing a
            result. (Measured by eye at 375px; see the PR's device note.) */}
        <Trophy opacity={lit ? 0.42 : 0.17} tint={lit ? winnerColor : null} />

        {/* The burst, anchored to the trophy's centre so the sparks read as
            coming off the cup rather than off the card.

            `key={replayNonce}` is what makes a SECOND press work. A CSS
            animation does not restart because its element re-rendered — the
            element has to be new. Keying on the nonce throws the old spark
            nodes away and mounts a fresh set per press; without it, pressing
            twice inside the 1.8s window is a no-op the second time. */}
        {showBurst && (
          <div
            key={replayNonce}
            style={{
              position: "absolute",
              left: "50%",
              top: "46%",
              width: 0,
              height: 0,
              pointerEvents: "none",
            }}
            data-testid="clinch-sparks"
          >
            {SPARKS.map((s, i) => (
              <span
                key={i}
                className="cup-spark"
                style={
                  {
                    position: "absolute",
                    width: s.size,
                    height: s.size,
                    marginLeft: -s.size / 2,
                    marginTop: -s.size / 2,
                    borderRadius: "50%",
                    // The winner's colour, lifted toward white so it stays
                    // legible against a hero already washed in that same colour.
                    background: winnerColor
                      ? `color-mix(in srgb, ${winnerColor} 55%, #ffffff)`
                      : "#f6e0a0",
                    animationDelay: `${s.delay}s`,
                    "--dx": `${s.dx}px`,
                    "--dy": `${s.dy}px`,
                  } as React.CSSProperties
                }
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
