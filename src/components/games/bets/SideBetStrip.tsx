"use client";

import { ChevronRight, TriangleAlert } from "lucide-react";
import { formatMoney, formatSignedMoney, type ExposureState } from "@/lib/sideBets";

/**
 * The live side-bet strip — the thing you glance at walking to the next tee.
 *
 * Three lines, in the order §6 puts them:
 *   1. ONE number, prominent — the round's net from the chosen player's
 *      perspective. **Always live**, never the hole being viewed: navigating
 *      back to fix the 9th must not rewind it, which is enforced by there being
 *      no hole input to `total` at all (`quickBetStrip` takes none).
 *   2. Current per-hole exposure, DIRECTLY UNDER IT and not behind a tap.
 *      This is the requirement, not a nicety: presses compound, and the way a
 *      round gets away from someone is that everyone is still calling it a five
 *      dollar bet while it is forty a hole. The number that would have
 *      prevented that is this one, so it has to be visible without asking.
 *   3. What the hole being VIEWED was worth — a different question, and one
 *      that legitimately follows navigation.
 *
 * The breakdown is behind the tap, deliberately not expanded: three concurrent
 * bets is a table, and a table is not glanceable.
 *
 * Persistence-agnostic (CLAUDE.md #7): every figure arrives as a prop, already
 * derived by `sideBets.ts`. Nothing is computed here — a number computed in a
 * component can only be tested as "a number was displayed".
 */
export function SideBetStrip({
  perspectiveName,
  total,
  exposure,
  hole,
  presses,
  onOpen,
}: {
  perspectiveName: string;
  /** The round's net for that player. Not a function of the viewed hole. */
  total: number;
  exposure: ExposureState;
  /** The hole currently being viewed — its own money line. */
  hole: {
    label: string;
    /** What the hole is WORTH — the pot in skins, the stake head-to-head.
     *  Never the per-side stake: "This hole: $80", never "$10/hole" (§11). */
    pot: number;
    decided: boolean;
    /** What this hole moved for the perspective player (0 if nothing). */
    delta: number;
  } | null;
  /** Presses that fired at the hole being viewed, with the exposure each
   *  created — the announcement §6 asks for. A number that jumps with nothing
   *  saying why reads as a bug. */
  presses: { level: number; exposureAfter: number }[];
  onOpen: () => void;
}) {
  const multiple = exposure.liveBetCount > 1;
  const tone =
    total > 0.004 ? "var(--color-bt-place-1-text)" : total < -0.004 ? "var(--color-bt-danger)" : "var(--color-bt-text-dim)";

  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid="side-bet-strip"
      className="flex w-full shrink-0 items-center gap-3 text-left"
      style={{
        padding: "8px 16px",
        background: "var(--color-bt-card)",
        borderBottom: "1px solid var(--color-bt-subtle-border)",
      }}
    >
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span style={{ fontSize: 13, fontWeight: 500, color: "var(--color-bt-text-dim)" }}>{perspectiveName}</span>
          <span
            data-testid="side-bet-total"
            style={{
              // With several bets running, a personal net does not say against
              // whom — exposure is the more useful headline, so the two swap
              // weight rather than the total simply shouting louder (§14).
              fontSize: multiple ? 16 : 22,
              fontWeight: 700,
              letterSpacing: "-0.02em",
              color: tone,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {formatSignedMoney(total)}
          </span>
        </span>

        {/* Per-hole exposure — never behind a tap (§9). */}
        <span
          data-testid="side-bet-exposure"
          className="mt-0.5 flex items-center gap-1"
          style={{
            fontSize: multiple ? 19 : 13,
            fontWeight: exposure.warn || multiple ? 700 : 500,
            color: exposure.warn
              ? "var(--color-bt-warning)"
              : multiple
                ? "var(--color-bt-text)"
                : "var(--color-bt-text-dim)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {exposure.warn && <TriangleAlert size={13} />}
          {formatMoney(exposure.perHole)}/hole across {exposure.liveBetCount}{" "}
          {exposure.liveBetCount === 1 ? "bet" : "bets"}
        </span>

        {hole && (
          <span
            data-testid="side-bet-hole-line"
            className="mt-0.5 block"
            style={{ fontSize: 12, color: "var(--color-bt-text-dim)", fontVariantNumeric: "tabular-nums" }}
          >
            Hole {hole.label} ·{" "}
            {hole.decided
              ? Math.abs(hole.delta) < 0.005
                ? `${formatMoney(hole.pot)} carried over`
                : `${formatSignedMoney(hole.delta)} to ${perspectiveName}`
              : `worth ${formatMoney(hole.pot)}`}
          </span>
        )}

        {presses.map((p) => (
          <span
            key={p.level}
            data-testid="side-bet-press-note"
            className="mt-1 inline-block"
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.04em",
              color: "var(--color-bt-warning)",
              background: "var(--color-bt-warning-faint)",
              border: "1px solid var(--color-bt-warning-border)",
              borderRadius: 5,
              padding: "1px 6px",
              marginRight: 4,
            }}
          >
            PRESS {p.level} · NOW {formatMoney(p.exposureAfter)}/HOLE
          </span>
        ))}
      </span>
      <ChevronRight size={18} className="shrink-0" style={{ color: "var(--color-bt-text-dim)" }} />
    </button>
  );
}
