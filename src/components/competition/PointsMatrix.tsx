"use client";

import { useState } from "react";
import { ChevronDown, Table2 } from "lucide-react";
import { fmtPts } from "./GameRow";
import type { LBTeam, LBGame, LBCell } from "./CompetitionLeaderboard";

/**
 * PointsMatrix — the points board's game-by-game detail (PR 2). The proven
 * spreadsheet model: **games are ROWS, teams are COLUMNS, cells are per-game
 * points, the pinned top row is the column totals = standings.** It sits BELOW
 * the standings glance as a collapsible section (NOT a tab) — the glance answers
 * "are we winning?", the matrix is the on-demand audit of where the points came
 * from. Points cups only (a head-to-head's single number needs no matrix).
 *
 * Columns are ordered by total desc so the leader's column is leftmost and the
 * totals row mirrors the glance. The first (Game) column is sticky so the table
 * body scrolls horizontally under it past ~4 teams while staying readable; up to
 * 4 teams fit a phone without scrolling.
 *
 * Pure presentational — all data is the already-computed leaderboard payload
 * (cells + teamTotals), so the matrix can't diverge from the glance.
 */
export function PointsMatrix({
  games,
  teams,
  cellsByGame,
  teamTotals,
}: {
  games: LBGame[];
  teams: LBTeam[];
  cellsByGame: Map<string, Map<string, LBCell>>;
  teamTotals: Record<string, number>;
}) {
  // Calmer default: collapsed. The glance is the hero; the matrix is opt-in audit.
  const [open, setOpen] = useState(false);

  // Columns ordered by total desc → leader leftmost, totals row mirrors the glance.
  const cols = [...teams].sort((a, b) => (teamTotals[b.id] ?? 0) - (teamTotals[a.id] ?? 0));

  return (
    <div
      className="overflow-hidden rounded-xl"
      style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
      data-testid="points-matrix"
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-3"
        data-testid="points-matrix-toggle"
      >
        <Table2 size={14} style={{ color: "var(--color-bt-text-dim)", flexShrink: 0 }} />
        <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
          Game by game
        </span>
        <ChevronDown
          size={16}
          className="ml-auto transition-transform"
          style={{ color: "var(--color-bt-text-dim)", transform: open ? "rotate(180deg)" : undefined }}
        />
      </button>

      {open && (
        <div className="overflow-x-auto" style={{ borderTop: "1px solid var(--color-bt-border)" }}>
          <table className="w-full border-collapse text-sm" data-testid="points-matrix-table">
            <thead>
              <tr>
                <Th sticky>{""}</Th>
                {cols.map((t) => (
                  <Th key={t.id} align="center">
                    <span className="inline-flex items-center gap-1">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: t.color }} />
                      <span className="font-bold uppercase tracking-wider" style={{ color: t.color }}>
                        {t.short_name}
                      </span>
                    </span>
                  </Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* Totals row, pinned at the top — this IS the standings, mirrored. */}
              <tr style={{ background: "var(--color-bt-card-raised)" }}>
                <Td sticky bg="var(--color-bt-card-raised)">
                  <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
                    Total
                  </span>
                </Td>
                {cols.map((t) => (
                  <Td key={t.id} align="center" bg="var(--color-bt-card-raised)">
                    <span className="text-base font-bold tabular-nums" style={{ color: t.color }}>
                      {fmtPts(teamTotals[t.id] ?? 0)}
                    </span>
                  </Td>
                ))}
              </tr>

              {games.length === 0 ? (
                <tr>
                  <Td sticky colSpan={1 + cols.length} bg="var(--color-bt-card)">
                    <span className="text-[12px]" style={{ color: "var(--color-bt-text-dim)" }}>
                      No games yet — points appear here as games are scored.
                    </span>
                  </Td>
                </tr>
              ) : (
                games.map((g, i) => {
                  // Zebra on the data rows (the totals row owns card-raised).
                  const rowBg = i % 2 === 0 ? "var(--color-bt-card)" : "var(--color-bt-card-raised)";
                  const row = cellsByGame.get(g.id);
                  return (
                    <tr key={g.id} style={{ background: rowBg }}>
                      <Td sticky bg={rowBg}>
                        <span className="block max-w-[140px] truncate" style={{ color: "var(--color-bt-text)" }}>
                          {g.name}
                        </span>
                      </Td>
                      {cols.map((t) => {
                        const cell = row?.get(t.id);
                        return (
                          <Td key={t.id} align="center" bg={rowBg}>
                            {cell ? (
                              <span className="tabular-nums" style={{ color: "var(--color-bt-text)" }}>
                                {fmtPts(cell.points)}
                              </span>
                            ) : (
                              <span style={{ color: "var(--color-bt-text-dim)" }}>—</span>
                            )}
                          </Td>
                        );
                      })}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Cell primitives ──────────────────────────────────────────────────────────
// The first column is `sticky left:0` with an explicit background so rows scroll
// horizontally under it (legible past ~4 team columns) without bleed-through.

function Th({
  children,
  align = "left",
  sticky = false,
}: {
  children: React.ReactNode;
  align?: "left" | "center";
  sticky?: boolean;
}) {
  return (
    <th
      className="px-3 py-2 text-[11px]"
      style={{
        textAlign: align,
        minWidth: sticky ? 96 : 52,
        position: sticky ? "sticky" : undefined,
        left: sticky ? 0 : undefined,
        background: sticky ? "var(--color-bt-card)" : undefined,
        zIndex: sticky ? 1 : undefined,
        borderBottom: "1px solid var(--color-bt-border)",
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = "left",
  sticky = false,
  bg,
  colSpan,
}: {
  children: React.ReactNode;
  align?: "left" | "center";
  sticky?: boolean;
  bg?: string;
  colSpan?: number;
}) {
  return (
    <td
      colSpan={colSpan}
      className="px-3 py-2.5"
      style={{
        textAlign: align,
        minWidth: sticky ? 96 : 52,
        position: sticky ? "sticky" : undefined,
        left: sticky ? 0 : undefined,
        background: sticky ? bg : undefined,
        zIndex: sticky ? 1 : undefined,
      }}
    >
      {children}
    </td>
  );
}
