"use client";

import { buildDecidedFromOutcomes, matchState, type DecidedHole, type HoleOutcomeRow } from "@/lib/matchPlay";
import { holeWeight, isGloriousHole, NO_GLORIOUS, type GloriousConfig } from "@/lib/gloriousHoles";
import { ScorecardChrome, RightGutter, SUB_W, TOTAL_W } from "./StandardGrid";
import type { SidePlayer } from "./MatchSides";
import type { TeeRow } from "@/lib/teeRows";
import type { Participant, ScoreUnit } from "./types";

/**
 * OutcomeScorecard — the hole-outcome-entry scorecard (Refactor B2, built to
 * `outcome_scorecard_mockup.html`; header parity added as a follow-up — "look
 * just like the normal scorecard, only the player rows differ"). Renders the
 * SAME `ScorecardChrome` `StandardGrid` uses (tee selector, yardage/par/
 * stroke-index rows, sticky name column, Out/In/Total columns, Glorious
 * bracket, right-edge fade) around two team-colored LEAD rows instead of
 * gross-score rows — there are no scores in outcome mode. The running lead
 * lives in the LEADER's row (`N▲`, team-colored); a tied hole shows neutral
 * `AS`; a Glorious hole's double-jump is directly visible in the number;
 * closeout dims the unplayed remainder. Same W/L/H color vocabulary
 * `MatchCard`'s history strip uses (win/lose/halve), reused here for the
 * per-hole win-green treatment.
 */

const WIN_GREEN = "#22c55e"; // = --color-bt-place-1 base; matches MatchCard's neutral "winning" color

interface LeadCell {
  hole: number;
  /** Signed running lead as of this hole (+A, −B), or null when not yet played. */
  lead: number | null;
  /** Past the freeze boundary of a decided match — never played. */
  dead: boolean;
  glorious: boolean;
}

/** Pure — the per-hole running lead track + the final match state. Exported for
 *  unit testing apart from render. */
export function computeLeadTrack(
  decided: DecidedHole[],
  holeCount: number,
  glorious: GloriousConfig
): { track: LeadCell[]; st: ReturnType<typeof matchState> } {
  const st = matchState(decided, holeCount, glorious);
  const byHole = new Map(decided.map((d) => [d.hole, d.result]));
  let diff = 0;
  const track: LeadCell[] = [];
  for (let h = 1; h <= holeCount; h++) {
    const glor = isGloriousHole(h, glorious);
    if (st.closed && h > st.thru) {
      track.push({ hole: h, lead: null, dead: true, glorious: glor });
      continue;
    }
    const result = byHole.get(h);
    if (result == null) {
      track.push({ hole: h, lead: null, dead: false, glorious: glor }); // not yet played
      continue;
    }
    const w = holeWeight(h, glorious);
    if (result === "W") diff += w;
    else if (result === "L") diff -= w;
    // "H" (halved) carries the lead forward unchanged — still shown, not blank.
    track.push({ hole: h, lead: diff, dead: false, glorious: glor });
  }
  return { track, st };
}

/** Signed swing (±weighted W/L; halves are 0) over holes [from,to] (1-indexed,
 *  inclusive) — the match-play equivalent of a gross-score section sum, so the
 *  Out/In/Total columns carry real meaning for a lead row the same way they do
 *  for a stroke row (Out = how the front 9 went, In = how the back 9 went,
 *  Total = the two combined = the final lead). Exported for unit testing. */
export function sectionSwing(decided: DecidedHole[], glorious: GloriousConfig, from: number, to: number): number {
  const byHole = new Map(decided.map((d) => [d.hole, d.result]));
  let diff = 0;
  for (let h = from; h <= to; h++) {
    const result = byHole.get(h);
    if (result == null) continue;
    const w = holeWeight(h, glorious);
    diff += result === "W" ? w : result === "L" ? -w : 0;
  }
  return diff;
}

export interface OutcomeScorecardProps {
  units: ScoreUnit[];
  a: Participant;
  b: Participant;
  /** Per-side players — a 2v2 renders two stacked NAMES (no avatars) in the name
   *  column instead of the compound "R & B" single name. */
  aPlayers?: SidePlayer[];
  bPlayers?: SidePlayer[];
  outcomes: HoleOutcomeRow[];
  glorious?: GloriousConfig;
  leftColor?: string;
  rightColor?: string;
  /** Same tee/yardage header StandardGrid gets — outcome mode has no scores,
   *  but the course structure (tees, par, stroke index) is identical. */
  tee?: { name: string; courseRating?: number | null; slopeRating?: number | null; bogeyRating?: number | null } | null;
  teeRows?: TeeRow[];
}

export function OutcomeScorecard({
  units,
  a,
  b,
  aPlayers,
  bPlayers,
  outcomes,
  glorious = NO_GLORIOUS,
  leftColor,
  rightColor,
  tee,
  teeRows = [],
}: OutcomeScorecardProps) {
  const decided = buildDecidedFromOutcomes(outcomes);
  const { track, st } = computeLeadTrack(decided, units.length, glorious);
  const lc = leftColor || WIN_GREEN;
  const rc = rightColor || WIN_GREEN;
  const winner = st.leader === "A" ? a : st.leader === "B" ? b : null;
  const loser = st.leader === "A" ? b : st.leader === "B" ? a : null;

  return (
    <div data-testid="outcome-scorecard">
      <ScorecardChrome units={units} tee={tee} teeRows={teeRows} glorious={glorious}>
        {({ hasSections, front, cellBase, nameCell, divider, isGloriousCol, gloriousWash }) => {
          const outSwing = hasSections ? sectionSwing(decided, glorious, 1, front.length) : 0;
          const inSwing = hasSections ? sectionSwing(decided, glorious, front.length + 1, units.length) : 0;
          const totalSwing = outSwing + inSwing;
          const rowProps = { units, track, nameCell, cellBase, divider, isGloriousCol, gloriousWash, hasSections, outSwing, inSwing, totalSwing };
          return (
            <>
              <LeadRow {...rowProps} name={a.name} players={aPlayers} side="A" color={lc} />
              <LeadRow {...rowProps} name={b.name} players={bPlayers} side="B" color={rc} />
            </>
          );
        }}
      </ScorecardChrome>

      {st.over && (
        <p className="text-center" style={{ padding: "12px 10px 2px", fontSize: 13, fontWeight: 800, color: "var(--color-bt-place-1-text)" }} data-testid="outcome-closeout">
          {winner && loser ? `${winner.name} def. ${loser.name} — ${st.margin}` : `Match halved — ${st.margin}`}
        </p>
      )}
    </div>
  );
}

