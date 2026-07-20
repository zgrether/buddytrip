"use client";

import { PlayerChip } from "@/components/games/PlayerChip";

/**
 * The shared match-participant renderer (Refactor A2a). A match's sides are shown as
 * **stacked per-player avatar chips** — the one `PlayerChip` (team-colored avatar
 * LEFT of the name), one chip for a 1v1 side, two stacked for a 2v2 side. This is
 * the single home for "how a match's players look," reused by:
 *   - the Matches cards (both sides via `MatchSides`),
 *   - the Handicaps section (each selectable side via `SideChips`),
 *   - the Total Points override panel (A2b).
 * It replaces the old compound "R&"-avatar + truncated "Name & …" doubles treatment
 * everywhere — the fix is adoption, not re-solving per surface.
 */

export interface SidePlayer {
  id: string;
  name: string;
  /** The player's team color (roster assignment); null → PlayerChip's neutral fallback. */
  teamColor?: string | null;
}

/** One side's players as a vertical stack of chips (1 for singles, 2 for doubles).
 *  `chipStyle` lets a wrapper strip the chip surface (e.g. the handicap segment owns
 *  its own selection surface and shows the chip through it). */
export function SideChips({
  players,
  chipStyle,
  gap = 6,
  collapse = true,
}: {
  players: SidePlayer[];
  chipStyle?: React.CSSProperties;
  gap?: number;
  /** Forwarded to `PlayerChip` — set `false` in the Handicaps segments, whose
   *  padded/transparent wrapper otherwise drops the avatar to an empty box (b1). */
  collapse?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col" style={{ gap }}>
      {players.map((p) => (
        <PlayerChip key={p.id} name={p.name} teamColor={p.teamColor} style={chipStyle} collapse={collapse} />
      ))}
    </div>
  );
}

/** A full matchup: side A's stacked chips | vs | side B's stacked chips. The card +
 *  override-panel display of a match. Singles → one chip per column; doubles → two.
 *  (Named `MatchupChips` — `MatchSides` is already a draft-pairing type in
 *  `matchDraft.ts`.) */
export function MatchupChips({
  a,
  b,
  className = "",
}: {
  a: SidePlayer[];
  b: SidePlayer[];
  className?: string;
}) {
  return (
    <div className={`flex items-center ${className}`} style={{ gap: 9 }}>
      <div className="min-w-0 flex-1">
        <SideChips players={a} />
      </div>
      <span
        className="flex-shrink-0 self-center"
        style={{ fontSize: 10, fontWeight: 700, color: "var(--color-bt-text-dim)" }}
      >
        vs
      </span>
      <div className="min-w-0 flex-1">
        <SideChips players={b} />
      </div>
    </div>
  );
}
