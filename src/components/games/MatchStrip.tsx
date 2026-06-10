"use client";

import { Flag, Check, ChevronRight } from "lucide-react";
import { matchState, type HoleResult } from "@/lib/matchPlay";
import type { Participant } from "./types";

/**
 * MatchStrip — the running match-state band (Slice B, §1). A LAYER over the
 * Slice A entry view, never a new scorecard. Pinned above the hole nav (one
 * match) or repeated per match group (two matches per card).
 *
 * Persistence-agnostic: takes the decided holes (A's perspective, play order)
 * and runs the SHARED, frozen `matchState` — the same function the server
 * result computation uses (`src/lib/matchPlay.ts`), so the live strip and the
 * persisted record can't diverge.
 *
 * Status is place-1 green (the "winning" color), NOT teal — teal is reserved for
 * CTAs/active controls. History-bar won segments use each player's identity
 * color (intentionally outside the token system, like team colors).
 */
interface MatchStripProps {
  a: Participant; // left player
  b: Participant; // right player
  decided: HoleResult[]; // DECIDED holes only, from A's perspective, play order
  strokesA?: number; // strokes A receives (badge) — usually 0
  strokesB?: number; // strokes B receives (badge)
  label?: string; // "Match 1"
  holeCount?: number; // segments in the history bar (golf = 18)
  onClick?: () => void; // when set, the whole strip is a tappable overview row (+ chevron)
}

export function MatchStrip({
  a,
  b,
  decided,
  strokesA = 0,
  strokesB = 0,
  label = "Match",
  holeCount = 18,
  onClick,
}: MatchStripProps) {
  const st = matchState(decided);
  const winning = st.up > 0; // someone leads
  const greenStatus = winning; // green when a side is up; dim for AS
  const statusText = st.over ? (st.margin ?? "AS") : winning ? `${st.up} UP` : "AS";

  const aLeads = st.leader === "A";
  const bLeads = st.leader === "B";
  // Over: winner ringed + check (no winner on a halved final).
  const aWon = st.over && aLeads;
  const bWon = st.over && bLeads;

  const containerStyle: React.CSSProperties = {
    display: "block",
    width: "100%",
    textAlign: "left",
    padding: "8px 12px 9px",
    background: st.closed ? "var(--color-bt-place-1-bg)" : "var(--color-bt-card)",
    border: st.closed ? "1px solid rgba(34,197,94,0.25)" : "1px solid var(--color-bt-border)",
    borderRadius: 12,
  };
  const Container = onClick ? "button" : "div";
  return (
    <Container
      onClick={onClick}
      className={onClick ? "transition-transform active:scale-[0.99]" : undefined}
      style={containerStyle}
    >
      {/* Label row */}
      <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--color-bt-text-dim)",
          }}
        >
          {label} · 1v1
        </span>
        <span className="flex items-center gap-1.5">
          {st.over ? (
            <span
              className="flex items-center gap-1"
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "var(--color-bt-place-1-text)",
              }}
            >
              <Flag size={11} strokeWidth={2.4} /> Final
            </span>
          ) : (
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "var(--color-bt-text-dim)",
              }}
            >
              thru {st.thru}
            </span>
          )}
          {onClick && <ChevronRight size={13} style={{ color: "var(--color-bt-text-dim)" }} />}
        </span>
      </div>

      {/* Status row */}
      <div className="flex items-center justify-between" style={{ gap: 8 }}>
        <Side
          player={a}
          leading={aLeads || (!winning && !st.over) || aWon}
          ringed={aWon || (winning && aLeads)}
          won={aWon}
          strokes={strokesA}
          align="left"
          dimmed={(winning && !aLeads) || bWon}
        />
        <span
          className="text-center"
          style={{
            flexShrink: 0,
            fontSize: 18,
            fontWeight: 800,
            letterSpacing: "-0.01em",
            color: greenStatus ? "var(--color-bt-place-1-text)" : "var(--color-bt-text-dim)",
          }}
        >
          {statusText}
          {st.dormie && (
            <span
              style={{
                display: "block",
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: "0.1em",
                color: "var(--color-bt-place-1-text)",
                marginTop: 1,
              }}
            >
              DORMIE
            </span>
          )}
        </span>
        <Side
          player={b}
          leading={bLeads || (!winning && !st.over) || bWon}
          ringed={bWon || (winning && bLeads)}
          won={bWon}
          strokes={strokesB}
          align="right"
          dimmed={(winning && !bLeads) || aWon}
        />
      </div>

      {/* History bar — 18 segments */}
      <div className="flex items-center" style={{ gap: 2, marginTop: 8 }}>
        {Array.from({ length: holeCount }, (_, i) => {
          let bg = "var(--color-bt-card-raised)";
          let op = 0.5;
          if (i < st.thru) {
            const r = decided[i];
            if (r === "W") {
              bg = a.color;
              op = 1;
            } else if (r === "L") {
              bg = b.color;
              op = 1;
            } else {
              bg = "var(--color-bt-text-dim)"; // halved
              op = 0.9;
            }
          } else if (st.closed) {
            op = 0.25; // dead — past close-out
          }
          return <div key={i} style={{ flex: 1, height: 4, borderRadius: 2, background: bg, opacity: op }} />;
        })}
      </div>
    </Container>
  );
}

function Side({
  player,
  ringed,
  won,
  strokes,
  align,
  dimmed,
}: {
  player: Participant;
  leading: boolean;
  ringed: boolean;
  won: boolean;
  strokes: number;
  align: "left" | "right";
  dimmed: boolean;
}) {
  const avatar = (
    <span
      className="flex items-center justify-center"
      style={{
        position: "relative",
        width: 26,
        height: 26,
        borderRadius: "50%",
        background: `${player.color}22`,
        border: ringed ? `2px solid ${player.color}` : `1.5px solid ${player.color}55`,
        color: player.color,
        fontSize: 11,
        fontWeight: 700,
        flexShrink: 0,
      }}
    >
      {player.initials}
      {won && (
        <span
          className="flex items-center justify-center"
          style={{
            position: "absolute",
            right: -4,
            bottom: -4,
            width: 14,
            height: 14,
            borderRadius: "50%",
            background: "var(--color-bt-place-1-text)",
            color: "var(--color-bt-base)",
          }}
        >
          <Check size={9} strokeWidth={3} />
        </span>
      )}
    </span>
  );

  const name = (
    <span
      style={{
        fontSize: 13,
        fontWeight: ringed ? 700 : 500,
        color: "var(--color-bt-text)",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      {player.name}
    </span>
  );

  const badge =
    strokes > 0 ? (
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: "var(--color-bt-warning)",
          background: "var(--color-bt-warning-faint)",
          border: "1px solid var(--color-bt-warning-border)",
          borderRadius: 4,
          padding: "0 4px",
          flexShrink: 0,
        }}
      >
        +{strokes}
      </span>
    ) : null;

  return (
    <span
      className="flex min-w-0 flex-1 items-center gap-1.5"
      style={{
        opacity: dimmed ? 0.5 : 1,
        flexDirection: align === "right" ? "row-reverse" : "row",
        justifyContent: align === "right" ? "flex-start" : "flex-start",
      }}
    >
      {avatar}
      {name}
      {badge}
    </span>
  );
}