function LeadRow({
  name,
  players,
  units,
  track,
  side,
  color,
  nameCell,
  cellBase,
  divider,
  isGloriousCol,
  gloriousWash,
  hasSections,
  outSwing,
  inSwing,
  totalSwing,
}: {
  name: string;
  players?: SidePlayer[];
  units: ScoreUnit[];
  track: LeadCell[];
  side: "A" | "B";
  color: string;
  nameCell: React.CSSProperties;
  cellBase: React.CSSProperties;
  divider: (l?: string) => React.CSSProperties;
  isGloriousCol: (i: number) => boolean;
  gloriousWash: React.CSSProperties;
  hasSections: boolean;
  outSwing: number;
  inSwing: number;
  totalSwing: number;
}) {
  const stacked = players && players.length > 1;
  return (
    // minHeight (not fixed 44) so a 2v2's two-line names grow the row and every
    // cell stretches to match; a 1v1 keeps the 44px single-name row.
    <div className="flex" style={{ minHeight: 44, borderBottom: "1px solid var(--color-bt-subtle-border)" }}>
      <div className={`flex ${stacked ? "flex-col justify-center" : "items-center"}`} style={{ ...nameCell, padding: stacked ? "6px 10px" : "0 10px" }}>
        {stacked ? (
          // 2v2 → two stacked NAMES, no avatar disks — avatars don't fit the dense
          // grid; the row grows to fit two full-size names (same as MatchCard).
          players!.map((p) => (
            <span key={p.id} className="max-w-full truncate" style={{ fontSize: 15, fontWeight: 700, color: "var(--color-bt-text)", lineHeight: 1.35 }}>
              {p.name}
            </span>
          ))
        ) : (
          <span style={{ fontSize: 15, fontWeight: 700, color: "var(--color-bt-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {name}
          </span>
        )}
      </div>
      {track.map((c, i) => (
        <div
          key={c.hole}
          className="flex items-center justify-center"
          style={{
            ...cellBase,
            minHeight: 44,
            ...divider(units[i]?.label),
            ...(isGloriousCol(i) && !c.dead ? gloriousWash : {}),
            ...(c.glorious && !c.dead
              ? { outline: "1px dashed var(--color-bt-glorious-border)", outlineOffset: -3, borderRadius: 8 }
              : {}),
          }}
        >
          {c.dead ? (
            <span style={{ color: "var(--color-bt-text-dim)", opacity: 0.4 }}>·</span>
          ) : c.lead == null ? null : side === "A" && c.lead > 0 ? (
            <LeadPill value={c.lead} color={color} />
          ) : side === "B" && c.lead < 0 ? (
            <LeadPill value={-c.lead} color={color} />
          ) : side === "B" && c.lead === 0 ? (
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--color-bt-text-dim)" }} data-testid="outcome-as">
              AS
            </span>
          ) : null}
        </div>
      ))}
      {hasSections && <LeadSubCell value={outSwing} side={side} color={color} />}
      {hasSections && <LeadSubCell value={inSwing} side={side} color={color} />}
      <LeadSubCell value={totalSwing} side={side} color={color} wide />
      <RightGutter />
    </div>
  );
}

/** The Out/In/Total column for a lead row — same tinted footprint `SubCell`
 *  uses for a stroke row's subtotals, showing this side's swing over that
 *  section via the identical `LeadPill`/`AS` vocabulary the hole cells use. */
function LeadSubCell({ value, side, color, wide }: { value: number; side: "A" | "B"; color: string; wide?: boolean }) {
  const showsPill = (side === "A" && value > 0) || (side === "B" && value < 0);
  return (
    <div
      className="flex items-center justify-center"
      style={{
        width: wide ? TOTAL_W : SUB_W,
        minWidth: wide ? TOTAL_W : SUB_W,
        minHeight: 44,
        flexShrink: 0,
        background: wide ? "rgba(45,212,191,0.07)" : "rgba(255,255,255,0.025)",
      }}
    >
      {showsPill ? (
        <LeadPill value={Math.abs(value)} color={color} />
      ) : side === "B" && value === 0 ? (
        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--color-bt-text-dim)" }}>AS</span>
      ) : null}
    </div>
  );
}

/** Team-tinted lead pill — same visual grammar as the board's ProjectionPill
 *  (16%-alpha team fill, value in plain team color). */
function LeadPill({ value, color }: { value: number; color: string }) {
  return (
    <span
      className="inline-flex items-center justify-center"
      data-testid="outcome-lead-pill"
      style={{
        minWidth: 30,
        height: 26,
        padding: "0 7px",
        borderRadius: 7,
        fontSize: 13,
        fontWeight: 800,
        background: `color-mix(in srgb, ${color} 16%, transparent)`,
        color,
      }}
    >
      {value}
      <span style={{ fontSize: 8, marginLeft: 2 }}>▲</span>
    </span>
  );
}
