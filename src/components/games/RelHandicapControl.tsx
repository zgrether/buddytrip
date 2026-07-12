"use client";

import { useEffect, useRef, useState } from "react";
import { strokeHoles } from "@/lib/matchPlay";
import { Stepper } from "@/components/games/Stepper";
import { RowNumber } from "@/components/games/RowNumber";
import { SideChips, type SidePlayer } from "@/components/games/MatchSides";

/** One side of the handicap control: its players (stacked chips, A2a) + a display
 *  name for the stroke caption ("{name} gets strokes on holes …"). */
export interface HandicapSide {
  players: SidePlayer[];
  name: string;
}

/**
 * RelHandicapControl — the relative-handicap control for 1v1 (Slice B §6, as
 * amended by Spec Addendum B-1; restyled in W-GAMEPAGE visual pass P-D §8). A
 * segmented direction selector + a STEPPER — no draggable slider (a ±18 span is
 * undraggable one-thumbed in the sun; the number matters most in the big-mismatch
 * case, exactly where a bare slider fails).
 *
 * Look (§8, as revised by the row-pattern Phase 3): the row shares the Matches
 * skeleton — a RowNumber gutter + the shared PlayerChip (avatar 30, left-aligned) —
 * with a `[A│Even│B]` segmented selector. The selected segment is a TEAL FILL (faint
 * wash + teal border), the scoped selection-state treatment for segmented selectors
 * (vocabulary §1/§8); unselected segments are the recessed card-raised chip. The
 * per-row "WHO GETS STROKES?" header is gone; the match number rides the gutter.
 * Reveal is altitude-aware: Even is just the row (no stepper, no caption); a side
 * selected reveals the <Stepper full> + a muted recipient caption.
 *
 * Same data model (NO behavior change — P-D is appearance + layout only): one
 * signed value, strokes to exactly ONE side, never split.
 *   value < 0 → left (a) gets |value|;  value > 0 → right (b) gets value;  0 = even.
 * The parent persists it as the two per-user `game_participants.handicap_strokes`
 * counts (recipient = n, other = 0) — NOT `games.modifiers.buddy_rules` (Slice F).
 */

// Single source of truth for the magnitude cap. To raise this above 18,
// `strokeHoles` must first allocate a 2nd stroke per round on the hardest holes
// (it caps at 18 today, and returns a Set so a hole can't be struck twice) —
// otherwise strokes 19+ silently produce no extra pips. See Spec Addendum B-1.
const MAX = 18;

/** The pure reveal view-model (§8) — pure so the altitude-aware reveal is unit-
 *  testable apart from render: which side is selected, the recipient, the holes,
 *  whether the stepper shows, and the muted caption. `recipient` is null when even. */
export interface RelHandicapView {
  side: "a" | "b" | "even";
  n: number;
  even: boolean;
  recipient: string | null;
  holes: number[];
  /** The muted recipient caption ("{recipient} gets strokes on holes …"), shown only
   *  for a stroked side. EMPTY for Even — the selected Even segment already says it,
   *  so an Even match is just the row (P3b dropped "Even match — no strokes given"). */
  caption: string;
  /** Even → no stepper (one line, no caption); a side → the centered <Stepper full> reveals. */
  showStepper: boolean;
}
export function relHandicapView(value: number, aName: string, bName: string): RelHandicapView {
  const clamped = Math.max(-MAX, Math.min(MAX, Math.round(value)));
  const side: "a" | "b" | "even" = clamped < 0 ? "a" : clamped > 0 ? "b" : "even";
  const n = Math.abs(clamped);
  const even = side === "even";
  const recipient = even ? null : side === "a" ? aName : bName;
  const holes = [...strokeHoles(n)].sort((x, y) => x - y);
  // Even → no caption (the segment says it); a side → who gets the strokes.
  const caption = even
    ? ""
    : `${recipient} gets strokes on hole${n === 1 ? "" : "s"} ${holes.join(", ")}`;
  return { side, n, even, recipient, holes, caption, showStepper: !even };
}

interface RelHandicapControlProps {
  a: HandicapSide;
  b: HandicapSide;
  value: number; // signed, ∈ [−MAX, MAX]
  onChange: (value: number) => void;
  /** Small left-gutter match number (§8). Omit for a lone match (no number shown). */
  matchNumber?: number;
}

