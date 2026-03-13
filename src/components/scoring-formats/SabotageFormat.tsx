"use client";

import type { TeamInfo, ScoreEntryResult } from "../ScoreEntry";

interface SabotageFormatProps {
  teams: TeamInfo[];
  scores: ScoreEntryResult[];
  onChange: (teamId: string, points: number) => void;
}

/**
 * Sabotage format — same 3-way selector as Scramble but with sabotage twist.
 *
 * Players can sabotage opponents (e.g., force a re-tee, kick a ball).
 * The scoring is the same: winner gets 1, loser 0, halved = 0.5 each.
 */
export function SabotageFormat({ teams, scores, onChange }: SabotageFormatProps) {
  if (teams.length < 2) return null;

  const teamA = teams[0];
  const teamB = teams[1];
  const scoreA = scores.find((s) => s.teamId === teamA.id)?.points ?? 0;
  const scoreB = scores.find((s) => s.teamId === teamB.id)?.points ?? 0;

  type Selection = "a" | "halved" | "b" | null;
  let selection: Selection = null;
  if (scoreA === 1 && scoreB === 0) selection = "a";
  else if (scoreA === 0.5 && scoreB === 0.5) selection = "halved";
  else if (scoreA === 0 && scoreB === 1) selection = "b";

  const select = (sel: Selection) => {
    if (sel === "a") {
      onChange(teamA.id, 1);
      onChange(teamB.id, 0);
    } else if (sel === "halved") {
      onChange(teamA.id, 0.5);
      onChange(teamB.id, 0.5);
    } else if (sel === "b") {
      onChange(teamA.id, 0);
      onChange(teamB.id, 1);
    }
  };

  return (
    <div className="space-y-3" data-testid="sabotage-format">
      <div
        className="rounded-lg px-3 py-2 text-center text-xs"
        style={{ background: "#f59e0b11", color: "#f59e0b", border: "1px solid #f59e0b33" }}
      >
        Sabotage round — special rules apply!
      </div>
      <p className="text-center text-xs" style={{ color: "#8b949e" }}>
        Who won this group?
      </p>
      <div className="flex gap-2">
        <button
          data-testid={`select-team-${teamA.id}`}
          onClick={() => select("a")}
          className="flex flex-1 flex-col items-center rounded-xl py-4 transition-all"
          style={{
            background: selection === "a" ? `${teamA.color}22` : "#21262d",
            border: `2px solid ${selection === "a" ? teamA.color : "#30363d"}`,
          }}
        >
          <span
            className="text-lg font-bold"
            style={{ color: selection === "a" ? teamA.color : "#8b949e" }}
          >
            {teamA.shortName}
          </span>
          <span className="text-[10px]" style={{ color: "#8b949e" }}>
            wins
          </span>
        </button>

        <button
          data-testid="select-halved"
          onClick={() => select("halved")}
          className="flex flex-1 flex-col items-center rounded-xl py-4 transition-all"
          style={{
            background: selection === "halved" ? "#f59e0b22" : "#21262d",
            border: `2px solid ${selection === "halved" ? "#f59e0b" : "#30363d"}`,
          }}
        >
          <span
            className="text-lg font-bold"
            style={{ color: selection === "halved" ? "#f59e0b" : "#8b949e" }}
          >
            ½
          </span>
          <span className="text-[10px]" style={{ color: "#8b949e" }}>
            halved
          </span>
        </button>

        <button
          data-testid={`select-team-${teamB.id}`}
          onClick={() => select("b")}
          className="flex flex-1 flex-col items-center rounded-xl py-4 transition-all"
          style={{
            background: selection === "b" ? `${teamB.color}22` : "#21262d",
            border: `2px solid ${selection === "b" ? teamB.color : "#30363d"}`,
          }}
        >
          <span
            className="text-lg font-bold"
            style={{ color: selection === "b" ? teamB.color : "#8b949e" }}
          >
            {teamB.shortName}
          </span>
          <span className="text-[10px]" style={{ color: "#8b949e" }}>
            wins
          </span>
        </button>
      </div>
    </div>
  );
}
