"use client";

import type { TeamInfo, ScoreEntryResult } from "../ScoreEntry";

interface StablefordFormatProps {
  teams: TeamInfo[];
  scores: ScoreEntryResult[];
  onChange: (teamId: string, points: number) => void;
}

/**
 * Stableford format — point-based scoring per team.
 *
 * Each team accumulates stableford points. The team with more points
 * wins the round point (1). Equal points = halved (0.5 each).
 *
 * The UI shows increment/decrement controls to set each team's match result.
 */
export function StablefordFormat({ teams, scores, onChange }: StablefordFormatProps) {
  return (
    <div className="space-y-3" data-testid="stableford-format">
      <p className="text-center text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
        Stableford — enter match result per team (0, 0.5, or 1 point)
      </p>
      {teams.map((team) => {
        const score = scores.find((s) => s.teamId === team.id);
        const points = score?.points ?? 0;

        return (
          <div
            key={team.id}
            className="flex items-center justify-between rounded-xl px-4 py-3"
            style={{ background: "var(--color-bt-subtle-border)", border: `1px solid ${team.color}44` }}
          >
            <div className="flex items-center gap-2">
              <div
                className="h-3 w-3 rounded-full"
                style={{ background: team.color }}
              />
              <span className="text-sm font-medium" style={{ color: team.color }}>
                {team.name}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                data-testid={`decrement-${team.id}`}
                onClick={() => onChange(team.id, Math.max(0, points - 0.5))}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-sm font-bold"
                style={{ background: "var(--color-bt-border)", color: "var(--color-bt-text)" }}
              >
                -
              </button>
              <span
                data-testid={`points-${team.id}`}
                className="w-10 text-center text-lg font-bold"
                style={{ color: "var(--color-bt-text)" }}
              >
                {points}
              </span>
              <button
                data-testid={`increment-${team.id}`}
                onClick={() => onChange(team.id, Math.min(1, points + 0.5))}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-sm font-bold"
                style={{ background: "var(--color-bt-border)", color: "var(--color-bt-text)" }}
              >
                +
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
