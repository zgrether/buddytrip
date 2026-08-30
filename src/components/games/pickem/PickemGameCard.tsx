"use client";

import type { CSSProperties, ReactNode } from "react";
import { TYPE_SCALE } from "@/lib/typeScale";
import { MatchupLine, pickemRowSurface, type MatchupLineGame } from "./slateRowVisual";

/**
 * ONE card for one contest, wherever it is shown (r7 §12).
 *
 * ── Three surfaces were drawing the same game three ways ──────────────────
 *
 * The picks sheet, the results page and the slate modal each rendered the same
 * sixteen contests in their own arrangement, with the spread, the kickoff and
 * the multiplier in different places and the tap targets in different shapes.
 * Nothing was wrong with any one of them; the cost was that a person moving
 * between the tabs re-parsed the same row three times.
 *
 * `slateRowVisual` already shared the STRIPE and the TEXT for two of them, and
 * this is the next thing up: the three-line arrangement itself.
 *
 *   line 1   the matchup, spread beside the home team, multiplier at the right
 *   line 2   day / date / time, with the note beside it
 *   line 3   the controls — four segments on the results page, two on the sheet
 *
 * Line 3 is a SLOT, because that is the one part that legitimately differs: a
 * runner marks an outcome and a picker takes a side. Everything above it is
 * identical by construction rather than by three files agreeing.
 *
 * ── The dim excludes the badge, which is the point of having a badge ───────
 *
 * A settled row fades to 0.38, and the `NOT PICKED` stamp used to fade with it
 * — CSS opacity multiplies, so a stamp inside a faded subtree cannot be made
 * legible again from the inside, whatever you set on it. It was a label nobody
 * could read on the rows that most needed one.
 *
 * So `badge` sits OUTSIDE the dimmed content. It is a slot rather than a
 * boolean for the same reason line 3 is: the surfaces stamp rows for different
 * reasons and this file should not have to know them.
 */

/** How far a settled row recedes. One number, so the surfaces cannot disagree
 *  about what "dealt with" looks like. */
export const SETTLED_DIM = 0.38;

export function PickemGameCard({
  game,
  leading,
  badge,
  settled = false,
  active = false,
  quiet = false,
  testId,
  style,
  children,
}: {
  game: MatchupLineGame;
  /** The rank chip, the ordinal — whatever numbers this row on this surface. */
  leading?: ReactNode;
  /**
   * A stamp about the ROW rather than the contest, rendered at full strength
   * over a settled card. See the note above for why it cannot live inside.
   */
  badge?: ReactNode;
  /** Dealt with, and receding. */
  settled?: boolean;
  /** Selected / being edited. */
  active?: boolean;
  /** Flatter resting state — see `pickemRowSurface`. */
  quiet?: boolean;
  testId?: string;
  style?: CSSProperties;
  /** Line 3. Omit for a card with no controls — the slate modal's rows. */
  children?: ReactNode;
}) {
  const dim: CSSProperties | undefined = settled ? { opacity: SETTLED_DIM } : undefined;
  return (
    <div
      data-testid={testId}
      className="flex flex-col gap-2"
      style={{
        ...pickemRowSurface({ weighted: (game.multiplier ?? 1) > 1, active, quiet }),
        borderRadius: 13,
        padding: "9px 11px 10px 13px",
        ...style,
      }}
    >
      <div className="flex items-start gap-2">
        {/* The dim wraps the CONTENT, not the card: the surface keeps its full
            border and stripe, so a settled weighted game still announces
            itself, and the badge below stays out of the fade entirely. */}
        <div className="flex min-w-0 flex-1" style={dim} data-testid="pickem-card-content">
          <MatchupLine game={game} leading={leading} />
        </div>
        {badge}
      </div>
      {children != null && <div style={dim}>{children}</div>}
    </div>
  );
}

/**
 * The contest's outcomes, or the picker's two sides — one control (r7 §12).
 *
 * ── Two surfaces, one shape, one difference ───────────────────────────────
 *
 * The runner marks away / home / push / void; the picker takes away or home.
 * That is the whole of it — same grid, same segment metrics, same selected
 * treatment — so the values are a PARAMETER rather than the reason for a second
 * component.
 *
 * The sheet's previous control was the team names themselves, tapped in place
 * on the matchup line. It was compact and it was a third tap target shape for
 * the same decision; §12 trades that compactness for one card. The names still
 * read as the matchup on line 1, so nothing is lost from the row — it is
 * repeated, deliberately, in the place where every other surface puts a
 * control.
 *
 * ── Deselect is the same gesture in both ──────────────────────────────────
 *
 * Tapping the selected segment clears it. The runner's version has always
 * worked that way and the sheet's did too (tapping your own pick cleared it),
 * so the shared control keeps it: `onSelect` receives `null` for a tap on the
 * current value. Without it the first tap on a row is irreversible, which is a
 * strange thing to be true of a sheet whose premise is that nothing is decided
 * until you decide it.
 */
