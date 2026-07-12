"use client";

import { buildDecidedFromOutcomes, matchState, type DecidedHole, type HoleOutcomeRow } from "@/lib/matchPlay";
import { holeWeight, isGloriousHole, NO_GLORIOUS, type GloriousConfig } from "@/lib/gloriousHoles";
import type { Participant } from "./types";

/**
 * OutcomeScorecard — the hole-outcome-entry scorecard (Refactor B2, built to
 * `outcome_scorecard_mockup.html`). NO score rows (there are no scores in outcome
 * mode) — two team-colored LEAD rows instead. The running lead lives in the
 * LEADER's row (`N▲`, team-colored); a tied hole shows neutral `AS`; a Glorious
 * hole's double-jump is directly visible in the number; closeout dims the
 * unplayed remainder. Same W/L/H color vocabulary `MatchCard`'s history strip
 * uses (win/lose/halve), reused here for the per-hole win-green treatment.
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

export interface OutcomeScorecardProps {
  units: { label: string; par?: number }[];
  a: Participant;
  b: Participant;
  outcomes: HoleOutcomeRow[];
  glorious?: GloriousConfig;
  leftColor?: string;
  rightColor?: string;
}

export function OutcomeScorecard({
  units,
  a,
  b,
  outcomes,
  glorious = NO_GLORIOUS,
  leftColor,
  rightColor,
}: OutcomeScorecardProps) {
  const decided = buildDecidedFromOutcomes(outcomes);
  const { track, st } = computeLeadTrack(decided, units.length, glorious);
  const lc = leftColor || WIN_GREEN;
  const rc = rightColor || WIN_GREEN;
  const winner = st.leader === "A" ? a : st.leader === "B" ? b : null;
  const loser = st.leader === "A" ? b : st.leader === "B" ? a : null;

  return (
    <div data-testid="outcome-scorecard">
      <div className="no-scrollbar overflow-x-auto">
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: units.length * 40 }}>
          <thead>
            <tr>
              <th style={{ width: 96 }} />
              {units.map((u, i) => (
                <th key={u.label} style={{ width: 40, padding: "2px 0 8px" }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 800,
                      color: track[i]?.glorious ? "var(--color-bt-glorious)" : "var(--color-bt-text)",
                    }}
                  >
                    {u.label}
                  </div>
                  {track[i]?.glorious && (
                    <div style={{ fontSize: 8, fontWeight: 800, color: "var(--color-bt-glorious)", letterSpacing: "0.03em" }}>
                      ◆
                    </div>
                  )}
                  {u.par != null && (
                    <div style={{ fontSize: 10, color: "var(--color-bt-text-dim)", fontWeight: 600 }}>{u.par}</div>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <LeadRow name={a.name} track={track} side="A" color={lc} />
            <LeadRow name={b.name} track={track} side="B" color={rc} />
          </tbody>
        </table>
      </div>

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
  track,
  side,
  color,
}: {
  name: string;
  track: LeadCell[];
  side: "A" | "B";
  color: string;
}) {
  return (
    <tr>
      <td style={{ textAlign: "left", padding: "0 12px", fontSize: 13, fontWeight: 700, color: "var(--color-bt-text)", whiteSpace: "nowrap" }}>
        {name}
      </td>
      {track.map((c) => (
        <td
          key={c.hole}
          style={{
            height: 38,
            borderTop: "1px solid var(--color-bt-subtle-border)",
            textAlign: "center",
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
        </td>
      ))}
    </tr>
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
