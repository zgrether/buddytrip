"use client";

import { fmtPts } from "@/components/competition/GameRow";

/**
 * PointsAtStake — what this game (or this match / this slot) is worth, on the
 * GAME surface.
 *
 * ── Why it exists ────────────────────────────────────────────────────────────
 * The leaderboard has always shown a game's value; the game surface never did.
 * So the person actually playing — the one deciding whether this match matters —
 * couldn't see what was at stake, which is arguably the most useful number on
 * the screen. Non-golf showed nothing at all; match play and rack computed their
 * per-match / per-slot values for PROJECTION and then never rendered them.
 *
 * ── One component, three surfaces ────────────────────────────────────────────
 * Shared so the wording and the formatting can't drift between formats, and so
 * the number agrees with the board: `fmtPts` is the SAME formatter
 * `GameRow`/`CompetitionHero` use, which is what keeps "12 PTS" here identical to
 * "12 PTS" there — including the ½ case, where a private formatter would round
 * differently and look like a scoring bug.
 *
 * `unit` names the granularity, because the three are genuinely different
 * quantities and a bare number would be ambiguous:
 *   non-golf → the whole game's value
 *   match    → what ONE match is worth (its override, else the even share)
 *   rack     → what ONE slot is worth
 *
 * NOTE the rack label: `per_match` is the load-bearing code field and rack
 * DISPLAYS it as slots. Label only — never rename the field.
 */
export function PointsAtStake({
  value,
  unit,
  className = "",
}: {
  /** Points. Rendered through the board's formatter, never hand-formatted. */
  value: number;
  /** "per match" / "per slot" / omitted for a whole-game total. */
  unit?: string;
  className?: string;
}) {
  // Nothing to say when a game carries no value — an unconfigured game reads as
  // blank rather than "0 PTS", matching the board's `—` for the same state.
  if (!Number.isFinite(value) || value <= 0) return null;
  return (
    <span
      className={`inline-flex items-baseline gap-1 text-[12px] font-semibold tabular-nums ${className}`}
      style={{ color: "var(--color-bt-text-dim)" }}
      data-testid="points-at-stake"
    >
      <span style={{ color: "var(--color-bt-text)" }}>{fmtPts(value)}</span>
      <span className="text-[10px] font-medium uppercase tracking-wide">
        {unit ? `PTS ${unit}` : "PTS"}
      </span>
    </span>
  );
}
