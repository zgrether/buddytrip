"use client";

import { strokeHoles } from "@/lib/matchPlay";
import { Stepper } from "@/components/games/Stepper";
import { MatchGridRow } from "@/components/games/MatchGridRow";
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
  /** The row's match number (shared MatchGridRow number column — always shown so
   *  Handicaps aligns with Matches / Point Distribution down the page). */
  matchNumber: number;
  /** No top hairline on the first row (MatchGridRow delimits BETWEEN matches). */
  isFirst?: boolean;
}

export function RelHandicapControl({ a, b, value, onChange, matchNumber, isFirst }: RelHandicapControlProps) {
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

  // Settings polish §E.2: the three-way choice (side A / Even / side B) is unchanged
  // in BEHAVIOR — the A and B segments stay in the matchup columns (with "vs" between,
  // via MatchGridRow), and "Even" RELOCATES to the shared value column on the right so
  // Handicaps lines up with Point Distribution's points field. The stroke stepper
  // stays exactly as-is, revealed BELOW when a side is chosen — now plainly centered
  // (the old geometric snap-under-name offset doesn't apply once Even leaves the row).
  return (
    <MatchGridRow
      number={matchNumber}
      isFirst={isFirst}
      testId="handicap-row"
      sideA={
        <SideSegment selected={side === "a"} onClick={() => pickSide("a")}>
          <SideChips players={a.players} chipStyle={{ background: "transparent", border: "none" }} />
        </SideSegment>
      }
      sideB={
        <SideSegment selected={side === "b"} onClick={() => pickSide("b")}>
          <SideChips players={b.players} chipStyle={{ background: "transparent", border: "none" }} />
        </SideSegment>
      }
      value={
        <Segment selected={even} onClick={() => onChange(0)} narrow>
          Even
        </Segment>
      }
      below={
        showStepper ? (
          <>
            <div style={{ textAlign: "center" }}>
              <div style={{ display: "inline-block" }}>
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
        ) : undefined
      }
    />
  );
}

/** A full-width selectable side segment (the A / B columns). Wraps the shared Segment
 *  so the matchup columns fill their grid cell. */
function SideSegment({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <div style={{ width: "100%" }}>
      <Segment selected={selected} onClick={onClick} fill>
        {children}
      </Segment>
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
  selected, onClick, children, narrow = false, fill = false,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
  narrow?: boolean;
  /** Fill the parent width (the A/B matchup columns own their grid cell). */
  fill?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-w-0 items-center"
      style={{
        width: fill ? "100%" : undefined,
        // Player segments left-justify their chips (avatar-left, matching the
        // Matches renderer) instead of floating centered (W4-7); the narrow Even
        // segment keeps its centered label.
        justifyContent: narrow ? "center" : "flex-start",
        paddingLeft: narrow ? undefined : 8,
        // Player segments carry the shared SideChips (which own their own avatar
        // inset), so the segment adds no padding; the narrow Even segment hugs its
        // centered label with its own padding. `minHeight` (not a fixed height) so a
        // DOUBLES side's two stacked chips grow the row instead of being clipped;
        // singles keep the 44 baseline, and the flex row stretches all segments
        // (incl. Even) to the tallest.
        minHeight: 44,
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
