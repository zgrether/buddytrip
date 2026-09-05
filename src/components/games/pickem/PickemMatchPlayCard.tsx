"use client";

import { MatchCard } from "@/components/games/MatchCard";
import { PickemAbsenceNotice, NO_PICKS } from "./PickemAbsenceNotice";
import { pickemCardModel, pickemWeightedUnit } from "@/lib/pickemMatchCard";
import type { BoardRow } from "@/lib/pickemBoard";
import type { BoardSlateGame } from "./PickemBoard";
import type { SidesPicked } from "./PickemMatchCard";

/**
 * A pick'em head-to-head, drawn by the SHARED match-play card.
 *
 * ── This is an adoption, not a lookalike ──────────────────────────────────
 *
 * The previous pick'em card was a flat strip with a score at each end and a
 * continuous progress bar. It had match play's COLOURS and none of its
 * STRUCTURE, which is what "adopt the vocabulary, not the component" was taken
 * to mean and is not what it meant. A parallel card would give every future
 * change to match play's presentation a second home to be forgotten in — the
 * exact class `MatchCard` was extracted to end.
 *
 * So this renders `MatchCard` itself. Everything it draws — the header, the
 * margin chip, the name block, the segment bar, DORMIE and the close-out
 * margin — is golf's, computed by golf's engine, from pick'em's numbers.
 *
 * ── What made that possible ───────────────────────────────────────────────
 *
 * `matchState` used to weight units by calling `holeWeight` directly, which
 * baked in three of golf's assumptions: a `1 | 2` return, a POSITIONAL
 * selector, and a hardcoded 18. Pick'em violates all three (weights to 4×,
 * chosen per game, over a 16-game slate). One `weightOf` function removed all
 * three, and `pickemCardModel` is the adapter that supplies it. There is no
 * second scoring implementation.
 *
 * ── The margin chip carries the lead; the bar carries the shape ───────────
 *
 * The strip printed both raw totals, on the argument that 8-7 and 1-0 are both
 * "1 UP" and are not the same match. That argument is real and it is answered
 * HERE by the segment bar rather than by two numbers: with confidence off every
 * unit is one game, so the row of segments shows exactly how the lead was
 * built — which is more than the two totals said and is the reason a segment
 * bar is worth having at all. The objection stands for the confidence-ON case,
 * which is why that case keeps the strip.
 */
export function PickemMatchPlayCard({
  matchNumber,
  aName,
  bName,
  slate,
  rows,
  aColor,
  bColor,
  picked,
  mine,
  onOpen,
}: {
  matchNumber: number;
  aName: string;
  bName: string;
  slate: BoardSlateGame[];
  rows: BoardRow[];
  aColor: string | null;
  bColor: string | null;
  picked: SidesPicked;
  mine: boolean;
  onOpen: () => void;
}) {
  const model = pickemCardModel(slate, rows);

  return (
    <div className="flex flex-col" style={{ gap: 4 }}>
      <MatchCard
        /* `color` is `Participant`'s identity colour. The CARD paints from
           `leftColor`/`rightColor`, so this is only the fallback the neutral
           build would use; passing the team colour keeps the two consistent. */
        a={{ id: "a", name: aName, color: aColor ?? "" }}
        b={{ id: "b", name: bName, color: bColor ?? "" }}
        results={model.results}
        holeCount={model.unitCount}
        /* The seam. Golf passes a trailing-window config and nothing here;
           pick'em passes the multiplier off each game's own row. */
        isWeightedUnit={pickemWeightedUnit(model)}
        decidedStake={model.decidedStake}
        label={`MATCH ${matchNumber}`}
        /* No "· 1v1" suffix — a pick'em match is always one sheet against one
           sheet, so the format word would be noise on every card. */
        hideFormat
        /* `leftColor`/`rightColor` are what turn the margin chip and the segment
           bar from the neutral value-ramp into team colours. Null is an ordinary
           case (a player with no team), and `MatchCard` already falls back to
           its own neutral treatment for it. */
        leftColor={aColor ?? undefined}
        rightColor={bColor ?? undefined}
        youId={mine ? "a" : undefined}
        onClick={onOpen}
      />

      {/* ── THE ABSENCE STAYS OUTSIDE THE CARD ───────────────────────────────
          `MatchCard` has no slot for it and should not grow one: a missing
          SHEET is a pick'em concept with no golf analogue, and pushing it into
          the shared card would put a format-specific state in the one place
          both formats read.

          Under the side it belongs to, never centred — centred between two
          names it names neither, which is the defect this replaced. The
          notice is the same `PickemAbsenceNotice` the sheet's NOT PICKED
          uses: one family. */}
      {(!picked.a || !picked.b) && (
        <span className="flex items-center gap-2 px-1">
          <span className="flex min-w-0 flex-1">
            {!picked.a && (
              <PickemAbsenceNotice label={NO_PICKS} testId="pickem-mp-nopicks-a" />
            )}
          </span>
          <span className="flex min-w-0 flex-1 justify-end">
            {!picked.b && (
              <PickemAbsenceNotice label={NO_PICKS} testId="pickem-mp-nopicks-b" />
            )}
          </span>
        </span>
      )}
    </div>
  );
}
