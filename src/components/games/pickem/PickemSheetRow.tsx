"use client";

import { useEffect, useRef, useState } from "react";
import { type MatchupLineGame } from "./slateRowVisual";
import { PickemGameCard, PickemSegments, SELECT_HOLD_MS } from "./PickemGameCard";
import { PickemAbsenceNotice, NOT_PICKED } from "./PickemAbsenceNotice";
/* The RESULTS PANEL owns these. Importing rather than re-deriving is what keeps
   the sheet and the runner from wording or painting one row two ways — the same
   pattern PickemHeadToHead follows for matchPill/matchNote. */
import { resultEmphasis, resultTone, RESULT_LABEL } from "./PickemRunView";
import type { SlateResult } from "@/lib/pickemScoring";

/**
 * One game on the picks sheet — the shared card, with two segments on line 3.
 *
 * ── THIS REVERSES "the row IS the control", AND THE REVERSAL IS THE POINT ──
 *
 * The row used to make the team NAMES the tap targets: matchup and control in
 * one line, around 52px, so a sixteen-game slate was a list you scanned rather
 * than a stack you scrolled. That was written against an older sheet which
 * printed each name twice — once as text, once on a big button underneath — and
 * it was the right answer to that.
 *
 * r7 §12 asks a different question: the sheet, the results page and the slate
 * modal were rendering the same contest in three arrangements with three tap
 * target shapes, and moving between the tabs meant re-parsing the same row each
 * time. So the sheet takes the shared card, and its control goes where every
 * other surface puts one — line 3.
 *
 * ── What it costs, stated plainly ─────────────────────────────────────────
 *
 * Height. The row goes from about 52px to roughly double that, so a sixteen-game
 * slate is a longer scroll than it was, and the names are printed twice again —
 * the exact thing the old note was written to stop.
 *
 * The difference from the version it argued against is WHICH twice. That sheet
 * repeated the names in two places doing the same job, one of them a large
 * button carrying no other information. Here line 1 is the CONTEST — spread,
 * multiplier, kickoff, note, the things you read to decide — and line 3 is the
 * DECISION. They are not two attempts at one thing; the first is why you would
 * make the second.
 *
 * If the scroll turns out to matter more than the consistency, this note is the
 * argument on the other side and it has not been refuted — it was outweighed.
 *
 * ── Confidence OFF is a different product, not a disabled version ──────────
 *
 * With confidence off there is no rank chip and no grip, and nothing reorders:
 * slate order stands and every correct pick is worth 1 before the multiplier.
 * The row is not showing greyed-out controls — the concepts do not exist in
 * that variant, so neither do their affordances (§11's rule: absent, never
 * disabled). The GRIP is not rendered here at all; `ReorderableList` owns it and
 * is simply not enabled.
 */

export interface SheetRowGame extends MatchupLineGame {
  id: string;
  kickoff: string | null;
  note: string | null;
}

/**
 * What became of this pick, once the game has been played.
 *
 * Null while nothing is known — and null is the ONLY value that means that.
 * "void" is a decided outcome that paid nobody (a push, or a game pulled from
 * the scoring), which looks identical to "not played yet" in every number on
 * this row and means the opposite thing about what is left to come.
 *
 * ── "unpicked" is not a fifth kind of result — it is the ABSENCE of a pick ──
 *
 * It outranks all three, because it is knowable before the game is and stays
 * true after: nobody chose here. Without it an unpicked row on a closed sheet
 * rendered as plain, full-strength text — indistinguishable from a row still
 * waiting to be filled in, on a sheet that can never be filled in again. And
 * once the game resolved it rendered WORSE than blank: a struck-through stake,
 * which claims a bet that was never placed.
 *
 * The seventh instance of the family CLAUDE.md keeps counting, and the one that
 * arrived through the SHEET rather than through a number.
 */
export type PickOutcome = "won" | "lost" | "void" | "unpicked";

/**
 * The two sides, in slate order — away then home.
 *
 * A subset of the runner's four (r7 §12): a picker takes a side, and Push and
 * Void are outcomes of the contest that nobody wagers on. Same control, fewer
 * values, so the two surfaces cannot end up with different segment metrics or a
 * different selected treatment.
 */
const PICK_VALUES = ["away", "home"] as const;

