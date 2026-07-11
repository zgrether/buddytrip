"use client";

import { Table2 } from "lucide-react";
import { matchState, type DecidedHole } from "@/lib/matchPlay";
import { NO_GLORIOUS, type GloriousConfig } from "@/lib/gloriousHoles";
import { teamTextColor } from "@/lib/teamTextColor";
import type { Participant } from "./types";

/**
 * MatchCard — the team-agnostic match board (Spec Addendum B-3, supersedes the
 * old MatchStrip). One card per match. Neutral by default (place-1 green leader
 * emphasis + a value-ramp history); pass `leftColor`/`rightColor` for team
 * context (Slice D) and the margins/tints/history/identity-bars switch to team
 * colors. This is presentation only — `matchState` is unchanged.
 *
 * Layout (exact): header (label · centered THRU/DORMIE/FINAL · spacer) → row
 * ([Margin][Name A][IdBar][hole #][IdBar][Name B][Margin]) → 18-segment history.
 * No avatars, no strokes badge (the stroke pip lives on the entry cell). Names
 * lean inward; the colored margin block (not weight/teal) is the leader cue.
 */

const WIN_GREEN = "#22c55e"; // = --color-bt-place-1 base; neutral "winning" color (NOT teal)
// Neutral history ramp — value/lightness, not hue (the hue budget is for teams).
const NEU_WON_L = "#eaeef4"; // left won — bright
const NEU_WON_R = "#566275"; // right won — dark (wide gap)
const NEU_HALF = "#8c97a8"; // halved — mid

interface MatchCardProps {
  a: Participant;
  b: Participant;
  /** Decided holes, A's perspective — {hole, W/L/H}, in play order. */
  results: DecidedHole[];
  /** Glorious Finishing Holes weight (2× the last N). Omit for standard match play. */
  glorious?: GloriousConfig;
  label?: string;
  /** Team colors (Slice D). Omit for the neutral standalone default. */
  leftColor?: string;
  rightColor?: string;
  holeCount?: number;
  onClick?: () => void;
  /** Current user's id — appends "(you)" to their name. */
  youId?: string;
  /** Hide the "· 1v1" suffix in the header (entry page shows just "MATCH #"). */
  hideFormat?: boolean;
  /** Opens this match's scorecard — renders a compact button on the RIGHT of the
   *  header row (the MATCH # · THRU/FINAL row). Only pass when the card itself is
   *  NOT a tap target (no `onClick`) — nesting a button in a button is invalid. */
  onScorecard?: () => void;
}

