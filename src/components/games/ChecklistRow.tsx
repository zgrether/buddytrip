"use client";

import { ChevronRight, Check } from "lucide-react";

/**
 * ChecklistRow — the ONE canonical config-checklist row (config-checklist model).
 * Every config aspect renders as this: uniform height + shape, `label · summary ·
 * trailing`. The heavy editor lives BEHIND it (a Sheet overlay opened on tap); the
 * row itself only ever shows a one-line summary, so the surface stays scannable
 * and CALMS as you resolve it (the recede). Tappable → opens its editor; omit
 * `onClick` → a read-only summary row (Available Players; Modifiers until effects
 * land).
 *
 * Three STATES as distinct visuals (reusing GameRow's language + the net-new one):
 *   - unresolved          → skeleton: dashed border, NO fill, dim summary
 *     ("Not set"); needs attention.
 *   - acknowledged-empty  → NET-NEW: solid border + `--color-bt-card-raised` fill
 *     + a check + dim "Off"/"None"; a valid done (you looked, chose nothing).
 *     Distinct from unresolved (not dashed) AND from resolved (raised, not the
 *     card fill).
 *   - resolved            → ready: `--color-bt-card` fill + solid border + the
 *     real summary.
 */
export type ChecklistRowState = "unresolved" | "acknowledged-empty" | "resolved";

export function ChecklistRow({
  label,
  value,
  state,
  optional,
  onClick,
  disabled,
  testId,
}: {
  label: string;
  /** One-line summary (the resolved content, or "Not set" / "Off" / "None"). */
  value: string;
  state: ChecklistRowState;
  optional?: boolean;
  /** Omit → read-only row (no chevron, not tappable). */
  onClick?: () => void;
  disabled?: boolean;
  testId?: string;
}) {
  const tappable = !!onClick && !disabled;
  const fill =
    state === "resolved" ? "var(--color-bt-card)"
    : state === "acknowledged-empty" ? "var(--color-bt-card-raised)"
    : undefined; // unresolved: no fill
  const border = state === "unresolved" ? "1.5px dashed var(--color-bt-border)" : "1px solid var(--color-bt-border)";
  const valueColor = state === "resolved" ? "var(--color-bt-text)" : "var(--color-bt-text-dim)";

  const inner = (
    <>
      <div className="flex min-w-0 flex-col">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
          {label}
          {optional && <span style={{ fontWeight: 500, textTransform: "none", letterSpacing: 0 }}>· optional</span>}
        </span>
        <span className="truncate text-sm" style={{ color: valueColor, marginTop: 2 }}>
          {value}
        </span>
      </div>
      <span className="flex shrink-0 items-center gap-1.5">
        {state === "acknowledged-empty" && <Check size={15} style={{ color: "var(--color-bt-text-dim)" }} />}
        {tappable && <ChevronRight size={16} style={{ color: "var(--color-bt-text-dim)" }} />}
      </span>
    </>
  );

  const className = "flex w-full items-center justify-between gap-3 rounded-xl px-3.5 py-3 text-left disabled:opacity-60";
  const style = { background: fill, border } as React.CSSProperties;

  if (tappable) {
    return (
      <button type="button" onClick={onClick} disabled={disabled} className={className} style={style} data-testid={testId}>
        {inner}
      </button>
    );
  }
  return (
    <div className={className} style={style} data-testid={testId}>
      {inner}
    </div>
  );
}