/** Every outcome that is a RESULT — i.e. everything but the absence of a pick.
 *  Exported because the sheet decides the stake from it and the two must not
 *  disagree about which fates carry one. */
export function isPlayedOutcome(outcome: PickOutcome | null): boolean {
  return outcome != null && outcome !== "unpicked";
}

/**
 * The stamp on a row nobody picked.
 *
 * A BADGE beside the matchup rather than a treatment of the names, because the
 * fact is about the sheet and not about the teams — dimming the two names would
 * say the same thing the row's own fade already says, and say nothing about
 * why.
 *
 * Dashed, dim, and carrying no colour: this is not an error and not a loss. It
 * is a blank that has been named.
 *
 * ── IT RENDERS ABOVE THE DIM, NOT UNDER IT (r7 §12) ───────────────────────
 *
 * It used to sit inside the row, which fades to 0.38 once the game is settled —
 * and every row this stamp appears on is settled, because an unpicked row is
 * only worth naming after picking has closed. So the label was at 38% strength
 * on 100% of the rows that carried it. A badge you cannot read is not a badge.
 *
 * CSS opacity MULTIPLIES, so no value set here could have recovered it; the
 * stamp had to leave the faded subtree. `PickemGameCard` takes it as `badge` and
 * renders it outside.
 */
function NotPickedStamp() {
  /**
   * The SHARED notice — the same component the board's per-side `NO PICKS`
   * renders. This markup used to live here, and the board grew its own
   * `NOTHING SUBMITTED` pill in a different visual language for the same fact
   * at a different scale (no pick on one game / no sheet at all). One family,
   * so a reader who has learned the dashed stamp on their own sheet recognises
   * it on the board.
   *
   * `opaque` because this is the one instance that OVERLAPS something: it is
   * pinned to the same corner as the multiplier chip and sits over it, so it
   * has to occlude rather than let the chip show through. The board's copies
   * overlap nothing and stay unfilled.
   */
  return (
    <PickemAbsenceNotice label={NOT_PICKED} testId="pickem-row-not-picked" opaque />
  );
}


/**
 * The points this game carries, from its POSITION — and, once it has been
 * played, what became of them.
 *
 * The rank is the position — never stored beside it — so the chip renumbers as
 * the list moves and confidence cannot drift out of step with order.
 *
 * ── ONE number, three fates ────────────────────────────────────────────────
 *
 * The chip always shows the STAKE: what this position was worth, multiplier
 * included. What changes is the treatment — accent for points banked, struck
 * through for points missed, dim for a game that paid nobody.
 *
 * Showing the stake rather than the EARNED value is what makes the three
 * readable as one column. Earned would print 0 on both a miss and a push,
 * which is the same number for opposite facts, and it would make the wrong
 * picks vanish into a column of zeroes — the exact thing a person scanning a
 * finished sheet wants to find.
 *
 * The strike-through is the one that carries meaning without colour: a number
 * crossed out is a number that did not count, in any theme and at any size.
 *
 * ── AND IT STAYS HERE, WHERE THE HEAD-TO-HEAD DROPPED IT ───────────────────
 *
 * `PickemHeadToHead`'s confidence chip now DIMS a missed rank instead of
 * striking it, and the difference is deliberate rather than an oversight.
 *
 * The row this chip sits in is already at `opacity: 0.38` once settled (see the
 * row surface below). A chip that tried to say "missed" by fading further has
 * nothing left to fade against — it would read as absent rather than as spent.
 * The line still reads at 0.38, because it is a shape and not a contrast.
 *
 * The head-to-head's rows are flat and undimmed, so there the fade has room and
 * the LINE is what fails, at 11px across two tabular digits.
 *
 * Same question, opposite tools, because the surfaces underneath are opposite.
 * Unifying them costs this chip its meaning — if that is ever attempted, the
 * thing to change first is whether this row dims itself at all.
 */