export function RelHandicapControl({ a, b, value, onChange, matchNumber }: RelHandicapControlProps) {
  const { side, n, even, caption, showStepper } = relHandicapView(value, a.name, b.name);

  // Selecting a player keeps the current magnitude (min 1) and points it that way.
  // Switching sides preserves |value| (sign flip).
  const pickSide = (target: "a" | "b") => {
    const mag = n === 0 ? 1 : n;
    onChange(target === "a" ? -mag : mag);
  };
  // Step magnitude; never crosses into Even (Even is toggle-only). Inert when even.
  const step = (delta: number) => {
    if (even) return;
    const mag = Math.max(1, Math.min(MAX, n + delta));
    onChange(side === "a" ? -mag : mag);
  };

  // Geometric stepper alignment (§8 — measured, NOT a pixel breakpoint). The reveal
  // is centered under the MIDDLE (Even) column by default (mobile-first: the stepper
  // is wider than a narrow player column). As a progressive enhancement, when the
  // selected player's column is wide enough to CONTAIN the stepper
  // (`playerColumnWidth ≥ stepperWidth`), it snaps to center under that name instead.
  // The default is centered (textAlign on the wrapper), so `offset` only ever shifts
  // it sideways under the name — no flash, and the narrow case never moves.
  const contentRef = useRef<HTMLDivElement>(null);
  const stepperRef = useRef<HTMLDivElement>(null);
  const segARef = useRef<HTMLButtonElement>(null);
  const segBRef = useRef<HTMLButtonElement>(null);
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    if (!showStepper) return;
    const measure = () => {
      const content = contentRef.current;
      const stepper = stepperRef.current;
      const seg = side === "a" ? segARef.current : segBRef.current;
      if (!content || !stepper || !seg) return;
      const cRect = content.getBoundingClientRect();
      const sRect = seg.getBoundingClientRect();
      const W = cRect.width;
      const S = stepper.offsetWidth; // the stepper's intrinsic width (inline-block)
      const colW = sRect.width;
      const colCenter = sRect.left + sRect.width / 2 - cRect.left;
      // Snap under the name only when the column can hold the stepper; else stay
      // centered (offset 0 = under the middle, the default).
      setOffset(colW >= S ? colCenter - W / 2 : 0);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (contentRef.current) ro.observe(contentRef.current);
    return () => ro.disconnect();
  }, [showStepper, side]);

  return (
    // The match-number gutter sits LEFT of the match CONTENT column (§8 — no header).
    // The reveal (stepper + caption) lives INSIDE that content column, so it aligns
    // under the player columns / matchup — not centered on the whole panel (defect 2).
    <div className="flex items-start" style={{ gap: 10 }}>
      {matchNumber != null && (
        // The shared RowNumber cell (row pattern Phase 1b) — same recessed treatment
        // as the Matches number column (no DragHandle; handicaps don't reorder). Height
        // matches the segmented track (44 segment + 2×4 padding) so the number centers
        // with the segments row, not the whole content column.
        <RowNumber number={matchNumber} className="flex-shrink-0" style={{ width: 22, height: 52 }} />
      )}
      <div ref={contentRef} className="flex min-w-0 flex-1 flex-col">
        {/* Segmented selector */}
        <div className="flex" style={{ gap: 4, padding: 4, borderRadius: 12, background: "var(--color-bt-card)" }}>
          <Segment selected={side === "a"} onClick={() => pickSide("a")} innerRef={segARef}>
            {/* The SHARED SideChips (avatar-left PlayerChips) — one chip for a 1v1
                side, two stacked for 2v2 (A2a: no compound avatar / "Name & …"). The
                segment wrapper owns the selection surface, so each chip's own surface
                is stripped to transparent and shows it through. */}
            <SideChips players={a.players} chipStyle={{ background: "transparent", border: "none", height: "100%" }} />
          </Segment>
          <Segment selected={even} onClick={() => onChange(0)} narrow>
            Even
          </Segment>
          <Segment selected={side === "b"} onClick={() => pickSide("b")} innerRef={segBRef}>
            <SideChips players={b.players} chipStyle={{ background: "transparent", border: "none", height: "100%" }} />
          </Segment>
        </div>

        {/* Reveal (§8) — under the matchup (defect 2): Even is JUST the row (no
            stepper, no caption — the selected Even segment already says it, P3b).
            Side selected → the centered <Stepper full> (P-B) + a muted recipient
            caption (NOT teal — teal is the selection fill only). The stepper centers
            within THIS content column, i.e. under the player columns. */}
        {showStepper && (
          <>
            {/* Centered by default (textAlign → under the middle column); the measured
                `offset` only shifts it under the selected name when that column can
                hold it (geometric, P3c). inline-block so offsetWidth = the stepper's
                intrinsic width (the `S` the effect compares against the column). */}
            <div style={{ marginTop: 12, textAlign: "center" }}>
              <div ref={stepperRef} style={{ display: "inline-block", transform: `translateX(${offset}px)` }}>
                <Stepper
                  size="full"
                  value={n}
                  min={1}
                  max={MAX}
                  onDecrement={() => step(-1)}
                  onIncrement={() => step(1)}
                  formatValue={() => String(n)}
                  label={n === 1 ? "STROKE" : "STROKES"}
                />
              </div>
            </div>
            <div className="text-center" style={{ fontSize: 13, color: "var(--color-bt-text-dim)", marginTop: 12 }}>
              {caption}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * One segment — the selection wrapper around the shared PlayerChip (player segments)
 * or the centered "Even" label (narrow). Selected = TEAL FILL (faint teal wash + teal
 * border) — the scoped selection-state treatment for segmented selectors (§1/§8).
 * Unselected = the recessed card-raised chip with a transparent border, so selection
 * never shifts layout. `narrow` is the Even segment (no chip, hugs its centered label).
 */
function Segment({
  selected, onClick, children, narrow = false, innerRef,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
  narrow?: boolean;
  /** The selected player segment is measured against the stepper width (P3c). */
  innerRef?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={innerRef}
      type="button"
      onClick={onClick}
      className="flex min-w-0 items-center"
      style={{
        flex: narrow ? "0 0 auto" : "1 1 0",
        justifyContent: "center",
        // Player segments carry the shared PlayerChip (which owns its own avatar
        // inset), so the segment adds no padding; the narrow Even segment hugs its
        // centered label with its own padding.
        height: 44,
        borderRadius: 10,
        padding: narrow ? "0 14px" : 0,
        // Selection treatment = TEAL FILL (the scoped expansion of the teal
        // discipline — teal-fill is permitted as a SELECTION state in segmented
        // selectors; see W-GAMEPAGE-01_visual_vocabulary §1/§8). Selected = faint
        // teal wash + teal border; unselected = the recessed card-raised chip + a
        // transparent border so selection never shifts layout.
        background: selected ? "rgba(45,212,191,0.14)" : "var(--color-bt-card-raised)",
        border: selected ? "1.5px solid var(--color-bt-accent)" : "1.5px solid transparent",
        color: selected ? "var(--color-bt-text)" : "var(--color-bt-text-dim)",
        fontSize: 14,
        fontWeight: selected ? 600 : 500,
      }}
    >
      {children}
    </button>
  );
}
