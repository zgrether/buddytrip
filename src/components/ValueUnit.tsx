"use client";

/**
 * ValueUnit — a number and its unit, told apart.
 *
 * ── The rule ───────────────────────────────────────────────────────────────
 *
 * THE NUMBER IS THE VALUE; THE UNIT IS ITS LABEL. The number takes the primary
 * text colour, the unit takes the secondary. "**16** pts", not "16 pts" in one
 * weight.
 *
 * The match list already did this — a point chip renders the digits white and
 * `PTS` grey — and nothing said so, which is why the countdown and the
 * "worth N pts" ribbon each decided differently from scratch. The rule is
 * written into STYLE_GUIDE §2c; this component is where it lives in code so
 * the next value with a unit does not get a third answer.
 *
 * ── WHERE IT APPLIES, and the test is not a list of sites ──────────────────
 *
 * Where the number is the CONTENT and the unit is its label — a chip, a stat, a
 * countdown, a ribbon. Not inside a sentence: "18 holes · Sept 4" is a caption,
 * and recolouring the 18 there fragments the line and makes it look like a
 * link. If it reads as prose, leave it alone.
 *
 * ── Equal weight across segments ───────────────────────────────────────────
 *
 * A multi-part value (`54h 09m`) renders each segment identically. The leading
 * unit is NOT emphasised: at `00h 47m` the hours have stopped mattering, and a
 * rule whose emphasis changes with the value is one nobody can predict — the
 * reader would have to work out which half is currently important. Both halves
 * look the same and the digits carry it.
 */

export function ValueUnit({
  value,
  unit,
  size,
  weight = 700,
  color,
  unitColor = "var(--color-bt-text-dim)",
  gap = 2,
  testId,
}: {
  /** The number. Pre-formatted by the caller — this does no rounding. */
  value: string | number;
  /** Its label: `pts`, `h`, `m`. Omitted renders the number alone. */
  unit?: string;
  size?: number;
  weight?: number;
  /** The number's colour. Defaults to primary text. */
  color?: string;
  /** The unit's colour. Secondary by default — that IS the rule. */
  unitColor?: string;
  /** Space between number and unit. */
  gap?: number;
  testId?: string;
}) {
  return (
    <span
      data-testid={testId}
      style={{ fontSize: size, fontWeight: weight, fontVariantNumeric: "tabular-nums" }}
    >
      <span style={{ color: color ?? "var(--color-bt-text)" }}>{value}</span>
      {unit != null && (
        <>
          <span style={{ display: "inline-block", width: gap }} />
          {/* Weight is inherited on purpose: the unit is quieter by COLOUR, not
              by also being lighter. Two axes saying the same thing makes the
              unit disappear at small sizes, and it still has to be readable. */}
          <span style={{ color: unitColor }}>{unit}</span>
        </>
      )}
    </span>
  );
}

/**
 * The same rule over a multi-segment value, e.g. a countdown's `54h 09m`.
 *
 * A single node rather than the caller repeating `ValueUnit`, so the spacing
 * between segments is decided once — and so the equal-weight property above is
 * structural rather than something each caller has to remember not to break.
 */
export function ValueUnitParts({
  parts,
  size,
  weight = 700,
  color,
  unitColor = "var(--color-bt-text-dim)",
  segmentGap = 6,
  testId,
}: {
  parts: { value: string | number; unit?: string }[];
  size?: number;
  weight?: number;
  color?: string;
  unitColor?: string;
  segmentGap?: number;
  testId?: string;
}) {
  return (
    <span
      data-testid={testId}
      className="inline-flex items-baseline"
      style={{ gap: segmentGap }}
    >
      {parts.map((p, i) => (
        <ValueUnit
          key={i}
          value={p.value}
          unit={p.unit}
          size={size}
          weight={weight}
          color={color}
          unitColor={unitColor}
        />
      ))}
    </span>
  );
}
