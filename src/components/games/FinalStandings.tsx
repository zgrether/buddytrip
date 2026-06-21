"use client";

import { Trophy } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import type { Participant } from "./types";

/**
 * FinalStandings — the game-over screen (Slice A, Task 7, State 7). Read-only.
 *
 * Renders persisted `game_results` (position-sorted, ties as a shared rank —
 * T2/T2/4th). Place colors from the `--color-bt-place-{1..4}-*` tokens. "strokes"
 * as the value label (no par / vs-par — that's Slice C).
 */
interface Result {
  entityId: string;
  rawScore: number;
  position: number;
}

interface FinalStandingsProps {
  participants: Participant[];
  standings: Result[];
  unitCount: number;
  dateLabel: string;
  onScorecard: () => void;
  onPlayAgain: () => void;
  /** Optional — Quick Game shows a Discard (clears the stored game). */
  onDiscard?: () => void;
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

export function FinalStandings({
  participants,
  standings,
  unitCount,
  dateLabel,
  onScorecard,
  onPlayAgain,
  onDiscard,
}: FinalStandingsProps) {
  const byId = new Map(participants.map((p) => [p.id, p]));
  const sorted = [...standings].sort((a, b) => a.position - b.position);
  const tiedPositions = new Set(
    sorted.map((s) => s.position).filter((pos, i, arr) => arr.indexOf(pos) !== arr.lastIndexOf(pos))
  );

  return (
    <div className="flex h-full flex-col" style={{ background: "var(--color-bt-base)" }}>
      {/* Trophy header */}
      <header
        className="flex shrink-0 items-center gap-3"
        style={{ padding: "16px", background: "var(--color-bt-card)", borderBottom: "1px solid var(--color-bt-border)" }}
      >
        <span
          className="flex items-center justify-center"
          style={{ width: 44, height: 44, borderRadius: 12, background: "var(--color-bt-accent-faint)", border: "1px solid var(--color-bt-accent-border)", color: "var(--color-bt-accent)" }}
        >
          <Trophy size={22} />
        </span>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--color-bt-text)" }}>Game over</div>
          <div style={{ fontSize: 12, color: "var(--color-bt-text-dim)" }}>
            {unitCount} holes · {dateLabel}
          </div>
        </div>
      </header>

      {/* Standings */}
      <div className="flex-1 overflow-y-auto" style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
        {sorted.map((r) => {
          const p = byId.get(r.entityId);
          const place = Math.min(Math.max(r.position, 1), 4);
          const tied = tiedPositions.has(r.position);
          const first = r.position === 1;
          return (
            <div
              key={r.entityId}
              className="flex items-center gap-3"
              style={{
                borderRadius: 12,
                padding: "12px 14px",
                background: `var(--color-bt-place-${place}-bg)`,
              }}
            >
              <div style={{ width: 30, fontSize: first ? 17 : 14, fontWeight: 700, color: `var(--color-bt-place-${place}-text)` }}>
                {tied ? `T${r.position}` : ordinal(r.position)}
              </div>
              <Avatar name={p?.name ?? ""} teamColor={p?.color ?? "#888"} variant="chip" sizePx={38} />
              <div className="min-w-0 flex-1">
                <div style={{ fontSize: first ? 16 : 15, fontWeight: first ? 700 : 500, color: "var(--color-bt-text)" }}>
                  {p?.name ?? "Player"}
                </div>
                {tied && (
                  <div style={{ fontSize: 10, color: `var(--color-bt-place-${place}-text)` }}>
                    Tied for {ordinal(r.position)}
                  </div>
                )}
              </div>
              <div className="text-right">
                <div style={{ fontSize: first ? 26 : 20, fontWeight: 700, color: "var(--color-bt-text)" }}>{r.rawScore}</div>
                <div style={{ fontSize: 10, color: "var(--color-bt-text-dim)" }}>strokes</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Actions */}
      <div className="shrink-0" style={{ padding: "12px 16px 28px", borderTop: "1px solid var(--color-bt-border)" }}>
        <div className="flex gap-2.5">
          <button
            onClick={onScorecard}
            className="flex-1"
            style={{ height: 48, borderRadius: 12, background: "var(--color-bt-card-raised)", border: "1px solid var(--color-bt-border)", color: "var(--color-bt-text)", fontSize: 14, fontWeight: 500 }}
          >
            Scorecard
          </button>
          <button
            onClick={onPlayAgain}
            className="flex-1"
            style={{ height: 48, borderRadius: 12, background: "var(--color-bt-accent)", color: "#0d1f1a", fontSize: 14, fontWeight: 600 }}
          >
            Play Again
          </button>
        </div>
        {onDiscard && (
          <button
            onClick={onDiscard}
            className="mt-2.5 w-full"
            style={{ height: 40, borderRadius: 12, background: "transparent", border: "1px solid var(--color-bt-border)", color: "var(--color-bt-text-dim)", fontSize: 13 }}
          >
            Discard game
          </button>
        )}
      </div>
    </div>
  );
}
