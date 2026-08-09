"use client";

/**
 * ── The trophy SLOT ─────────────────────────────────────────────────────────
 *
 * The hero's centrepiece, extracted from `CompetitionHero` so it is a single
 * component behind a stable contract rather than a path woven through the
 * celebration. Custom artwork is expected to replace it; swapping is a one-line
 * change at the call site:
 *
 *     <CompetitionHero trophy={MyNewArtwork} />
 *
 * Nothing in the animation touches the geometry. `ClinchCelebration` positions,
 * animates and lights the SLOT; the slot decides only what shape appears and how
 * it takes a tint. A replacement need only honour `TrophySlotProps`.
 */

export interface TrophySlotProps {
  /**
   * 0.17 at rest (the long-standing watermark) → ~1 when lit for a finished
   * cup. The consumer picks the value; the slot just applies it, so a
   * replacement doesn't have to know why.
   */
  opacity: number;
  /**
   * The winning team's colour, or null for the default gold. A slot is free to
   * ignore this (a mono artwork legitimately might) — the celebration's radial
   * wash carries the team colour regardless, so nothing breaks if it does.
   */
  tint: string | null;
}

/** Any component that can occupy the hero's centre. */
export type TrophySlot = React.ComponentType<TrophySlotProps>;

/**
 * The dimensional gold trophy — verbatim geometry from the approved
 * `hero_trophy_reference.html` (viewBox 0 0 300 380). Open modeled mouth,
 * gradient-lit round body, slim knopped pedestal, engraved star. Raw hex is the
 * sanctioned hero art (STYLE_GUIDE's hero-gradient carve-out, the same
 * exception `teamGlow` already uses). IDs are prefixed to avoid `<defs>` clashes.
 *
 * **Tinting mixes into the existing gradient stops rather than overlaying the
 * shape.** An overlay would need either a duplicate copy of every path or a
 * `mix-blend-mode` layer — and a blend layer over a transparent box tints the
 * hero card behind it, not the trophy. Mixing at the stops keeps the modeling
 * (the light-to-shadow ramp that makes it read as round) and simply moves its
 * hue toward the winner, which is what "lit in the winner's colour" means.
 * `color-mix` is already in use in this hero for the team glow.
 */
export function CupTrophy({ opacity, tint }: TrophySlotProps) {
  // Gold stays the dominant note even when tinted — a trophy that becomes a
  // flat team-coloured silhouette stops reading as metal. The mix is weighted
  // so the winner's colour is unmistakable but the modeling survives.
  const mix = (gold: string, pct: number) =>
    tint ? `color-mix(in srgb, ${tint} ${pct}%, ${gold})` : gold;

  return (
    <svg
      width="300"
      viewBox="0 0 300 380"
      aria-hidden="true"
      style={{ pointerEvents: "none", display: "block" }}
    >
      <defs>
        <linearGradient id="btHeroBowl" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={mix("#f6e0a0", 26)} />
          <stop offset="0.42" stopColor={mix("#d9b350", 38)} />
          <stop offset="1" stopColor={mix("#8a6a24", 30)} />
        </linearGradient>
        <linearGradient id="btHeroBase" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={mix("#ecd282", 26)} />
          <stop offset="1" stopColor={mix("#87682a", 30)} />
        </linearGradient>
      </defs>
      <g opacity={opacity}>
        {/* base (two tiers) + knop + narrow tall pedestal */}
        <rect x="96" y="320" width="108" height="24" rx="6" fill="url(#btHeroBase)" />
        <rect x="120" y="305" width="60" height="15" rx="4" fill="url(#btHeroBase)" />
        <ellipse cx="150" cy="298" rx="19" ry="8" fill="url(#btHeroBase)" />
        <rect x="142" y="258" width="16" height="42" fill="url(#btHeroBase)" />
        {/* slim handles (lit left / shadow right) */}
        <path d="M60,104 Q24,114 32,166 Q38,204 82,198" fill="none" stroke={mix("#cfa94e", 32)} strokeWidth="13" strokeLinecap="round" />
        <path d="M240,104 Q276,114 268,166 Q262,204 218,198" fill="none" stroke={mix("#a5822f", 32)} strokeWidth="13" strokeLinecap="round" />
        {/* bowl body: left->right gradient = round modeling */}
        <path d="M58,88 Q58,228 150,260 Q242,228 242,88 Z" fill="url(#btHeroBowl)" />
        {/* soft highlight on the lit side */}
        <ellipse cx="106" cy="152" rx="11" ry="52" fill="#fff0bf" opacity="0.5" />
        {/* engraved 5-point star (darker gold = recessed) */}
        <path
          d="M150,132 L157.6,151.5 L178.5,152.7 L162.4,166 L167.6,186.3 L150,175 L132.4,186.3 L137.6,166 L121.5,152.7 L142.4,151.5 Z"
          fill={mix("#57411a", 30)}
        />
        {/* open mouth: light rim ellipse + dark inner hollow + faint far-wall shadow */}
        <ellipse cx="150" cy="86" rx="92" ry="19" fill="url(#btHeroBowl)" />
        <ellipse cx="150" cy="85" rx="75" ry="13" fill={mix("#4a3915", 26)} />
        <ellipse cx="133" cy="82" rx="38" ry="6" fill={mix("#6b5320", 26)} opacity="0.7" />
      </g>
    </svg>
  );
}