export type SegmentValue = "away" | "home" | "push" | "cancelled";

/**
 * How a segment looks, given what it is and whether it is chosen.
 *
 * Tested directly because the DIFFERENCE between the two selected states is the
 * whole point and it lives entirely in these three values. A selected team is
 * accent; a selected Push or Void is a neutral fill.
 *
 * Push and cancelled score identically to each other (zero for everyone) and
 * are different FACTS — one happened and nobody covered, the other never
 * happened — but neither is a win, and painting them the way a team win is
 * painted would say a team did something.
 *
 * It lives HERE rather than on the results page because the picks sheet paints
 * its two segments the same way (r7 §12), and a second copy of the accent rule
 * is a second thing to keep in step.
 */
export function segmentStyle(value: SegmentValue, selected: boolean): CSSProperties {
  const team = value === "away" || value === "home";
  if (!selected) {
    return {
      background: "transparent",
      border: "1px solid transparent",
      color: "var(--color-bt-text)",
    };
  }
  return {
    background: team ? "var(--color-bt-accent-faint)" : "var(--color-bt-hover)",
    border: `1px solid ${team ? "var(--color-bt-accent-border)" : "var(--color-bt-border)"}`,
    color: team ? "var(--color-bt-accent)" : "var(--color-bt-text)",
  };
}

export function PickemSegments<V extends SegmentValue>({
  values,
  awayTeam,
  homeTeam,
  selected,
  busy = false,
  disabled = false,
  onSelect,
  testIdPrefix,
}: {
  values: readonly V[];
  awayTeam: string;
  homeTeam: string;
  selected: V | null;
  busy?: boolean;
  /** Read-only: the segments render, showing what was chosen, and take no tap.
   *  ABSENT would lose the answer; disabled keeps it and refuses the edit. */
  disabled?: boolean;
  onSelect: (value: V | null) => void;
  /** `pickem-run` on the results page, `pickem-pick` on the sheet — the two
   *  surfaces are asserted separately and a shared testid would let one test
   *  pass on the other's markup. */
  testIdPrefix: string;
}) {
  const label = (v: SegmentValue) =>
    v === "away" ? awayTeam : v === "home" ? homeTeam : v === "push" ? "Push" : "Void";
  return (
    <div
      className="grid gap-0.5"
      style={{
        /* The two fixed columns are for Push and Void, which are short words
           with fixed widths; the teams take what is left. A two-value control
           has no fixed columns and splits the row evenly. */
        gridTemplateColumns:
          values.length > 2 ? "1fr 1fr 52px 52px" : "1fr 1fr",
        background: "var(--color-bt-card-raised)",
        borderRadius: 11,
        padding: 2,
      }}
    >
      {values.map((v) => {
        const isSelected = selected === v;
        return (
          <button
            key={v}
            type="button"
            disabled={busy || disabled}
            onClick={() => onSelect(isSelected ? null : v)}
            data-testid={`${testIdPrefix}-${v}`}
            data-selected={isSelected ? "true" : "false"}
            /* Both surfaces are toggles — tapping the current value clears it —
               so the pressed state belongs in the accessibility tree. The
               sheet had this on its team targets and the results page never
               did; unifying the control unified that too. */
            aria-pressed={isSelected}
            /* `disabled:opacity-40` only while SAVING. A read-only sheet is
               disabled too, and fading it would put the whole answer behind a
               treatment that means "wait" — including the segment carrying the
               pick, which is the one thing a locked sheet exists to show. */
            className={busy ? "truncate px-1 disabled:opacity-40" : "truncate px-1"}
            style={{
              height: 34,
              borderRadius: 9,
              fontSize: TYPE_SCALE.bodyDense,
              fontWeight: isSelected ? 700 : 600,
              cursor: disabled ? "default" : "pointer",
              ...segmentStyle(v, isSelected),
            }}
          >
            {label(v)}
          </button>
        );
      })}
    </div>
  );
}
