"use client";

import { strokeHoles } from "@/lib/matchPlay";
import { Stepper } from "@/components/games/Stepper";
import { RowNumber } from "@/components/games/RowNumber";
import { PlayerChip } from "@/components/games/PlayerChip";
import type { Participant } from "./types";

/**
 * RelHandicapControl — the relative-handicap control for 1v1 (Slice B §6, as
 * amended by Spec Addendum B-1; restyled in W-GAMEPAGE visual pass P-D §8). A
 * segmented direction selector + a STEPPER — no draggable slider (a ±18 span is
 * undraggable one-thumbed in the sun; the number matters most in the big-mismatch
 * case, exactly where a bare slider fails).
 *
 * §8 look: the selected segment is an OUTLINE (teal border), never a solid fill —
 * a fill fights the team avatars the player segments now carry. The per-row
 * "WHO GETS STROKES?" header is gone; the match number sits in a small left gutter.
 * Reveal is altitude-aware: Even shows one muted caption (no stepper); a side
 * selected reveals the centered <Stepper full> + a muted recipient caption.
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
  /** The muted reveal caption: "Even match …" or "{recipient} gets strokes on holes …". */
  caption: string;
  /** Even → no stepper (one line); a side → the centered <Stepper full> reveals. */
  showStepper: boolean;
}
export function relHandicapView(value: number, aName: string, bName: string): RelHandicapView {
  const clamped = Math.max(-MAX, Math.min(MAX, Math.round(value)));
  const side: "a" | "b" | "even" = clamped < 0 ? "a" : clamped > 0 ? "b" : "even";
  const n = Math.abs(clamped);
  const even = side === "even";
  const recipient = even ? null : side === "a" ? aName : bName;
  const holes = [...strokeHoles(n)].sort((x, y) => x - y);
  const caption = even
    ? "Even match — no strokes given"
    : `${recipient} gets strokes on hole${n === 1 ? "" : "s"} ${holes.join(", ")}`;
  return { side, n, even, recipient, holes, caption, showStepper: !even };
}

interface RelHandicapControlProps {
  a: Participant;
  b: Participant;
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
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Segmented selector */}
        <div className="flex" style={{ gap: 4, padding: 4, borderRadius: 12, background: "var(--color-bt-card)" }}>
          <Segment selected={side === "a"} onClick={() => pickSide("a")}>
            {/* The SHARED PlayerChip (avatar 30, left-aligned) — identical to the
                Matches chip. The segment wrapper owns the selection surface, so the
                chip's own surface is stripped to transparent and shows it through. */}
            <PlayerChip name={a.name} teamColor={a.color} style={{ background: "transparent", border: "none", height: "100%" }} />
          </Segment>
          <Segment selected={even} onClick={() => onChange(0)} narrow>
            Even
          </Segment>
          <Segment selected={side === "b"} onClick={() => pickSide("b")}>
            <PlayerChip name={b.name} teamColor={b.color} style={{ background: "transparent", border: "none", height: "100%" }} />
          </Segment>
        </div>

        {/* Reveal (§8) — under the matchup (defect 2): Even → one muted caption, no
            stepper. Side selected → the centered <Stepper full> (P-B) + a muted
            recipient caption (NOT teal — teal is the selected outline only). The
            stepper centers within THIS content column, i.e. under the player columns. */}
        {showStepper ? (
          <>
            <div style={{ marginTop: 12 }}>
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
            <div className="text-center" style={{ fontSize: 13, color: "var(--color-bt-text-dim)", marginTop: 12 }}>
              {caption}
            </div>
          </>
        ) : (
          <div className="text-center" style={{ fontSize: 13, color: "var(--color-bt-text-dim)", marginTop: 10 }}>
            {caption}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * One segment. Selected = teal OUTLINE on a lifted (card-raised) chip with white
 * text — never a solid fill (§8; a fill muddies the team avatars). Unselected =
 * transparent on the recessed track, muted text, a transparent border so selection
 * never shifts layout. `narrow` is the Even segment (no avatar, hugs its centered
 * label). Player chips are LEFT-aligned (avatar then name) — table-like, the
 * direction the Matches redesign is heading (defect 3).
 */
function Segment({
  selected, onClick, children, narrow = false,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
  narrow?: boolean;
}) {
  return (
    <button
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
        background: selected ? "var(--color-bt-card-raised)" : "transparent",
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