export function MatchCard({
  a,
  b,
  results,
  glorious = NO_GLORIOUS,
  label = "Match",
  leftColor,
  rightColor,
  holeCount = 18,
  onClick,
  youId,
  hideFormat,
  onScorecard,
}: MatchCardProps) {
  const st = matchState(results, holeCount, glorious);
  const teams = !!(leftColor && rightColor);
  const lc = leftColor || WIN_GREEN; // left emphasis color
  const rc = rightColor || WIN_GREEN; // right emphasis color
  const wonL = teams ? lc : NEU_WON_L;
  const wonR = teams ? rc : NEU_WON_R;
  const halfC = teams ? "var(--color-bt-text-dim)" : NEU_HALF;

  const aLeads = st.leader === "A";
  const bLeads = st.leader === "B";
  const square = st.leader === null;
  const headerWord = st.over ? "FINAL" : st.dormie ? "DORMIE" : "THRU";
  const headerGreen = st.over || st.dormie;
  const centerNum = st.over ? "F" : String(st.thru);
  // Leader margin text: closed margin ("3&2") or won-18 ("2 UP") from matchState,
  // else the live lead while in progress.
  const leadText = st.over ? (st.margin ?? "") : `${st.up} UP`;

  const Container = onClick ? "button" : "div";
  return (
    <Container
      onClick={onClick}
      className={`block w-full text-left ${onClick ? "transition-transform active:scale-[0.99]" : ""}`}
      style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)", borderRadius: 14, overflow: "hidden" }}
    >
      {/* 1 · Header */}
      <div className="flex items-center" style={{ height: 26, padding: "0 12px", borderBottom: "1px solid var(--color-bt-subtle-border)" }}>
        <span className="flex-1" style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--color-bt-text-dim)" }}>
          {hideFormat ? label : `${label} · 1v1`}
        </span>
        <span
          className="flex-1 text-center"
          style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: headerGreen ? "var(--color-bt-place-1-text)" : "var(--color-bt-text-dim)" }}
        >
          {headerWord}
        </span>
        {/* Scorecard affordance — right of the header row (moved off the app bar). */}
        <span className="flex flex-1 items-center justify-end">
          {onScorecard && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onScorecard(); }}
              aria-label="Scorecard"
              data-testid="match-scorecard"
              className="flex h-5 w-5 items-center justify-center rounded transition-colors hover:bg-[var(--color-bt-hover)]"
            >
              <Table2 size={14} style={{ color: "var(--color-bt-text-dim)" }} />
            </button>
          )}
        </span>
      </div>

      {/* 2 · Row */}
      <div className="flex" style={{ height: 50, alignItems: "stretch" }}>
        <Margin active={aLeads} square={square} text={aLeads ? leadText : "AS"} color={lc} closed={st.closed} />
        <NameCell name={a.name} align="right" tinted={aLeads} color={lc} you={!!youId && a.id === youId} />
        <div style={{ width: 3, background: wonL }} />
        <div className="flex items-center justify-center" style={{ width: 40, background: "var(--color-bt-card-raised)", fontSize: 19, fontWeight: 700, color: "var(--color-bt-text)" }}>
          {centerNum}
        </div>
        <div style={{ width: 3, background: wonR }} />
        <NameCell name={b.name} align="left" tinted={bLeads} color={rc} you={!!youId && b.id === youId} />
        <Margin active={bLeads} square={square} text={bLeads ? leadText : "AS"} color={rc} closed={st.closed} />
      </div>

      {/* 3 · History */}
      <div className="flex items-center" style={{ gap: 2, padding: "8px 12px 10px", borderTop: "1px solid var(--color-bt-subtle-border)" }}>
        {Array.from({ length: holeCount }, (_, i) => {
          let bg = "var(--color-bt-card-raised)";
          let op = 0.5;
          if (i < st.thru) {
            const r = results[i]?.result;
            bg = r === "W" ? wonL : r === "L" ? wonR : halfC;
            op = 1;
          } else if (st.closed) {
            op = 0.25; // dead — past close-out
          }
          return <div key={i} style={{ flex: 1, height: 4, borderRadius: 2, background: bg, opacity: op }} />;
        })}
      </div>
    </Container>
  );
}

/** Outer status margin — solid emphasis color iff this side leads; grey "AS" on
 *  both when square; empty otherwise. */
function Margin({ active, square, text, color, closed }: { active: boolean; square: boolean; text: string; color: string; closed: boolean }) {
  return (
    <div className="flex items-center justify-center" style={{ width: 56, flexShrink: 0, background: active ? color : "transparent" }}>
      {(active || square) && (
        <span style={{ fontSize: closed && active ? 14 : 15, fontWeight: 800, color: active ? teamTextColor(color) : NEU_HALF, whiteSpace: "nowrap" }}>
          {text}
        </span>
      )}
    </div>
  );
}

/** Name column — leans inward (left col right-justified, right col left-justified);
 *  leading side gets a faint tint of its emphasis color. Uniform 600 weight. */
function NameCell({ name, align, tinted, color, you }: { name: string; align: "left" | "right"; tinted: boolean; color: string; you?: boolean }) {
  // Shrink the font for long names (the cell is narrow) instead of truncating.
  const len = name.length + (you ? 6 : 0);
  const fontSize = len > 16 ? 13 : len > 12 ? 15 : 17;
  return (
    <div
      className="flex min-w-0 flex-1 items-center"
      style={{ justifyContent: align === "right" ? "flex-end" : "flex-start", padding: "0 10px", background: tinted ? `${color}29` : "transparent" }}
    >
      <span style={{ fontSize, fontWeight: 600, color: "var(--color-bt-text)", textAlign: align, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {name}
        {you && <span style={{ color: "var(--color-bt-text-dim)", fontWeight: 400 }}> (you)</span>}
      </span>
    </div>
  );
}
