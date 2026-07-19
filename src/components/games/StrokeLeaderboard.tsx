"use client";

import { Avatar } from "@/components/Avatar";
import { fmtToPar } from "@/lib/rackNStack";
import { ordinalShort } from "@/components/competition/CompetitionGamesPanel";
import type { StrokeLeaderboardRow } from "@/lib/strokePlay";
import type { Participant } from "@/components/games/types";

/**
 * Stroke game SURFACE leaderboard — a traditional golf board: avatar · player · thru ·
 * strokes · to-par, ranked by to-par (best first). The WHOLE field (every grouping), fed
 * `computeStrokeLeaderboard` rows so a player thru 9 and a player thru 0 read coherently
 * (the late arrival shows "thru 0 · —" at the bottom, never mis-ranked to the top —
 * acceptance-scenario gate D). Presentation-only: rows + participant lookup via props, no
 * tRPC/DB. Reuses the shared `Avatar`; to-par via the shared `fmtToPar`.
 */
export function StrokeLeaderboard({
  rows,
  participants,
}: {
  rows: StrokeLeaderboardRow[];
  participants: Participant[];
}) {
  const pById = new Map(participants.map((p) => [p.id, p]));
  const anyStarted = rows.some((r) => r.started);

  return (
    <div style={{ padding: "12px 12px 4px" }} data-testid="stroke-leaderboard">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
          Leaderboard
        </span>
        {anyStarted && (
          <div className="flex items-center gap-4">
            <span className="w-10 text-right text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>Thru</span>
            <span className="w-10 text-right text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>Strk</span>
            <span className="w-12 text-right text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>To par</span>
          </div>
        )}
      </div>

      {!anyStarted ? (
        <div
          className="rounded-xl border px-4 py-6 text-center"
          style={{ background: "var(--color-bt-card)", borderColor: "var(--color-bt-border)" }}
          data-testid="stroke-leaderboard-empty"
        >
          <p className="text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>No scores yet</p>
          <p className="mt-1 text-[12px]" style={{ color: "var(--color-bt-text-dim)" }}>
            Tap a group below to start scoring — the board fills in as scores land.
          </p>
        </div>
      ) : (
        <div className="flex flex-col">
          {rows.map((r, i) => {
            const p = pById.get(r.entityId);
            const isFirst = i === 0;
            return (
              <div
                key={r.entityId}
                className="@container flex items-center gap-3"
                style={{
                  paddingTop: isFirst ? 0 : 8,
                  paddingBottom: 8,
                  borderTop: isFirst ? undefined : "1px solid var(--color-bt-subtle-border)",
                  opacity: r.started ? 1 : 0.6, // not-started reads as pending
                }}
                data-testid={`stroke-lb-row-${r.entityId}`}
              >
                <span className="w-6 flex-shrink-0 text-center text-sm font-bold tabular-nums" style={{ color: "var(--color-bt-text-dim)" }}>
                  {r.started ? ordinalShort(r.position) : "—"}
                </span>
                <Avatar name={p?.name ?? "Player"} avatarIcon={p?.avatarIcon ?? null} teamColor={p?.color ?? null} sizePx={30} collapse collapseAt="dense" />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>
                  {p?.name ?? "Player"}
                </span>
                <span className="w-10 text-right text-[13px] tabular-nums" style={{ color: "var(--color-bt-text-dim)" }}>
                  {r.holesPlayed}
                </span>
                <span className="w-10 text-right text-[13px] tabular-nums" style={{ color: "var(--color-bt-text)" }}>
                  {r.started ? r.totalStrokes : "—"}
                </span>
                <span
                  className="w-12 text-right text-sm font-bold tabular-nums"
                  style={{ color: r.started ? (r.toPar < 0 ? "var(--color-bt-accent)" : "var(--color-bt-text)") : "var(--color-bt-text-dim)" }}
                >
                  {r.started ? fmtToPar(r.toPar) : "—"}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
