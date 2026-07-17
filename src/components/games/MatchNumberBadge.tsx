"use client";

import { RowNumber } from "@/components/games/RowNumber";

/**
 * MatchNumberBadge — the shared leading cell for every match-scoped row: the match
 * number over a small 1V1/2V2 shape tag. Matches, Point Distribution, and Handicaps
 * all use it so the leading column reads identically across the three (and a mixed
 * game's 1v1-vs-2v2 shapes are legible at a glance on each surface, not just Matches).
 */
export function MatchNumberBadge({
  number,
  playersPerSide,
}: {
  number: number;
  playersPerSide: number;
}) {
  const doubles = playersPerSide === 2;
  return (
    <div className="flex flex-col items-center gap-1">
      <RowNumber number={number} />
      <span
        style={{
          fontSize: 8,
          fontWeight: 800,
          letterSpacing: "0.03em",
          padding: "1px 4px",
          borderRadius: 4,
          color: doubles ? "#c4b5fd" : "#93c5fd",
          background: doubles ? "rgba(167,139,250,0.14)" : "rgba(96,165,250,0.14)",
        }}
      >
        {doubles ? "2V2" : "1V1"}
      </span>
    </div>
  );
}
