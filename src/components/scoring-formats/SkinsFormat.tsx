"use client";

import type { TeamInfo, ScoreEntryResult } from "../ScoreEntry";

interface SkinsFormatProps {
  teams: TeamInfo[];
  scores: ScoreEntryResult[];
  onChange: (teamId: string, points: number) => void;
}

/**
 * Skins format — numeric skins-won per team.
 *
 * Each hole is worth a "skin". Team winning the hole wins the skin.
 * Tied holes carry over. Points map to match result:
 * Winner = 1, loser = 0, tied = 0.5 each.
 */
export function SkinsFormat({ teams, scores, onChange }: SkinsFormatProps) {
  return (
    <div className="space-y-3" data-testid="skins-format">
      <div
        className="rounded-lg px-3 py-2 text-center text-xs"
        style={{ background: "#00d4aa11", color: "#00d4aa", border: "1px solid #00d4aa33" }}
      >
        Skins game — each hole is a skin!
      </div>
      <p className="text-center text-xs" style={{ color: "#8b949e" }}>
        Enter match result per team (0, 0.5, or 1 point)
      </p>
      {teams.map((team) => {
        const score = scores.find((s) => s.teamId === team.id);
        const points = score?.points ?? 0;

        return (
          <div
            key={team.id}
            className="flex items-center justify-between rounded-xl px-4 py-3"
            style={{ background: "#21262d", border: `1px solid ${team.color}44` }}
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
                style={{ background: "#30363d", color: "#e6edf3" }}
              >
                -
              </button>
              <span
                data-testid={`points-${team.id}`}
                className="w-10 text-center text-lg font-bold"
                style={{ color: "#e6edf3" }}
              >
                {points}
              </span>
              <button
                data-testid={`increment-${team.id}`}
                onClick={() => onChange(team.id, Math.min(1, points + 0.5))}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-sm font-bold"
                style={{ background: "#30363d", color: "#e6edf3" }}
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
