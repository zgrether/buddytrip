"use client";

import { SEED_TEAM_COLORS } from "@/lib/teamColors";
import { teamTextColor } from "@/lib/teamTextColor";
import type { StartingPointId } from "@/lib/startingPoints";

/**
 * The art on a starting point's tile, and larger on its review (Zach's rulings,
 * 2026-10-21): built from the app's OWN pieces, so a picture of a team cup is
 * the badges a team cup shows, a golf week is the leaderboard's bars, a
 * bracket is a bracket and keeping score is a scorecard strip.
 *
 * SCALABLE (Zach, on the picker's look): each piece is one SVG on a 160×96
 * canvas that fills its container's width at that aspect ratio, up to
 * `maxHeight`, so a phone tile, a desktop tile and the review all draw the
 * same picture at their own size. A team badge is drawn in SVG with
 * `TeamBadge`'s own geometry (corner radius 0.28 of its size, the letter at
 * 0.56 and weight 800, its colour picked by `teamTextColor`) so it scales with
 * the rest instead of staying a fixed-pixel element.
 *
 * Theme tokens only, plus the seed team palette the teams will be given.
 * Decorative: the tile's name says what it is, so the art is aria-hidden.
 */

export type ArtKind = StartingPointId | "just_keep_score";

const W = 160;
const H = 96;

const TRACK = "var(--color-bt-card-raised)";
const MUTED = "var(--color-bt-border)";
const ACCENT = "var(--color-bt-accent)";
const DIM = "var(--color-bt-text-dim)";
const TEXT = "var(--color-bt-text)";

const team = (i: number) => SEED_TEAM_COLORS[i % SEED_TEAM_COLORS.length].color;

export function StartingPointArt({
  kind,
  maxHeight = 140,
  teams,
}: {
  kind: ArtKind;
  /** The tallest it may draw; it is otherwise as wide as its container. */
  maxHeight?: number;
  /** Golf week only: show teams (2+) instead of individuals. */
  teams?: number;
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      preserveAspectRatio="xMidYMid meet"
      style={{ display: "block", height: "auto", maxHeight }}
      data-art={kind}
    >
      {kind === "team_cup_weekend" && <TeamCupArt />}
      {kind === "golf_week" && (teams && teams >= 2 ? <TeamBarsArt teams={teams} /> : <PlayerBarsArt />)}
      {kind === "bar_night_bracket" && <BracketArt />}
      {kind === "just_keep_score" && <ScorecardArt />}
    </svg>
  );
}

/** `TeamBadge`'s shape, in SVG: a rounded square in the team colour, its letter. */
function Badge({ x, y, size, i }: { x: number; y: number; size: number; i: number }) {
  const color = team(i);
  return (
    <g>
      <rect x={x} y={y} width={size} height={size} rx={Math.max(3, size * 0.28)} style={{ fill: color }} />
      <text
        x={x + size / 2}
        y={y + size / 2}
        textAnchor="middle"
        dominantBaseline="central"
        style={{ fill: teamTextColor(color), fontSize: size * 0.56, fontWeight: 800 }}
      >
        {String.fromCharCode(65 + i)}
      </text>
    </g>
  );
}

/** Two team badges facing off, over the cup's tug-of-war bar. */
function TeamCupArt() {
  return (
    <g>
      <Badge x={22} y={12} size={38} i={0} />
      <text x={80} y={31} textAnchor="middle" dominantBaseline="central" style={{ fill: DIM, fontSize: 11, fontWeight: 700, letterSpacing: "0.08em" }}>
        VS
      </text>
      <Badge x={100} y={12} size={38} i={1} />
      <rect x={22} y={68} width={116} height={8} rx={4} style={{ fill: TRACK }} />
      <rect x={22} y={68} width={64} height={8} rx={4} style={{ fill: team(0) }} />
      <rect x={96} y={68} width={42} height={8} rx={4} style={{ fill: team(1) }} />
      <rect x={79.25} y={62} width={1.5} height={20} rx={0.75} style={{ fill: DIM }} />
    </g>
  );
}

