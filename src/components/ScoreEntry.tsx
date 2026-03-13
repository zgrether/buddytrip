"use client";

import { useState, useCallback } from "react";
import { X, Check, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc-client";

// ── Types ─────────────────────────────────────────────────────────────────

export interface TeamInfo {
  id: string;
  name: string;
  shortName: string;
  color: string;
}

export interface ScoreEntryResult {
  teamId: string;
  points: number; // 0, 0.5, or 1
}

export interface ScoreEntryProps {
  tripId: string;
  roundId: string;
  groupId: string;
  groupName: string;
  format: string;
  teams: TeamInfo[];
  /** Pre-filled scores for editing (from existing group_result_scores) */
  existingScores?: ScoreEntryResult[];
  onClose: () => void;
  onSubmitted: () => void;
}

// ── Format labels ─────────────────────────────────────────────────────────

const FORMAT_LABEL: Record<string, string> = {
  scramble: "Scramble",
  stableford: "Stableford",
  sabotage: "Sabotage",
  skins: "Skins",
  match_play: "Match Play",
  singles: "Singles",
};

// ── Component ─────────────────────────────────────────────────────────────

export function ScoreEntry({
  tripId,
  roundId,
  groupId,
  groupName,
  format,
  teams,
  existingScores,
  onClose,
  onSubmitted,
}: ScoreEntryProps) {
  // Default scores: use existing or initialize all to 0
  const [scores, setScores] = useState<ScoreEntryResult[]>(() => {
    if (existingScores && existingScores.length > 0) return existingScores;
    return teams.map((t) => ({ teamId: t.id, points: 0 }));
  });

  const submitMutation = trpc.groupResults.submit.useMutation({
    onSuccess: () => {
      onSubmitted();
    },
  });

  const handleScoreChange = useCallback(
    (teamId: string, points: number) => {
      setScores((prev) =>
        prev.map((s) => (s.teamId === teamId ? { ...s, points } : s))
      );
    },
    []
  );

  const handleSubmit = useCallback(() => {
    submitMutation.mutate({
      tripId,
      roundId,
      groupId,
      scores,
    });
  }, [submitMutation, tripId, roundId, groupId, scores]);

  // Scramble-like formats: 3-way selector (Team A / Halved / Team B)
  const isThreeWay = format === "scramble" || format === "sabotage" || format === "match_play";

  return (
    <>
      {/* Backdrop */}
      <div
        data-testid="score-entry-backdrop"
        className="fixed inset-0 z-40"
        style={{ background: "rgba(0,0,0,0.6)" }}
        onClick={onClose}
      />

      {/* Bottom sheet */}
      <div
        data-testid="score-entry-sheet"
        className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-xl rounded-t-2xl"
        style={{ background: "#161b22", border: "1px solid #30363d", borderBottom: "none" }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between border-b px-4 py-3"
          style={{ borderColor: "#30363d" }}
        >
          <div>
            <h2 className="text-sm font-semibold" style={{ color: "#e6edf3" }}>
              {groupName}
            </h2>
            <p className="text-xs" style={{ color: "#8b949e" }}>
              {FORMAT_LABEL[format] ?? format}
            </p>
          </div>
          <button
            data-testid="score-entry-close"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-1.5"
            style={{ background: "#21262d" }}
          >
            <X size={16} style={{ color: "#8b949e" }} />
          </button>
        </div>

        {/* Score body */}
        <div className="px-4 py-4">
          {isThreeWay && teams.length === 2 ? (
            <ThreeWaySelector
              teams={teams}
              scores={scores}
              onChange={handleScoreChange}
            />
          ) : (
            <PointsSelector
              teams={teams}
              scores={scores}
              format={format}
              onChange={handleScoreChange}
            />
          )}
        </div>

        {/* Footer */}
        <div className="border-t px-4 py-3" style={{ borderColor: "#30363d" }}>
          {submitMutation.error && (
            <p className="mb-2 text-xs" style={{ color: "#f85149" }}>
              {submitMutation.error.message}
            </p>
          )}
          <button
            data-testid="score-entry-submit"
            onClick={handleSubmit}
            disabled={submitMutation.isPending}
            className="flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold transition-opacity disabled:opacity-50"
            style={{ background: "#00d4aa", color: "#0d1117" }}
          >
            {submitMutation.isPending ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Check size={16} />
            )}
            Submit Score
          </button>
        </div>
      </div>
    </>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Three-Way Selector (Scramble, Sabotage, Match Play)
// Team A wins (1-0) / Halved (0.5-0.5) / Team B wins (0-1)
// ═════════════════════════════════════════════════════════════════════════════

interface ThreeWaySelectorProps {
  teams: TeamInfo[];
  scores: ScoreEntryResult[];
  onChange: (teamId: string, points: number) => void;
}

function ThreeWaySelector({ teams, scores, onChange }: ThreeWaySelectorProps) {
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
    <div className="space-y-3" data-testid="three-way-selector">
      <p className="text-center text-xs" style={{ color: "#8b949e" }}>
        Who won this group?
      </p>
      <div className="flex gap-2">
        {/* Team A wins */}
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

        {/* Halved */}
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

        {/* Team B wins */}
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

// ═════════════════════════════════════════════════════════════════════════════
// Points Selector (Stableford, Skins — numeric entry per team)
// ═════════════════════════════════════════════════════════════════════════════

interface PointsSelectorProps {
  teams: TeamInfo[];
  scores: ScoreEntryResult[];
  format: string;
  onChange: (teamId: string, points: number) => void;
}

function PointsSelector({ teams, scores, format, onChange }: PointsSelectorProps) {
  const isSkins = format === "skins";

  return (
    <div className="space-y-3" data-testid="points-selector">
      <p className="text-center text-xs" style={{ color: "#8b949e" }}>
        {isSkins ? "Enter skins won per team" : "Enter points per team"}
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
