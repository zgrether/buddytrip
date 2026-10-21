"use client";

import { TeamBadge } from "@/components/TeamBadge";
import { SEED_TEAM_COLORS, seedTeamName } from "@/lib/teamColors";
import type { StartingPointId } from "@/lib/startingPoints";

/**
 * The art on a starting point's tile, and larger on its review (Zach's rulings,
 * 2026-10-21): built from the app's OWN pieces, so a picture of a team cup is
 * the badges a team cup shows, a golf week is the leaderboard's bars, a
 * bracket is a bracket and keeping score is a scorecard strip. Theme tokens
 * only, plus the seed team palette the teams themselves will be given.
 *
 * Decorative: the tile's name says what it is, so the art is aria-hidden.
 */

export type ArtKind = StartingPointId | "just_keep_score";

const TRACK = "var(--color-bt-card-raised)";
const MUTED = "var(--color-bt-border)";
const ACCENT = "var(--color-bt-accent)";

const team = (i: number) => SEED_TEAM_COLORS[i % SEED_TEAM_COLORS.length].color;

export function StartingPointArt({
  kind,
  scale = 1,
  teams,
}: {
  kind: ArtKind;
  /** 1 on the tile; larger on the review. */
  scale?: number;
  /** Golf week only: show teams (2+) instead of individuals. */
  teams?: number;
}) {
  return (
    <div aria-hidden="true" className="flex items-center justify-center" style={{ height: 96 * scale }}>
      <div style={{ transform: `scale(${scale})`, transformOrigin: "center" }}>
        {kind === "team_cup_weekend" && <TeamCupArt />}
        {kind === "golf_week" && (teams && teams >= 2 ? <TeamBarsArt teams={teams} /> : <PlayerBarsArt />)}
        {kind === "bar_night_bracket" && <BracketArt />}
        {kind === "just_keep_score" && <ScorecardArt />}
      </div>
    </div>
  );
}

/** Two team badges facing off, over the cup's tug-of-war bar. */
function TeamCupArt() {
  return (
    <div className="flex flex-col items-center gap-3" style={{ width: 140 }}>
      <div className="flex w-full items-center justify-between px-3">
        <TeamBadge {...seedTeamName(0)} color={team(0)} size={34} />
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", color: "var(--color-bt-text-dim)" }}>VS</span>
        <TeamBadge {...seedTeamName(1)} color={team(1)} size={34} />
      </div>
      <div className="relative w-full" style={{ height: 8 }}>
        <div className="absolute inset-0 rounded-full" style={{ background: TRACK }} />
        <div className="absolute inset-y-0 left-0 rounded-l-full" style={{ width: "55%", background: team(0) }} />
        <div className="absolute inset-y-0 right-0 rounded-r-full" style={{ width: "36%", background: team(1) }} />
        <div className="absolute" style={{ left: "50%", top: -6, width: 1.5, height: 20, marginLeft: -0.75, background: "var(--color-bt-text-dim)" }} />
      </div>
    </div>
  );
}

/** The leaderboard's bars, one per player, the leader's in the accent. */
function PlayerBarsArt() {
  const widths = [100, 76, 56, 34];
  return (
    <div className="flex flex-col gap-2.5" style={{ width: 140 }}>
      {widths.map((w, i) => (
        <div key={i} className="flex items-center gap-2.5">
          <span className="rounded-full" style={{ width: 13, height: 13, background: team(i + 4), flexShrink: 0 }} />
          <span className="flex-1">
            <span className="block rounded-full" style={{ height: 8, width: `${w}%`, background: i === 0 ? ACCENT : MUTED }} />
          </span>
        </div>
      ))}
    </div>
  );
}

/** The same bars, led by team badges: a golf week played as teams. */
function TeamBarsArt({ teams }: { teams: number }) {
  const shown = Math.min(teams, 4);
  const widths = [100, 72, 48, 30];
  return (
    <div className="flex flex-col gap-2" style={{ width: 140 }}>
      {Array.from({ length: shown }, (_, i) => (
        <div key={i} className="flex items-center gap-2.5">
          <TeamBadge {...seedTeamName(i)} color={team(i)} size={16} />
          <span className="flex-1">
            <span className="block rounded-full" style={{ height: 8, width: `${widths[i]}%`, background: i === 0 ? team(0) : MUTED }} />
          </span>
        </div>
      ))}
    </div>
  );
}

/** Four entrants, two semis, a final, and the trophy. */
function BracketArt() {
  const entrant = (i: number) => (
    <span className="flex items-center rounded" style={{ width: 30, height: 12, padding: "0 3px", background: TRACK }}>
      <span className="rounded-sm" style={{ width: 6, height: 6, background: team(i) }} />
    </span>
  );
  const line = { stroke: MUTED, strokeWidth: 1.5, fill: "none" } as const;
  return (
    <div className="relative" style={{ width: 150, height: 84 }}>
      <div className="absolute flex flex-col" style={{ left: 0, top: 4, gap: 6 }}>{entrant(0)}{entrant(1)}</div>
      <div className="absolute flex flex-col" style={{ left: 0, top: 50, gap: 6 }}>{entrant(2)}{entrant(3)}</div>
      <div className="absolute" style={{ left: 48, top: 13 }}>{entrant(0)}</div>
      <div className="absolute" style={{ left: 48, top: 59 }}>{entrant(2)}</div>
      <svg className="absolute inset-0" width="150" height="84" viewBox="0 0 150 84">
        <path d="M30 10H38V28H30M38 19H48" style={line} />
        <path d="M30 56H38V74H30M38 65H48" style={line} />
        <path d="M78 19H88V65H78M88 42H104" style={line} />
      </svg>
      <div
        className="absolute flex items-center justify-center rounded-full"
        style={{ left: 106, top: 27, width: 30, height: 30, background: "var(--color-bt-accent-faint)", color: ACCENT }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
          <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
          <path d="M4 22h16" />
          <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
        </svg>
      </div>
    </div>
  );
}

/** A scorecard strip: nine holes, one round's scores, a birdie circled. */
function ScorecardArt() {
  const holes = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const scores = [4, 5, 2, 4, 4, 5, 3, 4, 4];
  const cell = { width: 15, textAlign: "center" as const };
  return (
    <div className="flex flex-col gap-1.5" style={{ width: 150 }}>
      <div className="flex justify-between px-1" style={{ fontSize: 9, color: "var(--color-bt-text-dim)" }}>
        {holes.map((h) => (
          <span key={h} style={cell}>{h}</span>
        ))}
      </div>
      <div className="flex items-center justify-between rounded-md px-1" style={{ height: 24, background: TRACK, fontSize: 11, fontWeight: 600 }}>
        {scores.map((s, i) => (
          <span
            key={i}
            className="flex items-center justify-center rounded-full"
            style={{
              ...cell,
              height: 15,
              color: i === 2 ? ACCENT : "var(--color-bt-text)",
              boxShadow: i === 2 ? `inset 0 0 0 1.5px ${ACCENT}` : undefined,
            }}
          >
            {s}
          </span>
        ))}
      </div>
    </div>
  );
}
