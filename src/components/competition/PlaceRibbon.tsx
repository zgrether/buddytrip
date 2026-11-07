"use client";

import { useId } from "react";
import { CLINCH_STORY_WORD as WORD, ordinalShort } from "@/lib/vocabulary";

/**
 * A locked 1st, 2nd or 3rd on the points standings (docs/CLINCH_AND_PODIUM.md §2,
 * v2.10): a prize rosette, a scalloped disc on two tails with the rank engraved
 * in the darker metal. Metal colours, never team colours, so it cannot clash
 * with the team badge beside it. About 24×32, centred in the 26px rank slot.
 */

export type Medal = "gold" | "silver" | "bronze";

export const MEDAL_OF_PLACE: Readonly<Record<1 | 2 | 3, Medal>> = { 1: "gold", 2: "silver", 3: "bronze" };

const metal = (medal: Medal, shade: "light" | "mid" | "deep") => `var(--color-bt-medal-${medal}-${shade})`;

/** The disc's scallops: twelve lobes on a ring, behind the face. */
const LOBES = Array.from({ length: 12 }, (_, i) => {
  const a = (i / 12) * Math.PI * 2;
  return { cx: +(12 + Math.cos(a) * 9.4).toFixed(2), cy: +(11 + Math.sin(a) * 9.4).toFixed(2) };
});

export function PlaceRibbon({ place, testId }: { place: 1 | 2 | 3; testId?: string }) {
  const medal = MEDAL_OF_PLACE[place];
  const face = `place-ribbon-face-${useId().replace(/:/g, "")}`;
  return (
    <svg
      width={24}
      height={32}
      viewBox="0 0 24 32"
      role="img"
      aria-label={WORD.placeLocked(ordinalShort(place))}
      data-testid={testId}
      data-medal={medal}
      style={{ display: "block", flexShrink: 0 }}
    >
      <defs>
        <linearGradient id={face} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={metal(medal, "light")} />
          <stop offset="1" stopColor={metal(medal, "mid")} />
        </linearGradient>
      </defs>
      {/* Two tails, the back one in the deeper metal, each notched at the end. */}
      <path d="M16.5 15 L12 18.5 L14.5 31 L16.6 28.6 L19.5 30.6 Z" fill={metal(medal, "deep")} />
      <path d="M7.5 15 L12 18.5 L9.5 31 L7.4 28.6 L4.5 30.6 Z" fill={metal(medal, "mid")} />
      {/* The scalloped disc, then its face and rim. */}
      <circle cx={12} cy={11} r={9.4} fill={metal(medal, "mid")} />
      {LOBES.map((l, i) => (
        <circle key={i} cx={l.cx} cy={l.cy} r={2.3} fill={metal(medal, "mid")} />
      ))}
      <circle cx={12} cy={11} r={7.6} fill={`url(#${face})`} stroke={metal(medal, "deep")} strokeWidth={0.9} />
      <text
        x={12}
        y={11}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={10}
        fontWeight={800}
        fill={metal(medal, "deep")}
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        {place}
      </text>
    </svg>
  );
}
