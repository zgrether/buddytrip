"use client";

import { useEffect, useRef } from "react";
import { ChevronRight, ChevronDown, Check } from "lucide-react";

/**
 * ChecklistRow — the ONE canonical config-checklist row (config-checklist model).
 * Every config aspect renders as this: uniform height + shape, `✓ LABEL · value ·
 * chevron`. It now behaves like an actual checklist item — **tap to expand the
 * editor IN PLACE** (a drop-down panel beneath the row, NOT a modal floating over
 * the page), edit live, **collapse = acknowledge** (the check appears; closing IS
 * accepting — no separate Accept button). The parent owns a single `openRowId` so
 * only one panel is open at a time (which also physically gates dependent rows).
 *
 * Three presentations of a row:
 *   - **accordion** (`onToggle` + `children`) — tap toggles an in-place panel.
 *   - **overlay-tappable** (`onClick`, no children) — opens a separate editor
 *     (the Course picker / the Game-config Sheet, which stay overlays this pass);
 *     trailing chevron points right.
 *   - **read-only** (neither) — a static summary row (Modifiers).
 *
 * Layout — **check LEADING (left), chevron TRAILING (right)** so the row reads as
 * a checklist and the check + chevron never fight (the #461 right-side conflict).
 *
 * Three STATES as distinct visuals (reusing GameRow's language + the net-new one):
 *   - unresolved          → skeleton: dashed border, NO fill, NO check, dim
 *     summary ("Not set"); needs attention.
 *   - acknowledged-empty  → solid border + `--color-bt-card-raised` fill + a
 *     leading check + dim "Off"/"None"; a valid done (you looked, chose nothing).
 *   - resolved            → ready: `--color-bt-card` fill + solid border + a
 *     leading check + the real summary announced LOUD (value is the prominent
 *     element, label the quiet caption — answers shout, questions whisper).
 * While EXPANDED the row shows its label as the active title (the loud-value
 * treatment is the collapsed-resolved state) and the trailing chevron points up.
 */
export type ChecklistRowState = "unresolved" | "acknowledged-empty" | "resolved";

export function ChecklistRow({
  label,
  value,
  state,
  optional,
  onClick,
  expanded,
  onToggle,
  children,
  disabled,
  testId,
}: {
  label: string;
  /** One-line summary (the resolved content, or "Not set" / "Off" / "None"). */
  value: string;
  state: ChecklistRowState;
  optional?: boolean;
  /** Overlay-tappable row (opens a separate editor). Omit for accordion/read-only. */
  onClick?: () => void;
  /** Accordion: whether this row's in-place panel is open (parent-owned). */
  expanded?: boolean;
  /** Accordion: tap toggles the panel. Omit → not an accordion row. */
  onToggle?: () => void;
  /** Accordion: the dropped-down editor content (rendered beneath when expanded). */
  children?: React.ReactNode;
  disabled?: boolean;
  testId?: string;
}) {
  const accordion = !!onToggle && !disabled;
  const overlay = !!onClick && !disabled && !accordion;
  const acknowledged = state === "resolved" || state === "acknowledged-empty";
  const isOpen = accordion && !!expanded;

  const fill =
    isOpen ? "var(--color-bt-card-raised)"
    : state === "resolved" ? "var(--color-bt-card)"
    : state === "acknowledged-empty" ? "var(--color-bt-card-raised)"
    : undefined; // unresolved: no fill
  const border = state === "unresolved" && !isOpen ? "1.5px dashed var(--color-bt-border)" : "1px solid var(--color-bt-border)";

  // Auto-scroll: when the panel opens, lift the row's top to the top of the
  // screen so the dropped-down editor has full vertical room. The page scrolls in
  // the window (the setup header is in-flow, not sticky), so block:"start" lands
  // the row at the viewport top; a little scroll-margin keeps it off the edge.
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (isOpen) rowRef.current?.scrollIntoView({ block: "start" });
  }, [isOpen]);

  // Leading: the check (acknowledged + collapsed). While expanded the row is
  // "being decided" → no check yet (collapse re-acknowledges). Reserve the slot
  // either way so labels align across all rows (one styling language).
  const leading = (
    <span className="flex w-5 shrink-0 items-center justify-center">
      {acknowledged && !isOpen && <Check size={16} style={{ color: "var(--color-bt-accent)" }} />}
    </span>
  );

  const labelCaption = (
    <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
      {label}
      {optional && <span style={{ fontWeight: 500, textTransform: "none", letterSpacing: 0 }}>· optional</span>}
    </span>
  );

  // Content column — by state. Resolved + collapsed announces the VALUE loud
  // (label demoted to a quiet caption). Expanded shows the label as the active
  // title. Unresolved / acknowledged-empty keep the quiet caption + dim summary.
  const content =
    isOpen ? (
      <div className="flex min-w-0 flex-1 flex-col">{labelCaption}</div>
    ) : state === "resolved" ? (
      <div className="flex min-w-0 flex-1 flex-col">
        {labelCaption}
        <span className="truncate text-[15px] font-semibold" style={{ color: "var(--color-bt-text)", marginTop: 1 }}>
          {value}
        </span>
      </div>
    ) : (
      <div className="flex min-w-0 flex-1 flex-col">
        {labelCaption}
        <span className="truncate text-sm" style={{ color: "var(--color-bt-text-dim)", marginTop: 2 }}>
          {value}
        </span>
      </div>
    );

  const trailing = (
    <span className="flex shrink-0 items-center">
      {accordion ? (
        <ChevronDown size={16} style={{ color: "var(--color-bt-text-dim)", transform: isOpen ? "rotate(180deg)" : undefined, transition: "transform 120ms" }} />
      ) : overlay ? (
        <ChevronRight size={16} style={{ color: "var(--color-bt-text-dim)" }} />
      ) : null}
    </span>
  );

  const headerInner = (
    <>
      {leading}
      {content}
      {trailing}
    </>
  );
  const headerClass = "flex w-full items-center gap-2.5 px-3.5 py-3 text-left disabled:opacity-60";
  const containerStyle = { background: fill, border } as React.CSSProperties;

  // Accordion: a header button toggling an in-place panel below (same bordered
  // frame — the row IS the frame; the panel sheds all modal chrome).
  if (accordion) {
    return (
      <div ref={rowRef} className="rounded-xl" style={{ ...containerStyle, scrollMarginTop: 12 }} data-testid={testId}>
        <button type="button" onClick={onToggle} className={headerClass} aria-expanded={isOpen}>
          {headerInner}
        </button>
        {isOpen && (
          <div className="px-3.5 pb-3.5 pt-1" style={{ borderTop: "1px solid var(--color-bt-border)" }}>
            {children}
          </div>
        )}
      </div>
    );
  }

  // Overlay-tappable (Course / Game-config) — opens a separate editor.
  if (overlay) {
    return (
      <button type="button" onClick={onClick} disabled={disabled} className={`${headerClass} rounded-xl`} style={containerStyle} data-testid={testId}>
        {headerInner}
      </button>
    );
  }

  // Read-only summary row.
  return (
    <div className={`${headerClass} rounded-xl`} style={containerStyle} data-testid={testId}>
      {headerInner}
    </div>
  );
}
