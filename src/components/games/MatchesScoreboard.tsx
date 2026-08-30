"use client";

import { OutcomeChoiceRow } from "./OutcomeChoiceRow";
import type { SidePlayer } from "./MatchSides";
import { TYPE_SCALE, EYEBROW } from "@/lib/typeScale";

/** One match, ready for result entry — resolved players + its current result. */
export interface MatchScoreRow {
  id: string;
  number: number;
  aPlayers: SidePlayer[];
  bPlayers: SidePlayer[];
  result: "a_win" | "b_win" | "halve" | null;
}

/**
 * Non-golf Matches' result entry — the scoreboard-page counterpart to the
 * settings-page pairing grid (`MatchesAccordionRow`) and override panel
 * (`MatchPointsRow`), same reuse instinct as both of those: `OutcomeChoiceRow`
 * is the shared three-way picker `MatchOutcomeEntryView` uses for a HOLE
 * (side A / Halved / side B); this is that exact component, once per MATCH
 * instead of once per hole — golf resolves a hole, this resolves a match, same
 * question about a different subject (Phase 0 §2.1).
 *
 * ── Why this is a list of rows, not a single control ────────────────────────
 * The Simple format's `NonGolfMatchControl` (same file, `OutcomeChoiceRow` x3)
 * declares ONE outcome for the whole game. Matches declares N of them — one
 * per match — so this is N copies of that exact shape stacked, not a
 * generalisation of it. Each match keeps its own `selected`/`dim` state,
 * independent of every other match's.
 *
 * ── What it does NOT do ──────────────────────────────────────────────────
 * No outbox, no local optimistic durability (CLAUDE.md #15) — `onPick` calls
 * straight through to the mutation, mirroring golf's OWN outcome-mode hole
 * entry (`matchOutcomes.upsertOutcome`), which has neither either: outcome
 * declaration is a discrete, idempotent write (tap again to change it), not
 * the per-hole gross-score stream #15's outbox exists to protect against
 * losing mid-entry.
 */
export function MatchesScoreboard({
  matches,
  onPick,
  canEdit,
}: {
  matches: MatchScoreRow[];
  onPick: (matchId: string, result: "a_win" | "b_win" | "halve") => void;
  canEdit: boolean;
}) {
  if (matches.length === 0) {
    return (
      <div className="flex flex-col gap-2 px-1" data-testid="matches-scoreboard-empty">
        <span style={EYEBROW}>Matches</span>
        <span style={{ fontSize: TYPE_SCALE.bodyDense, color: "var(--color-bt-text-dim)" }}>
          No matches paired yet — set them up in Settings.
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="matches-scoreboard">
      {matches.map((m) => (
        <div key={m.id} className="flex flex-col gap-1.5" data-testid={`matches-scoreboard-match-${m.id}`}>
          <span style={EYEBROW}>Match {m.number}</span>
          <div role="radiogroup" aria-label={`Match ${m.number} outcome`} className="flex flex-col" style={{ gap: 9 }}>
            <OutcomeChoiceRow
              selected={m.result === "a_win"}
              dim={m.result != null && m.result !== "a_win"}
              color={m.aPlayers[0]?.teamColor ?? undefined}
              avatarName={m.aPlayers[0]?.name}
              label={m.aPlayers.length > 1 ? m.aPlayers.map((p) => p.name).join(" & ") : (m.aPlayers[0]?.name ?? "Side A")}
              players={m.aPlayers}
              onClick={() => onPick(m.id, "a_win")}
              disabled={!canEdit}
              testId={`match-${m.id}-win-a`}
            />
            <OutcomeChoiceRow
              selected={m.result === "halve"}
              dim={m.result != null && m.result !== "halve"}
              neutral
              label="Halved"
              onClick={() => onPick(m.id, "halve")}
              disabled={!canEdit}
              testId={`match-${m.id}-draw`}
            />
            <OutcomeChoiceRow
              selected={m.result === "b_win"}
              dim={m.result != null && m.result !== "b_win"}
              color={m.bPlayers[0]?.teamColor ?? undefined}
              avatarName={m.bPlayers[0]?.name}
              label={m.bPlayers.length > 1 ? m.bPlayers.map((p) => p.name).join(" & ") : (m.bPlayers[0]?.name ?? "Side B")}
              players={m.bPlayers}
              onClick={() => onPick(m.id, "b_win")}
              disabled={!canEdit}
              testId={`match-${m.id}-win-b`}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
