"use client";

import type { CSSProperties, ReactNode } from "react";
import { TYPE_SCALE } from "@/lib/typeScale";
import {
  MatchupLine,
  pickemRowSurface,
  type MatchupLineGame,
  type SideEmphasis,
  type StatusTone,
} from "./slateRowVisual";

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

/**
 * The collapse timings, exported so the row that schedules the close and the
 * card that performs it cannot disagree about how long it takes.
 *
 * `HOLD` is the part with a reason rather than a taste: it is how long the
 * chosen segment stays on screen AFTER it turns accent, and it exists because
 * a row that starts closing in the same frame the selection lands never shows
 * the pick at all. 150ms of selection fade inside a 400ms hold leaves a
 * quarter-second where the answer is simply readable.
 */
export const COLLAPSE_MS = 280;
export const SELECT_HOLD_MS = 400;

/** The cap on an animating body. Must exceed the tallest `children` any card
 *  holds — one segment control, or a control plus a link — or it clips with no
 *  error. Several times either. */
const COLLAPSE_MAX_HEIGHT = 200;

/**
 * The card's top row — a plain row, or a disclosure button when the surface
 * wants tapping the matchup to open something.
 *
 * ── Why the button wraps the HEADER and not the card ──────────────────────
 *
 * The obvious shape is to wrap the whole card in a `<button>` and be done. It
 * is wrong the moment the card is open: `children` is the control the tap
 * REVEALS — segments, a Clear link — so the open state would nest buttons
 * inside a button. That is invalid, and browsers resolve it by dropping one,
 * which means the thing that breaks is the control rather than the disclosure.
 *
 * So the tap target is the header row only, and `children` stays a sibling of
 * it inside the same bordered box. The card still reads as one object; only
 * the top of it is pressable.
 */
function header({
  onTap,
  headerTestId,
  headerOpen,
  children,
}: {
  onTap?: () => void;
  headerTestId?: string;
  headerOpen?: boolean;
  children: ReactNode;
}) {
  if (!onTap) {
    return <div className="flex items-start gap-2">{children}</div>;
  }
  return (
    <button
      type="button"
      onClick={onTap}
      data-testid={headerTestId}
      data-open={headerOpen ? "true" : "false"}
      aria-expanded={headerOpen}
      className="flex w-full items-start gap-2 text-left"
    >
      {children}
    </button>
  );
}

