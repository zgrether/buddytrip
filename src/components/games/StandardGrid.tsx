"use client";

import { computeStrokePlayStandings, type StrokeEntry } from "@/lib/strokePlay";
import type { ScoreUnit, Participant, ScoreValues, ScoreDirection } from "./types";

/**
 * StandardGrid — the review / spot-correction scorecard (Slice A, Task 7).
 *
 * Read-only + navigational: tapping a cell calls `onCellTap(unitLabel)` so the
 * parent jumps to that unit's entry view. The grid NEVER edits inline — entry
 * is always the focused per-unit surface.
 *
 * Sections (Out/In) and the section divider come from the units' `section`
 * field (`scorecard_schema.scoring.sections`), not hardcoded at 9/10.
 *
 * Orientation: golf's review sheet is conventionally participants-across /
 * units-across-the-top, which is the default here. `orientation` is a typed
 * prop so non-golf formats (units running down the portrait screen) can flip it
 * later without a rewrite — the flipped layout itself lands when Slice C needs
 * it (GolfCard). Slice A renders `participants-rows` only.
 */
interface StandardGridProps {
  units: ScoreUnit[];
  participants: Participant[];
  values: ScoreValues;
  direction: ScoreDirection;
  onCellTap?: (unitLabel: string) => void;
  orientation?: "participants-rows" | "participants-cols";
}

const NAME_W = 124;
const HOLE_W = 30;
const SUB_W = 44;
const TOTAL_W = 50;

export function StandardGrid({ units, participants, values, onCellTap }: StandardGridProps) {
  const front = units.filter((u) => u.section === "front");
  const back = units.filter((u) => u.section === "back");
  const hasSections = front.length > 0 && back.length > 0;
  const firstBackLabel = back[0]?.label;

  const valOf = (pid: string, l: string) => values[pid]?.[l];
  const sumOf = (pid: string, list: ScoreUnit[]) =>
    list.reduce((a, u) => a + (valOf(pid, u.label) ?? 0), 0);
  const totalOf = (pid: string) => sumOf(pid, units);

  // Leader (low total among participants who have any score).
  const scoredIds = participants
    .filter((p) => Object.keys(values[p.id] ?? {}).length > 0)
    .map((p) => p.id);
  const entries: StrokeEntry[] = [];
  for (const p of participants)
    for (const u of units) {
      const v = valOf(p.id, u.label);
      if (v != null) entries.push({ participant_id: p.id, value: v });
    }
  const standings = computeStrokePlayStandings(scoredIds, entries);
  // ALL position-1 entities, so tied co-leaders each get the leader treatment.
  const leaderIds = new Set(
    scoredIds.length ? standings.filter((s) => s.position === 1).map((s) => s.entityId) : []
  );

  const cellBase: React.CSSProperties = {
    width: HOLE_W,
    minWidth: HOLE_W,
    textAlign: "center",
    flexShrink: 0,
  };
  // Front/back-9 separator on the first back-9 hole — a neutral divider line,
  // NOT a teal tint (teal reads as 'current/leader' elsewhere; a tint here looks
  // like the hole is highlighted).
  const divider = (l?: string): React.CSSProperties =>
    hasSections && l === firstBackLabel
      ? { borderLeft: "1px solid var(--color-bt-border)" }
      : {};

  const nameCell: React.CSSProperties = {
    width: NAME_W,
    minWidth: NAME_W,
    position: "sticky",
    left: 0,
    zIndex: 1,
    flexShrink: 0,
    borderRight: "1px solid var(--color-bt-border)",
    background: "var(--color-bt-card)",
  };

  return (
    <div className="relative h-full" style={{ background: "var(--color-bt-base)" }}>
      <div className="h-full overflow-x-auto">
        <div style={{ minWidth: "max-content" }}>
          {/* Header */}
          <div
            className="flex"
            style={{
              height: 36,
              position: "sticky",
              top: 0,
              zIndex: 2,
              background: "var(--color-bt-card)",
              borderBottom: "1px solid var(--color-bt-border)",
            }}
          >
            <div className="flex items-center" style={{ ...nameCell, padding: "0 10px" }}>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--color-bt-text-dim)" }}>
                Hole
              </span>
            </div>
            {units.map((u) => (
              <div key={u.label} className="flex items-center justify-center" style={{ ...cellBase, ...divider(u.label) }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: "var(--color-bt-text-dim)" }}>{u.label}</span>
              </div>
            ))}
            {/* Out / In subtotals + Total as trailing columns. */}
            {hasSections && <HeaderSub label="Out" />}
            {hasSections && <HeaderSub label="In" />}
            <HeaderSub label="Total" wide />
          </div>

          {/* Rows */}
          {participants.map((p) => {
            const isLeader = leaderIds.has(p.id);
            return (
              <div key={p.id} className="flex" style={{ height: 44, borderBottom: "1px solid var(--color-bt-subtle-border)" }}>
                <div className="flex items-center gap-1.5" style={{ ...nameCell, padding: "0 10px" }}>
                  <span
                    className="flex items-center justify-center"
                    style={{ width: 18, height: 18, borderRadius: "50%", background: `${p.color}22`, color: p.color, fontSize: 8, fontWeight: 700, flexShrink: 0 }}
                  >
                    {p.initials}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 500, color: "var(--color-bt-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {p.name}
                  </span>
                </div>
                {units.map((u) => {
                  const v = valOf(p.id, u.label);
                  return (
                    <button
                      key={u.label}
                      onClick={() => onCellTap?.(u.label)}
                      className="flex items-center justify-center"
                      style={{ ...cellBase, height: 44, ...divider(u.label), fontSize: 13, fontWeight: 500, color: v != null ? "var(--color-bt-text)" : "var(--color-bt-text-dim)" }}
                    >
                      {v ?? "—"}
                    </button>
                  );
                })}
                {hasSections && <SubCell value={sumOf(p.id, front)} />}
                {hasSections && <SubCell value={sumOf(p.id, back)} />}
                <SubCell value={totalOf(p.id)} wide bold leader={isLeader} />
              </div>
            );
          })}
        </div>
      </div>
      {/* Right-edge fade signalling more columns */}
      <div
        className="pointer-events-none absolute right-0 top-0 h-full"
        style={{ width: 24, background: "linear-gradient(to right, transparent, var(--color-bt-base))" }}
      />
    </div>
  );
}

function HeaderSub({ label, wide }: { label: string; wide?: boolean }) {
  return (
    <div
      className="flex items-center justify-center"
      style={{
        width: wide ? TOTAL_W : SUB_W,
        minWidth: wide ? TOTAL_W : SUB_W,
        flexShrink: 0,
        background: wide ? "rgba(45,212,191,0.07)" : "rgba(255,255,255,0.025)",
      }}
    >
      <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--color-bt-text-dim)" }}>
        {label}
      </span>
    </div>
  );
}

function SubCell({ value, wide, bold, leader }: { value: number; wide?: boolean; bold?: boolean; leader?: boolean }) {
  return (
    <div
      className="flex items-center justify-center"
      style={{
        width: wide ? TOTAL_W : SUB_W,
        minWidth: wide ? TOTAL_W : SUB_W,
        height: 44,
        flexShrink: 0,
        background: wide ? "rgba(45,212,191,0.07)" : "rgba(255,255,255,0.025)",
        fontSize: bold ? 14 : 13,
        fontWeight: bold ? 700 : 600,
        color: leader ? "var(--color-bt-place-1-text)" : bold ? "var(--color-bt-text)" : "var(--color-bt-text-dim)",
      }}
    >
      {value}
    </div>
  );
}