/** The leaderboard's bars, one per player, the leader's in the accent. */
function PlayerBarsArt() {
  const widths = [104, 80, 60, 38];
  return (
    <g>
      {widths.map((w, i) => (
        <g key={i}>
          <circle cx={22} cy={18 + i * 20} r={7} style={{ fill: team(i + 4) }} />
          <rect x={36} y={14 + i * 20} width={w} height={8} rx={4} style={{ fill: i === 0 ? ACCENT : MUTED }} />
        </g>
      ))}
    </g>
  );
}

/** The same bars, led by team badges: a golf week played as teams. */
function TeamBarsArt({ teams }: { teams: number }) {
  const shown = Math.min(teams, 4);
  const widths = [100, 76, 54, 34];
  const step = shown <= 3 ? 30 : 22;
  const top = (H - (shown - 1) * step - 20) / 2;
  return (
    <g>
      {Array.from({ length: shown }, (_, i) => (
        <g key={i}>
          <Badge x={18} y={top + i * step} size={20} i={i} />
          <rect x={46} y={top + i * step + 6} width={widths[i]} height={8} rx={4} style={{ fill: i === 0 ? team(0) : MUTED }} />
        </g>
      ))}
    </g>
  );
}

/** Four entrants, two semis, a final, and the trophy. */
function BracketArt() {
  const entrant = (x: number, y: number, i: number) => (
    <g key={`${x}-${y}`}>
      <rect x={x} y={y} width={34} height={13} rx={3.5} style={{ fill: TRACK }} />
      <rect x={x + 4} y={y + 3.5} width={6} height={6} rx={1.5} style={{ fill: team(i) }} />
    </g>
  );
  const line = { stroke: MUTED, strokeWidth: 1.5, fill: "none" } as const;
  return (
    <g>
      {entrant(8, 9, 0)}
      {entrant(8, 27, 1)}
      {entrant(8, 56, 2)}
      {entrant(8, 74, 3)}
      <path d="M42 15.5H52V33.5H42M52 24.5H62" style={line} />
      <path d="M42 62.5H52V80.5H42M52 71.5H62" style={line} />
      {entrant(62, 18, 0)}
      {entrant(62, 65, 2)}
      <path d="M96 24.5H106V71.5H96M106 48H118" style={line} />
      <circle cx={134} cy={48} r={15} style={{ fill: "var(--color-bt-accent-faint)" }} />
      <path d="M128 41h12v5a6 6 0 0 1-12 0z" style={{ stroke: ACCENT, strokeWidth: 1.8, strokeLinejoin: "round", fill: "none" }} />
      <path d="M134 52v4M130 57h8" style={{ stroke: ACCENT, strokeWidth: 1.8, strokeLinecap: "round", fill: "none" }} />
    </g>
  );
}

/** A scorecard strip: nine holes, one round's scores, a birdie circled. */
function ScorecardArt() {
  const scores = [4, 5, 2, 4, 4, 5, 3, 4, 4];
  const x = (i: number) => 15 + i * 16.25;
  return (
    <g>
      {scores.map((_, i) => (
        <text key={`h${i}`} x={x(i)} y={22} textAnchor="middle" style={{ fill: DIM, fontSize: 9 }}>
          {i + 1}
        </text>
      ))}
      <rect x={6} y={30} width={148} height={26} rx={5} style={{ fill: TRACK }} />
      {scores.map((s, i) => (
        <g key={`s${i}`}>
          {i === 2 && <circle cx={x(i)} cy={43} r={8} style={{ fill: "none", stroke: ACCENT, strokeWidth: 1.5 }} />}
          <text x={x(i)} y={43} textAnchor="middle" dominantBaseline="central" style={{ fill: i === 2 ? ACCENT : TEXT, fontSize: 11, fontWeight: 600 }}>
            {s}
          </text>
        </g>
      ))}
      <rect x={6} y={62} width={148} height={26} rx={5} style={{ fill: TRACK }} />
      {[5, 4, 3, 5, 4].map((s, i) => (
        <text key={`t${i}`} x={x(i)} y={75} textAnchor="middle" dominantBaseline="central" style={{ fill: DIM, fontSize: 11, fontWeight: 600 }}>
          {s}
        </text>
      ))}
    </g>
  );
}
