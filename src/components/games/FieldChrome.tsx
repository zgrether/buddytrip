"use client";

/**
 * The two form primitives Quick Play's setup screens use — extracted from
 * `app/quick-game/page.tsx`, where they were page-local, so the side-bet form
 * can render the same controls instead of growing a second copy of them. Pure
 * presentation, no state, no persistence.
 */

/** The shared small-caps field label (STYLE_GUIDE §2b eyebrow recipe). */
export function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
      {children}
    </label>
  );
}

/** A segmented selector in the app's established treatment (vocabulary §1/§8):
 *  the selected segment is a teal fill, unselected are recessed card-raised
 *  chips. Same look `RelHandicapControl` uses for its `[A│Even│B]` row. */
export function Segmented<T extends string>({
  options, value, onChange, testId,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  testId?: string;
}) {
  return (
    <div className="flex gap-1.5" data-testid={testId}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={on}
            className="flex-1 rounded-[10px] py-2 text-[13px] font-semibold transition-colors"
            style={{
              background: on ? "var(--color-bt-accent-faint)" : "var(--color-bt-card-raised)",
              border: `1px solid ${on ? "var(--color-bt-accent)" : "var(--color-bt-border)"}`,
              color: on ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
