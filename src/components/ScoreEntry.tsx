"use client";

import { useState, useCallback } from "react";
import { X, Check, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { ScrambleFormat } from "./scoring-formats/ScrambleFormat";
import { StablefordFormat } from "./scoring-formats/StablefordFormat";
import { SabotageFormat } from "./scoring-formats/SabotageFormat";
import { SkinsFormat } from "./scoring-formats/SkinsFormat";

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

  const renderFormat = () => {
    switch (format) {
      case "scramble":
      case "match_play":
        return <ScrambleFormat teams={teams} scores={scores} onChange={handleScoreChange} />;
      case "sabotage":
        return <SabotageFormat teams={teams} scores={scores} onChange={handleScoreChange} />;
      case "stableford":
      case "singles":
        return <StablefordFormat teams={teams} scores={scores} onChange={handleScoreChange} />;
      case "skins":
        return <SkinsFormat teams={teams} scores={scores} onChange={handleScoreChange} />;
      default:
        return <StablefordFormat teams={teams} scores={scores} onChange={handleScoreChange} />;
    }
  };

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

        {/* Score body — format-specific component */}
        <div className="px-4 py-4">
          {renderFormat()}
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

