"use client";

import { strokeHoles } from "@/lib/matchPlay";
import { Stepper } from "@/components/games/Stepper";
import { Avatar } from "@/components/Avatar";
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
    <div>
      {/* Match-number left gutter + the segmented selector (§8 — the header is gone;
          the control itself answers "who gets strokes"). */}
      <div className="flex items-center" style={{ gap: 10 }}>
        {matchNumber != null && (
          <span
            className="flex-shrink-0 text-center"
            style={{ width: 16, fontSize: 13, fontWeight: 700, color: "var(--color-bt-text-dim)", fontVariantNumeric: "tabular-nums" }}
          >
            {matchNumber}
          </span>
        )}
        <div
          className="flex flex-1"
          style={{ gap: 4, padding: 4, borderRadius: 12, background: "var(--color-bt-card)" }}
        >
          <Segment selected={side === "a"} onClick={() => pickSide("a")}>
            <Avatar name={a.name} teamColor={a.color} sizePx={22} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</span>
          </Segment>
          <Segment selected={even} onClick={() => onChange(0)} narrow>
            Even
          </Segment>
          <Segment selected={side === "b"} onClick={() => pickSide("b")}>
            <Avatar name={b.name} teamColor={b.color} sizePx={22} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.name}</span>
          </Segment>
        </div>
      </div>

      {/* Reveal (§8): Even → one muted caption, no stepper. Side selected → the
          centered canonical <Stepper full> (P-B) + a muted recipient caption (NOT
          teal — teal is reserved for the selected segment's outline). Both the
          stepper-gate and the caption come from the pure `relHandicapView`. */}
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
  );
}

/**
 * One segment. Selected = teal OUTLINE on a lifted (card-raised) chip with white
 * text — never a solid fill (§8; a fill muddies the team avatars). Unselected =
 * transparent on the recessed track, muted text, a transparent border so selection
 * never shifts layout. `narrow` is the Even segment (no avatar, hugs its label).
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
      className="flex min-w-0 items-center justify-center gap-1.5"
      style={{
        flex: narrow ? "0 0 auto" : "1 1 0",
        height: 44,
        borderRadius: 9,
        padding: narrow ? "0 14px" : "0 8px",
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
