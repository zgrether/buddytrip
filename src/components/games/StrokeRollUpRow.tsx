"use client";

import { FormatCards } from "@/components/games/FormatCards";
import type { StrokeRollUp } from "@/lib/strokeGameConfig";

/**
 * HOW THE BOARD READS — individual scores, or team totals.
 *
 * ── Why this exists, in the runner's words ──────────────────────────────────
 *
 * The field is handicapped by skill tier: the four A golfers aligned, the four
 * B golfers aligned, and so on, to keep it competitive. Individual scoring then
 * puts 1st, 2nd and 3rd all among the A's — so the cup is played on team
 * totals. That is a consequence of how the field is set up, not a preference.
 *
 * ── A DISPLAY choice, so no lock ────────────────────────────────────────────
 *
 * Deliberately NOT gated on `locked` the way `StrokeScoringRow` is. The scoring
 * type is frozen once scores exist (`SCORING_TYPE_LOCKED`, migration 179)
 * because a card rescored after the fact was played to a different rubric.
 * Nothing analogous applies here: both result sets are computed and banked on
 * every finalize regardless — `computeStrokePlayResults` writes the `user` rows
 * AND the `team` rows in one atomic replace, unconditionally — so this picks
 * which of two already-existing answers the board shows. Switching mid-round
 * changes a screen, not a score.
 *
 * A refusal here would also be one the reader could do nothing about, which is
 * the shape CLAUDE.md's refusal rule names: the condition that would freeze it
 * (scores exist) is cleared only by wiping the round.
 *
 * ── Applies to BOTH scoring types ───────────────────────────────────────────
 *
 * Traditional stroke play on team totals is as valid as Stableford on them, so
 * this row renders whatever `StrokeScoringRow` above it says. The two are
 * independent axes and the copy avoids naming either format.
 */
export function StrokeRollUpRow({
  value,
  canEdit,
  onChange,
}: {
  value: StrokeRollUp;
  canEdit: boolean;
  onChange: (next: StrokeRollUp) => void;
}) {
  return (
    // No horizontal padding, matching `StrokeScoringRow` — the neighbouring
    // settings rows are cards that span this container edge to edge, and an
    // inset here would make these tiles visibly narrower than every card above.
    <div className="flex flex-col gap-2" data-testid="stroke-rollup-row">
      <span
        className="text-[10px] font-bold uppercase"
        style={{ letterSpacing: "0.08em", color: "var(--color-bt-text-dim)" }}
      >
        Board
      </span>
      <FormatCards
        testIdPrefix="stroke-rollup"
        value={value}
        disabled={!canEdit}
        onChange={onChange}
        cards={[
          {
            key: "individual",
            title: "Individual scores",
            body: "Every player ranked against the field.",
          },
          {
            key: "team_totals",
            title: "Team totals",
            body: "Teams ranked on their players' combined scores.",
          },
        ]}
      />
    </div>
  );
}
