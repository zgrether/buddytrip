"use client";

import { MatchEntryView } from "@/components/games/MatchEntryView";
import { MatchOutcomeEntryView } from "@/components/games/MatchOutcomeEntryView";
import {
  quickGameUnits,
  quickMatchGlorious,
  quickMatchGroupData,
  quickMatchId,
  QUICK_GAME_LABEL,
  type QuickMatchState,
} from "@/lib/quickGame";
import type { HoleOutcomeResult } from "@/lib/matchPlay";
import type { OutcomeValues } from "@/components/games/types";

/**
 * QuickMatchSurface — the entry surface for a local match, in whichever mode
 * the round was set up with.
 *
 * This is an ADAPTER, not a new view: both `MatchEntryView` (score entry) and
 * `MatchOutcomeEntryView` (hole-outcome entry) are already persistence-agnostic
 * (props in, callbacks out, zero tRPC — verified in Phase 0), so Quick Play
 * feeds them the same `MatchGroupData` the trip-side views build and gets both
 * modes with no second implementation of either. Nothing here teaches those
 * components about local storage, which is the constraint that matters.
 *
 * Glorious weighting comes from the SHARED `quickMatchGlorious`, which routes
 * through `gloriousConfig` and therefore inherits both of its guards (format,
 * and the score-mode refusal) rather than re-deciding them here.
 */
export function QuickMatchSurface({
  state,
  onScore,
  onClearScore,
  onOutcome,
  onClearOutcome,
  onHoleChange,
  onFinish,
  onBack,
  onOpenGrid,
  onConfig,
}: {
  state: QuickMatchState;
  onScore: (sideId: string, unitLabel: string, value: number) => void;
  onClearScore: (sideId: string, unitLabel: string) => void;
  onOutcome: (unitLabel: string, result: HoleOutcomeResult) => void;
  onClearOutcome: (unitLabel: string) => void;
  onHoleChange: (hole: number) => void;
  onFinish: () => void;
  onBack: () => void;
  onOpenGrid: () => void;
  onConfig: () => void;
}) {
  const units = quickGameUnits(state);
  const match = quickMatchGroupData(state);
  const glorious = quickMatchGlorious(state);

  if (state.entryMode === "outcome") {
    // `OutcomeValues` is keyed by MATCH then hole — an outcome belongs to the
    // match, not either side (the shape's own rule). A quick round has exactly
    // one match, so this is a one-key map.
    const values: OutcomeValues = { [quickMatchId(state)]: state.outcomes };
    return (
      <MatchOutcomeEntryView
        gameName={QUICK_GAME_LABEL.match}
        units={units}
        match={match}
        values={values}
        onChange={(_matchId, hole, result) => onOutcome(hole, result)}
        onClear={(_matchId, hole) => onClearOutcome(hole)}
        currentHole={state.currentHole}
        onHoleChange={onHoleChange}
        onFinish={onFinish}
        onBack={onBack}
        onOpenGrid={onOpenGrid}
        onConfig={onConfig}
        glorious={glorious}
        finishSubtext=""
      />
    );
  }

  return (
    <MatchEntryView
      gameName={QUICK_GAME_LABEL.match}
      units={units}
      matches={[match]}
      values={state.values}
      onChange={onScore}
      onClear={onClearScore}
      currentHole={state.currentHole}
      onHoleChange={onHoleChange}
      onFinish={onFinish}
      onBack={onBack}
      onOpenGrid={onOpenGrid}
      onConfig={onConfig}
      glorious={glorious}
      finishSubtext=""
    />
  );
}