export function PickemGameCard({
  game,
  leading,
  badge,
  awayEmphasis,
  homeEmphasis,
  status,
  onHeaderTap,
  headerTestId,
  headerOpen,
  collapsible,
  settled = false,
  active = false,
  quiet = false,
  testId,
  style,
  children,
}: {
  game: MatchupLineGame;
  /** Passed straight through to `MatchupLine` — the card holds no opinion
   *  about what a name is saying, only about where it sits. */
  awayEmphasis?: SideEmphasis;
  homeEmphasis?: SideEmphasis;
  status?: { text: string; tone: StatusTone };
  /** Makes the header row a disclosure button — see `header`. Absent leaves it
   *  a plain row, which is what every surface but the entered results list
   *  wants. */
  onHeaderTap?: () => void;
  headerTestId?: string;
  headerOpen?: boolean;
  /**
   * Renders `children` inside a COLLAPSING container instead of mounting and
   * unmounting them.
   *
   * ── Why not just `{open && children}` ─────────────────────────────────────
   *
   * Because the whole point is that the pick visibly LANDS before the row
   * shuts. Conditional mounting gives you no closing frame at all — the
   * control is there and then it is not — so the 400ms hold would be 400ms of
   * nothing followed by a jump cut.
   *
   * The element therefore stays mounted and animates its height. That also
   * makes the row's re-render harmless: React updates the selected segment in
   * place on a DOM node that never moves, so the 150ms selection fade and the
   * 280ms collapse both run to completion. (The row cannot be reordered by a
   * pick either — its position comes from the slate index, not from its
   * contents.)
   *
   * `maxHeight` rather than `height`, since the content's height is not known
   * here — with the cost that the cap must exceed the tallest body this card
   * ever holds or it silently clips. The bodies are one segment control and,
   * on the results page, a control plus a link; 200px is several times either.
   */
  collapsible?: { open: boolean };
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
      /* No flex GAP when collapsing: a zero-height body still takes its share
         of a gap, so a closed row would sit 8px taller than it should and the
         collapse would stop 8px short of shut. The body carries the spacing as
         its own padding instead, and animates it away with everything else.

         `relative` so `badge` can be pinned to the card's own corner — see the
         badge slot below. */
      className={`relative ${collapsible ? "flex flex-col" : "flex flex-col gap-2"}`}
      style={{
        ...pickemRowSurface({ weighted: (game.multiplier ?? 1) > 1, active, quiet }),
        borderRadius: 13,
        padding: "9px 11px 10px 13px",
        ...style,
      }}
    >
      {/* The dim wraps the CONTENT, not the card: the surface keeps its full
          border and stripe, so a settled weighted game still announces
          itself, and the badge below stays out of the fade entirely. */}
      {header({
        onTap: onHeaderTap,
        headerTestId,
        headerOpen,
        children: (
          <div className="flex min-w-0 flex-1" style={dim} data-testid="pickem-card-content">
            <MatchupLine
              game={game}
              leading={leading}
              awayEmphasis={awayEmphasis}
              homeEmphasis={homeEmphasis}
              status={status}
            />
          </div>
        ),
      })}
      {/* ── THE BADGE OVERLAPS THE MULTIPLIER; IT DOES NOT PUSH IT ──────────
          It used to be a flow sibling of the matchup, so on a row that was both
          weighted AND unpicked it took its own width, the matchup's box shrank,
          and the multiplier — which is pinned to the RIGHT of that box — slid
          left. The one badge whose whole purpose is to sit in the same place on
          every row moved, and it moved only on the rows carrying a second
          badge.

          Both are now pinned to the card's top-right and the stamp sits OVER
          the chip. That is Zach's call and the reasoning is that the multiplier
          is background information by then: it says what the game was worth,
          and on a row you did not pick it is worth nothing to you.

          It stays OUTSIDE the dimmed content for the reason the note at the top
          of this file gives — opacity multiplies, so a stamp inside a settled
          row's fade cannot be made legible from the inside. */}
      {badge && (
        <span
          data-testid="pickem-card-badge"
          /* `flex` so the inline stamp's border box starts at the slot's top.
             Without it the stamp sat 5px lower than the chip it covers, and an
             opaque badge that is 5px out lets the top edge of the chip peek
             above it — which reads as a rendering fault rather than as one
             badge over another. */
          className="absolute flex"
          style={{ top: 9, right: 11, zIndex: 1 }}
        >
          {badge}
        </span>
      )}

      {children != null &&
        (collapsible ? (
          <div
            data-testid="pickem-card-body"
            data-open={collapsible.open ? "true" : "false"}
            /* `aria-hidden` while shut, so a screen reader is not offered a
               control the sighted reader cannot see. The header carries
               `aria-expanded`, which is what announces there is something to
               open. */
            aria-hidden={!collapsible.open}
            style={{
              ...dim,
              overflow: "hidden",
              maxHeight: collapsible.open ? COLLAPSE_MAX_HEIGHT : 0,
              opacity: collapsible.open ? 1 : 0,
              paddingTop: collapsible.open ? 8 : 0,
              transition:
                `max-height ${COLLAPSE_MS}ms ease, opacity 200ms ease, padding-top ${COLLAPSE_MS}ms ease`,
            }}
          >
            {children}
          </div>
        ) : (
          <div style={dim}>{children}</div>
        ))}
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
    /**
     * ── EACH SEGMENT CARRIES ITS OWN EDGE ─────────────────────────────────
     *
     * The unselected border was `transparent`, so four controls sat inside one
     * shaded tray with nothing between them and read as a panel of TEXT rather
     * than as four buttons. Reported from a device, and it is the kind of thing
     * only a device reports: every segment was individually correct, tappable
     * and correctly labelled, and the defect was that nothing said so.
     *
     * A visible edge on the resting state, the same `--color-bt-border` every
     * other control in the app uses. The tray behind them stays — with borders
     * on the segments it reads as a segmented control rather than a box of
     * words.
     *
     * Applies to the picks sheet's two segments as well as the runner's four:
     * r7 §12 made them ONE control deliberately, and giving the four an
     * affordance the two lack would start them drifting apart again.
     */
    return {
      background: "transparent",
      border: "1px solid var(--color-bt-border)",
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
    v === "away" ? awayTeam : v === "home" ? homeTeam : v === "push" ? "Push" : "Cancelled";

  /**
   * ── THE FOUR NO LONGER SHARE A ROW, AND THAT IS THE TRUNCATION FIX ────────
   *
   * They used to: `1fr 1fr 52px 52px`, on the reasoning that Push and Void are
   * short words deserving small fixed columns while the teams take the rest.
   * The arithmetic does not survive a real slate. At 390px the card's content
   * box is about 340px, so after 104px of fixed columns and the gaps the two
   * teams get roughly 115px EACH — which holds "Toledo" and loses
   * "Michigan State Spartans" entirely. That is the reported bug, and it is
   * worst on exactly the surface where the names matter most, because the
   * runner is matching them against a scoreboard.
   *
   * Teams now take a full-width row of their own and the two outcomes sit
   * beneath them. Same control, same values, same toggle — the four are still
   * alternatives and still one group — but a team name gets ~165px instead of
   * ~115px.
   *
   * The second row is quieter (30px against 34px, caption against bodyDense):
   * Push and Cancelled are rare, and a control whose common case is visually
   * primary reads faster than four equal buttons. `segmentStyle` was already
   * making that distinction in COLOUR; this makes it in size too, which is the
   * same statement rather than a second one.
   *
   * A TWO-value control is untouched — one row, split evenly, as before.
   */
  const teams = values.filter((v) => v === "away" || v === "home");
  const outcomes = values.filter((v) => v === "push" || v === "cancelled");

  const segment = (v: V, secondary: boolean) => {
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
          height: secondary ? 30 : 34,
          borderRadius: 9,
          fontSize: secondary ? TYPE_SCALE.caption : TYPE_SCALE.bodyDense,
          fontWeight: isSelected ? 700 : 600,
          cursor: disabled ? "default" : "pointer",
          /* The selection FADES IN rather than snapping, so that on a row which
             then closes itself the eye has something to follow. Colour only —
             animating the border WIDTH would shift the label a pixel as it
             lands, which reads as a wobble at this size. */
          transition: "background-color 150ms ease, color 150ms ease, border-color 150ms ease",
          ...segmentStyle(v, isSelected),
        }}
      >
        {label(v)}
      </button>
    );
  };

  return (
    <div
      className="grid gap-0.5"
      data-testid={`${testIdPrefix}-segments`}
      style={{
        gridTemplateColumns: "1fr 1fr",
        background: "var(--color-bt-card-raised)",
        borderRadius: 11,
        padding: 2,
      }}
    >
      {teams.map((v) => segment(v, false))}
      {outcomes.length > 0 && (
        /* `col-span-2` then its own even split, rather than four cells in one
           grid: the two rows have different metrics, and a single grid would
           have to give both rows the taller row's height. */
        <div className="col-span-2 grid gap-0.5" style={{ gridTemplateColumns: "1fr 1fr" }}>
          {outcomes.map((v) => segment(v, true))}
        </div>
      )}
    </div>
  );
}