function RankChip({
  points,
  picked,
  outcome,
}: {
  points: number;
  picked: boolean;
  outcome: PickOutcome | null;
}) {
  const banked = outcome === "won";
  const missed = outcome === "lost";
  return (
    <span
      data-testid="pickem-row-rank"
      data-outcome={outcome ?? "open"}
      className="flex shrink-0 items-center justify-center"
      style={{
        width: 28,
        height: 28,
        borderRadius: 8,
        fontSize: 13,
        fontWeight: 700,
        fontVariantNumeric: "tabular-nums",
        // A banked stake takes the SOLID accent — the only filled chip on the
        // sheet, so a scan down a played slate reads as the points that landed.
        background: banked
          ? "var(--color-bt-accent)"
          : outcome != null
            ? "transparent"
            : picked
              ? "var(--color-bt-accent-faint)"
              : "transparent",
        border: banked
          ? "1px solid var(--color-bt-accent)"
          : outcome != null
            ? "1px solid var(--color-bt-border)"
            : picked
              ? "1px solid var(--color-bt-accent-border)"
              : "1px dashed var(--color-bt-border)",
        color: banked
          ? "var(--color-bt-base)"
          : outcome != null
            ? "var(--color-bt-text-dim)"
            : picked
              ? "var(--color-bt-accent)"
              : "var(--color-bt-text-dim)",
        textDecoration: missed ? "line-through" : undefined,
      }}
    >
      {points}
    </span>
  );
}

