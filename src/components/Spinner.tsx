/**
 * Spinner — the one spinning-ring indicator.
 *
 * Extracted from `TripCard`'s navigation-pending overlay when the context rail
 * needed the same affordance (#Part C). It is deliberately the SAME visual, not a
 * second one: the rail and the dashboard both mean "the thing you tapped is
 * loading", and two hand-rolled rings that drift apart is how that stops reading
 * as one system.
 *
 * Size is the only knob. Colour is `--color-bt-accent` with a transparent top
 * segment — the existing treatment, unchanged.
 */
export function Spinner({ size = 24 }: { size?: number }) {
  return (
    <span
      className="inline-block animate-spin rounded-full"
      style={{
        height: size,
        width: size,
        borderWidth: size <= 16 ? 2 : 2,
        borderStyle: "solid",
        borderColor: "var(--color-bt-accent)",
        borderTopColor: "transparent",
      }}
    />
  );
}
