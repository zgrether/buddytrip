"use client";

import { Equal } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { SideChips, type SidePlayer } from "./MatchSides";
import { ScoreSaveBadge } from "./ScoreSaveBadge";
import type { CellSaveState } from "./types";

/**
 * OutcomeChoiceRow — one outcome choice, a player-row-styled button (avatar-left
 * OR a neutral glyph for "Halved") + label + a trailing check-circle. Selected =
 * team-colored wash + border + filled check (or teal for Halved); the other rows
 * dim once something is picked.
 *
 * Shared by BOTH match-play hole-outcome entries so they can't drift:
 *   - golf `MatchOutcomeEntryView` (per-hole side A / Halved / side B), and
 *   - the non-golf head-to-head control (Team A / Halved / Team B).
 * The golf-only extras (`players` for a 2v2 side, `saveState`/`onRetry` for the
 * per-cell outbox badge) are optional — the non-golf control omits them.
 */
export function OutcomeChoiceRow({
  selected,
  dim,
  color,
  neutral,
  avatarName,
  avatarIcon,
  label,
  players,
  sub,
  onClick,
  testId,
  saveState,
  onRetry,
}: {
  selected: boolean;
  dim: boolean;
  color?: string;
  neutral?: boolean;
  avatarName?: string;
  avatarIcon?: string | null;
  label: string;
  /** A 2v2 side's players — when 2+, the row shows the shared stacked
   *  `SideChips` instead of a single avatar + compound "R & B" label. */
  players?: SidePlayer[];
  sub?: string;
  onClick: () => void;
  testId: string;
  /** In-flight save state for THIS choice's hole, only when it's the selected
   *  one (mirrors PlayerRow's inline `ScoreSaveBadge` — score entry's same
   *  feedback, in the same footprint, so the panel below never reflows). */
  saveState?: CellSaveState;
  onRetry?: () => void;
}) {
  const tint = neutral ? "var(--color-bt-accent)" : color ?? "var(--color-bt-accent)";
  // Only the transient states borrow the badge — once saved, this settles
  // back to the plain team-colored ✓ below (a "saved" badge would lose the
  // team-color meaning the solid check carries).
  const showBadge = saveState === "saving" || saveState === "error";
  // A 2v2 side stacks two chips — pack them tightly (shorter chips, small gap,
  // reduced row padding) so the side is close to stroke/rack row density instead
  // of an oversized block. Avatars stay (this is density only).
  const stacked = !!(players && players.length > 1);
  return (
    // role=button (not <button>) so ScoreSaveBadge's error-state Retry button
    // can nest without invalid button-in-button markup — same pattern as
    // score entry's PlayerRow.
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      className="flex w-full items-center gap-3 text-left transition-opacity"
      data-testid={testId}
      style={{
        padding: stacked ? "8px 14px" : 14,
        borderRadius: 12,
        cursor: "pointer",
        background: selected ? `color-mix(in srgb, ${tint} 14%, transparent)` : "var(--color-bt-card)",
        border: `1.5px solid ${selected ? tint : "var(--color-bt-border)"}`,
        opacity: dim ? 0.5 : 1,
      }}
    >
      {players && players.length > 1 ? (
        // 2v2 → the shared stacked renderer: both players, avatar-left, no
        // compound "R & B". The choice row is the selection surface, so the
        // chips are transparent (they show it through).
        <div className="min-w-0 flex-1">
          <SideChips players={players} chipStyle={{ background: "transparent", border: "none", height: 36, padding: "0 6px" }} gap={2} />
        </div>
      ) : (
        <>
          {neutral ? (
            <span
              className="flex flex-shrink-0 items-center justify-center"
              style={{ width: 30, height: 30, borderRadius: "50%", background: "var(--color-bt-card-raised)", color: "var(--color-bt-text-dim)" }}
            >
              <Equal size={14} />
            </span>
          ) : (
            <Avatar name={avatarName ?? label} avatarIcon={avatarIcon} teamColor={color} sizePx={30} />
          )}
          <div className="min-w-0 flex-1">
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--color-bt-text)" }}>{label}</div>
            {sub && <div style={{ fontSize: 11.5, color: "var(--color-bt-text-dim)", fontWeight: 600 }}>{sub}</div>}
          </div>
        </>
      )}
      {showBadge ? (
        <ScoreSaveBadge state={saveState} onRetry={onRetry} />
      ) : (
        <span
          className="flex flex-shrink-0 items-center justify-center"
          style={{
            width: 22,
            height: 22,
            borderRadius: "50%",
            border: `2px solid ${selected ? tint : "var(--color-bt-border)"}`,
            background: selected ? tint : "transparent",
            color: selected ? "var(--color-bt-on-accent)" : "transparent",
            fontSize: 12,
            fontWeight: 800,
          }}
        >
          ✓
        </span>
      )}
    </div>
  );
}