export function PickemSheetRow({
  game,
  pick,
  points,
  outcome = null,
  result = null,
  editable,
  onPick,
}: {
  game: SheetRowGame;
  /** The chosen side, or null while nobody has been taken. */
  pick: "away" | "home" | null;
  /**
   * What this position is worth.
   *
   * Null when confidence is off AND the game is unplayed — the chip is then
   * ABSENT rather than showing a 1 nobody chose. Once a game HAS been played
   * the caller passes the stake either way, because with confidence off the
   * stake is still 1 times the multiplier and "what became of it" is the
   * question this row has stopped being able to answer without it.
   */
  points: number | null;
  /**
   * What became of the pick. Null while the game is unplayed, which is also
   * what the editable sheet always passes: dimming a row that can still be
   * tapped would read as disabled, and it is not.
   */
  outcome?: PickOutcome | null;
  /**
   * The GAME's outcome, as stored — distinct from `outcome`, which is what
   * became of THIS PICK. `pickOutcome` folds push and cancelled together into
   * `void` (both pay nobody), so the sheet could not tell them apart and drew a
   * cancellation as an ordinary settled row.
   */
  result?: SlateResult | null;
  editable: boolean;
  /** Null means "clear this game" — the row calls it when the SELECTED side is
   *  tapped again. */
  onPick: (side: "away" | "home" | null) => void;
}) {
  /**
   * ── OPEN STATE IS THE ROW'S OWN, and that is what makes the close work ────
   *
   * Held here rather than by the sheet, because the sheet re-renders on every
   * keystroke of the draft — a pick writes straight into it — and open state
   * hanging off that would be reset by the very action it is animating.
   * Locally it survives, because React updates this instance in place.
   *
   * Independent per row rather than one-at-a-time. A pick closes its own row
   * anyway, so the accordion never needs policing, and closing somebody's row
   * because they opened another is a rule with no work to do.
   */
  const [open, setOpen] = useState(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A row can be unmounted mid-hold — tab away, or the sheet re-sorts on a
  // reorder — and a timer firing into a dead instance is a React warning and a
  // leak.
  useEffect(
    () => () => {
      if (holdTimer.current) clearTimeout(holdTimer.current);
    },
    []
  );

  const handlePick = (side: "away" | "home" | null) => {
    // The pick goes up IMMEDIATELY. The hold is a display decision and must
    // never sit between somebody tapping and the draft recording it.
    onPick(side);
    if (holdTimer.current) clearTimeout(holdTimer.current);
    /**
     * CLEARING does not close. Tapping your current pick to clear it means you
     * are changing your mind, so the control you need next is the one you are
     * looking at — shutting it would make the second choice cost another tap.
     */
    if (side != null) {
      holdTimer.current = setTimeout(() => setOpen(false), SELECT_HOLD_MS);
    }
  };

  return (
    <PickemGameCard
      testId="pickem-sheet-row"
      game={game}
      /**
       * ── THE PICK IS READABLE WITH THE ROW SHUT ────────────────────────────
       *
       * This is what makes collapsing by default honest rather than hiding the
       * answer: the chosen side's NAME takes the accent, so a closed sixteen-row
       * sheet can be read straight down without opening anything.
       *
       * `chosen` on both phases, settled rows included. The row's FATE is the
       * rank chip's job — filled, struck, outlined — and painting the name by
       * outcome here would put the results page's vocabulary on the sheet,
       * where the question is what you took rather than how it went.
       */
      /**
       * ── A CANCELLED GAME IS STRUCK, EXACTLY AS THE RESULTS PANEL DRAWS IT ──
       *
       * The sheet used to say nothing about a cancellation: the row dimmed
       * (every settled row does), the pick stayed teal, and the chip kept its
       * number — so a game struck from the scoring read as an ordinary pick you
       * happened not to score on. The results panel had it right all along;
       * this is the same treatment, from the SAME functions, so the two
       * surfaces cannot word or paint one row two ways.
       *
       * ONLY cancellation overrides the pick's accent, and the line is where a
       * fact about the GAME outranks a fact about the SHEET. A push happened
       * and nobody covered — your pick still stood, so it keeps its colour and
       * the chip's dim carries the outcome. A cancelled contest was removed;
       * there is nothing left for a pick to have been.
       */
      awayEmphasis={
        result === "cancelled" ? resultEmphasis(result).away : pick === "away" ? "chosen" : "none"
      }
      homeEmphasis={
        result === "cancelled" ? resultEmphasis(result).home : pick === "home" ? "chosen" : "none"
      }
      /**
       * The status line replaces the kickoff, and ONLY for a cancellation.
       *
       * Not for every settled game: the chip already carries "banked / missed /
       * paid nobody" for those, and a "Final" on all sixteen rows would be a
       * column of the same word. Cancellation is the one outcome the chip alone
       * misreports — it shows a stake on a game that scored nothing — so it is
       * the one that earns a line of its own.
       */
      status={
        result === "cancelled"
          ? { text: RESULT_LABEL[result], tone: resultTone(result) }
          : undefined
      }
      /**
       * ── A LOCKED ROW DOES NOT OPEN ────────────────────────────────────────
       *
       * The disclosure exists to reveal the two pick buttons. Once picks close
       * those buttons are `disabled`, so an expandable row opened onto two
       * dead controls — which is worse than a row that does not move, because
       * it costs a tap to discover there is nothing there.
       *
       * `editable` is the same predicate the segments already read for
       * `disabled`, so the affordance and the control cannot disagree about
       * whether this sheet can be edited — the "two booleans that must always
       * agree" shape (#24) is avoided by there being one.
       *
       * The PICK is still readable with the row shut: the chosen side's name
       * carries the accent, which is what made collapsing-by-default honest in
       * the first place. So nothing is hidden by refusing to open — only an
       * empty gesture is removed.
       */
      onHeaderTap={editable ? () => setOpen((v) => !v) : undefined}
      headerTestId="pickem-sheet-disclosure"
      headerOpen={open}
      collapsible={{ open: editable && open }}
      /**
       * ONE dim, on the row's content, chip included.
       *
       * An early version faded everything BESIDE the chip and left the chip at
       * full strength, on the reasoning that the stake is the reason to look at
       * a played row. On screen that made the chip a third kind of bright
       * number — beside the live rows' accent chips and the unplayed rows'
       * outlined ones — so a finished slate had three brightnesses competing
       * and the settled rows read as the loudest thing on it.
       *
       * The chip does not need brightness to stay legible: its three fates are
       * carried by SHAPE — a filled disc, a strike-through, a plain outline —
       * and those survive the fade where a brightness contest does not.
       *
       * The `NOT PICKED` stamp is the one exception, and it is not an exception
       * to this argument: it carries no shape that survives, only words.
       */
      settled={outcome != null}
      leading={
        points != null ? (
          <RankChip points={points} picked={pick !== null} outcome={outcome} />
        ) : undefined
      }
      badge={outcome === "unpicked" ? <NotPickedStamp /> : undefined}
    >
      <PickemSegments
        values={PICK_VALUES}
        awayTeam={game.awayTeam}
        homeTeam={game.homeTeam}
        selected={pick}
        disabled={!editable}
        /* Tapping the side you already took CLEARS it — `PickemSegments` sends
           null for a tap on the current value, which is what the team targets
           did before and what the runner's four-segment version has always
           done. */
        onSelect={(side) => handlePick(side)}
        testIdPrefix="pickem-pick"
      />
    </PickemGameCard>
  );
}
