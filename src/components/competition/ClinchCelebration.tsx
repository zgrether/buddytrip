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
  celebrate,
  replayNonce = 0,
  onCelebrated,
  trophy: Trophy = CupTrophy,
}: {
  /** Decided AND finished (`isCupComplete`). False → the resting watermark. */
  cupComplete: boolean;
  /** The winning team's colour — tints the trophy and the wash. */
  winnerColor: string | null;
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
          top: "50%",
          /**
           * -32%, was -46%. MOVE THE ART, NOT THE TEXT.
           *
           * The two-line name reserve grew the block above this, and Bill — the
           * engraved golfer, the one recognisable thing in the watermark — ended
           * up behind it. Measured at 375px with a name at the cap: Bill spans
           * y 193-275 while the name block is 191-245, so 52 of his 81px sat
           * under the text, head and torso included.
           *
           * The names are the content (STYLE_GUIDE, subject slots) and the
           * reserve is deliberate, so the cup moves instead. -32% puts Bill's
           * top at 246 against a name block ending at 245 — clear by a measured
           * pixel rather than by eye, which is the property worth pinning for a
           * fix whose entire point is "not covered".
           *
           * The cost is the pedestal and base: the trophy already overflowed the
           * card by 84px at the bottom and now does by 137, so what shows is the
           * bowl and handles. Acceptable for a 0.17-opacity watermark, and the
           * bowl is the part Bill is engraved on.
           *
           * STABLE ACROSS NAME LENGTHS. The reserve is unconditional, so the
           * block is 54px tall for a short name and a long one alike — this
           * offset does not need to track content. The burst below is nested in
           * this box, so it follows without a second number to keep in step.
           */
          transform: "translate(-50%,-32%)",
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
